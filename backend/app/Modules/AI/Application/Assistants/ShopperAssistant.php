<?php

namespace App\Modules\AI\Application\Assistants;

use App\Modules\AI\Application\Services\AiGate;
use App\Modules\AI\Application\Services\AiRunner;
use App\Modules\AI\Application\Services\MeteredCall;
use App\Modules\AI\Application\Tools\Shopper\ShopperFindings;
use App\Modules\AI\Application\Tools\Shopper\ShopperToolbox;
use App\Modules\AI\Application\Tools\ToolLoop;
use App\Modules\AI\Domain\Exceptions\AiBudgetExceeded;
use App\Modules\AI\Domain\Exceptions\AiUnavailable;
use App\Modules\AI\Domain\Llm\Conversation;
use App\Modules\AI\Domain\Llm\Message;
use App\Modules\AI\Domain\Llm\StopReason;
use App\Modules\AI\Domain\Shopper\ShopperFallbacks;
use App\Modules\AI\Domain\Shopper\ShopperReplyText;
use App\Modules\AI\Infrastructure\Models\AssistantConversation;
use App\Modules\AI\Infrastructure\Models\AssistantMessage;
use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Shared\Application\Localization\LocaleContext;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Storefront\Application\Contracts\StoreAssistantSettings;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Container\Container;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * AI2b: the online store's shopper support assistant — one shopper message in, one reply out.
 *
 * The store (organization) comes from the store host (tenant context); the conversation from
 * the browser's token (only its sha256 is stored) and, for a signed-in shopper, the customer
 * (another customer or a guest holding the token gets a new conversation). Limits: 20 shopper
 * messages per conversation, the store's daily number of new conversations, the organization's
 * monthly AI budget. With the assistant or AI off, the provider failing or a limit reached the
 * shopper gets a fixed reply (`status` unavailable | limit | budget) inviting them to the
 * hand-off — never an error.
 *
 * Each turn runs the read-only shopper toolbox in a tool loop (low effort, ≤ 3 tool rounds) with
 * the last 10 text turns as history; usage is metered as `store_assistant`. The reply's product
 * cards and links are built by the server from what the tools returned (ShopperFindings).
 */
final class ShopperAssistant
{
    public const MAX_SHOPPER_MESSAGES = 20;

    public const MAX_MESSAGE_LENGTH = 500;

    public const MAX_HISTORY = 10;

    public const MAX_TOOL_ROUNDS = 3;

    public const MAX_PRODUCTS = 4;

    public const MAX_LINKS = 3;

    public const RECENT_MESSAGES = 20;

    public const EFFORT = 'low';

    public const MAX_TOKENS = 2000;

    public const FEATURE = 'store_assistant';

    public function __construct(
        private readonly AiRunner $runner,
        private readonly AiGate $gate,
        private readonly StoreAssistantSettings $settings,
        private readonly LocaleContext $locale,
        private readonly TenantContext $tenant,
        private readonly OrganizationDirectory $organizations,
        private readonly Container $container,
    ) {}

    /**
     * @param  array{type: string, slug?: ?string}|null  $page
     * @return array{conversation_token: ?string, reply: array{text: string, products: list<array<string, mixed>>, links: list<array{label: string, path: string}>, handoff: ?array{type: string, url: string}}, status: string, remaining_messages: int}
     */
    public function send(?string $customerId, ?string $token, string $message, string $language, ?array $page = null): array
    {
        $organizationId = $this->tenant->requireOrganization();
        $settings = $this->settings->current(LocaleContext::EN);
        $language = $language === LocaleContext::BN && $settings['bangla_enabled'] ? LocaleContext::BN : LocaleContext::EN;
        // The tools' read models localize through the request locale: the shopper's language.
        $this->locale->configure($settings['bangla_enabled'], $settings['default_locale'], $language, $settings['bangla_digits']);
        $handoffType = $settings['handoff'] === 'none' || $settings['handoff_url'] === null ? null : $settings['handoff'];

        $conversation = $token === null ? null : $this->find($token, $customerId);

        if (! $settings['enabled'] || ! $this->gate->enabledFor($organizationId)) {
            return $this->fallback($conversation === null ? null : $token, ShopperFallbacks::UNAVAILABLE, 'unavailable', $language, $settings, $conversation);
        }

        if ($conversation === null) {
            if ($this->startedToday() >= $settings['daily_conversation_limit']) {
                return $this->fallback(null, ShopperFallbacks::BUSY, 'limit', $language, $settings, null);
            }
            $token = self::newToken();
            $conversation = AssistantConversation::query()->create([
                'token_hash' => AssistantConversation::hashToken($token),
                'customer_id' => $customerId,
                'language' => $language,
                'started_at' => now(),
                'last_message_at' => now(),
            ]);
        }
        /** @var string $token */
        $shopperMessages = $this->shopperMessages($conversation);
        if ($conversation->status === AssistantConversation::CLOSED || $shopperMessages >= self::MAX_SHOPPER_MESSAGES) {
            $reply = $this->fallback($token, ShopperFallbacks::CONVERSATION_FULL, 'limit', $language, $settings, $conversation);
            if ($conversation->status !== AssistantConversation::CLOSED) {
                // Recorded once, when the conversation closes.
                $this->record($conversation, [], $reply['reply'], 'limit', $language, close: true);
            }

            return $reply;
        }

        $history = $this->history($conversation);
        $this->record($conversation, ['role' => AssistantMessage::USER, 'text' => $message], null, 'ok', $language);
        $remaining = max(0, self::MAX_SHOPPER_MESSAGES - $shopperMessages - 1);

        try {
            $answer = $this->runner->run($organizationId, null, self::FEATURE, fn (MeteredCall $metered) => $this->answer($metered, $settings, $customerId, $conversation, $history, $message, $page));
        } catch (AiBudgetExceeded) {
            return $this->failed($conversation, $token, ShopperFallbacks::BUDGET, 'budget', $language, $settings, $remaining);
        } catch (AiUnavailable) {
            return $this->failed($conversation, $token, ShopperFallbacks::UNAVAILABLE, 'unavailable', $language, $settings, $remaining);
        } catch (Throwable $e) {
            report($e);

            return $this->failed($conversation, $token, ShopperFallbacks::UNAVAILABLE, 'unavailable', $language, $settings, $remaining);
        }

        $text = $answer['text'];
        $handoff = null;
        if ($answer['handoff'] && $handoffType !== null) {
            $handoff = $this->handoff($conversation, $settings);
        }
        $reply = ['text' => $text, 'products' => $answer['products'], 'links' => $answer['links'], 'handoff' => $handoff];
        $this->record($conversation, [
            'role' => AssistantMessage::ASSISTANT,
            'text' => $text,
            'tools' => $answer['tools'] === [] ? null : $answer['tools'],
            'input_tokens' => $answer['input_tokens'],
            'output_tokens' => $answer['output_tokens'],
        ], $reply + ['found' => $answer['found']], 'ok', $language);

        return ['conversation_token' => $token, 'reply' => $reply, 'status' => 'ok', 'remaining_messages' => $remaining];
    }

    /**
     * The conversation of the token (last 20 messages, oldest first) for reopening the widget,
     * or an empty one when the token is unknown, expired or not this shopper's.
     *
     * @return array{conversation_token: ?string, messages: list<array<string, mixed>>, remaining_messages: int}
     */
    public function current(?string $customerId, ?string $token): array
    {
        $conversation = $token === null ? null : $this->find($token, $customerId, attach: false);
        if ($conversation === null) {
            return ['conversation_token' => null, 'messages' => [], 'remaining_messages' => self::MAX_SHOPPER_MESSAGES];
        }

        $messages = $conversation->messages()->orderByDesc('position')->limit(self::RECENT_MESSAGES)->get()->reverse()->values();
        $remaining = $conversation->status === AssistantConversation::CLOSED ? 0 : max(0, self::MAX_SHOPPER_MESSAGES - $this->shopperMessages($conversation));

        return [
            'conversation_token' => $token,
            'messages' => $messages->map(fn (AssistantMessage $m) => self::present($m))->all(),
            'remaining_messages' => $remaining,
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public static function present(AssistantMessage $message): array
    {
        $reply = $message->reply ?? [];
        $handoff = is_array($reply['handoff'] ?? null) ? $reply['handoff'] : null;

        // jsonb does not keep key order: the same shapes as the POST reply.
        return [
            'id' => $message->id,
            'role' => $message->role,
            'text' => $message->text,
            'products' => array_map(fn (array $p) => [
                'slug' => (string) ($p['slug'] ?? ''), 'name' => (string) ($p['name'] ?? ''), 'image_url' => $p['image_url'] ?? null,
                'price_text' => (string) ($p['price_text'] ?? ''), 'in_stock' => (bool) ($p['in_stock'] ?? false),
            ], array_values((array) ($reply['products'] ?? []))),
            'links' => array_map(fn (array $l) => ['label' => (string) ($l['label'] ?? ''), 'path' => (string) ($l['path'] ?? '')], array_values((array) ($reply['links'] ?? []))),
            'handoff' => $handoff === null ? null : ['type' => (string) ($handoff['type'] ?? ''), 'url' => (string) ($handoff['url'] ?? '')],
            'status' => $message->status,
            'created_at' => $message->created_at->toIso8601String(),
        ];
    }

    /**
     * @param  array<string, mixed>  $settings
     * @param  list<Message>  $history
     * @param  array{type: string, slug?: ?string}|null  $page
     * @return array{text: string, products: list<array<string, mixed>>, links: list<array{label: string, path: string}>, handoff: bool, tools: list<string>, found: list<string>, input_tokens: int, output_tokens: int}
     */
    private function answer(MeteredCall $metered, array $settings, ?string $customerId, AssistantConversation $conversation, array $history, string $message, ?array $page): array
    {
        $findings = $this->container->make(ShopperFindings::class);
        $tools = $this->container->make(ShopperToolbox::class)->forShopper($customerId, $findings);
        $loop = $this->container->make(ToolLoop::class);
        $organization = $this->organizations->summary($conversation->organization_id) ?? [];
        $timezone = (string) ($organization['timezone'] ?? config('app.timezone'));

        $system = ShopperPrompts::system(
            $settings['name'],
            $settings['store_name'] !== '' ? $settings['store_name'] : (string) ($organization['name'] ?? 'the store'),
            $settings['bangla_enabled'] ? LocaleContext::SUPPORTED : [LocaleContext::EN],
            CarbonImmutable::now($timezone)->toDateString(),
            $timezone,
            (string) ($organization['base_currency'] ?? config('pos.default_currency', 'BDT')),
            $settings['handoff'] !== 'none' && $settings['handoff_url'] !== null,
        );

        try {
            $result = $loop->run(new Conversation($system, [...$history, Message::user(ShopperPrompts::turn($message, $page))]), $tools, self::MAX_TOOL_ROUNDS, self::EFFORT, self::MAX_TOKENS);
        } finally {
            $metered->usage = $loop->consumed();
            $metered->tools = $loop->attempted();
        }
        $metered->model = $result->final->model;
        $toolNames = array_values(array_unique(array_column($result->toolsUsed, 'name')));
        $language = $this->locale->current();

        if ($result->final->stopReason === StopReason::Refusal) {
            $metered->status = 'refused';
            $metered->summary = 'shopper turn refused';
            $text = ShopperFallbacks::text(ShopperFallbacks::REFUSED, $language);

            return ['text' => $text, 'products' => [], 'links' => [], 'handoff' => false, 'tools' => $toolNames, 'found' => [],
                'input_tokens' => $result->usage->inputTokens, 'output_tokens' => $result->usage->outputTokens];
        }

        // Product cards: the products the tools returned in this turn, or — linked again from an
        // earlier turn of this conversation — still live.
        $raw = $result->final->text();
        $found = $findings->products();
        $cards = [];
        $earlier = $this->foundEarlier($conversation);
        $missing = [];
        foreach (ShopperReplyText::linkedSlugs($raw) as $slug) {
            if (isset($found[$slug])) {
                $cards[$slug] = $found[$slug];
            } elseif (in_array($slug, $earlier, true)) {
                $missing[] = $slug;
            }
        }
        if ($missing !== []) {
            $cards += $findings->cardsForSlugs($missing);
        }
        $links = $findings->links();
        $clean = ShopperReplyText::clean($raw, array_map('strval', array_keys($cards)), array_map('strval', array_keys($links)));
        $text = $clean['text'] !== '' ? $clean['text'] : ShopperFallbacks::text(ShopperFallbacks::EMPTY, $language);

        $products = [];
        foreach (array_slice($clean['slugs'], 0, self::MAX_PRODUCTS) as $slug) {
            $card = $cards[$slug];
            $products[] = ['slug' => (string) $card['slug'], 'name' => (string) $card['name'], 'image_url' => $card['image_url'] ?? null, 'price_text' => (string) $card['price_text'], 'in_stock' => (bool) $card['in_stock']];
        }
        $paths = $clean['paths'];
        if ($paths === []) {
            // Pages the tools found (help articles, the shopper's orders) even when the text does not link them.
            $paths = array_values(array_filter(array_map('strval', array_keys($links)), fn (string $p) => ShopperReplyText::productSlug($p) === null));
        }
        $replyLinks = array_map(fn (string $p) => ['label' => $links[$p] !== '' ? $links[$p] : $p, 'path' => $p], array_slice($paths, 0, self::MAX_LINKS));

        $metered->summary = sprintf('%d tool call(s), %d round(s), reply %d chars, %d card(s)', count($result->toolsUsed), $result->rounds, mb_strlen($text), count($products));

        return [
            'text' => $text,
            'products' => $products,
            'links' => $replyLinks,
            'handoff' => $clean['handoff'],
            'tools' => $toolNames,
            'found' => array_slice(array_map('strval', array_keys($found)), 0, 30),
            'input_tokens' => $result->usage->inputTokens,
            'output_tokens' => $result->usage->outputTokens,
        ];
    }

    /**
     * The token's conversation in this store, when the shopper may continue it: a signed-in
     * shopper's conversation only by that shopper; a guest conversation is taken over by the
     * shopper who signs in on the same browser.
     */
    private function find(string $token, ?string $customerId, bool $attach = true): ?AssistantConversation
    {
        $conversation = AssistantConversation::query()->where('token_hash', AssistantConversation::hashToken($token))->first();
        if ($conversation === null) {
            return null;
        }
        if ($conversation->customer_id !== null && $conversation->customer_id !== $customerId) {
            return null;
        }
        if ($attach && $conversation->customer_id === null && $customerId !== null) {
            $conversation->forceFill(['customer_id' => $customerId])->save();
        }

        return $conversation;
    }

    /**
     * Earlier text turns as history: pairs of a shopper message and its (answered) reply, the
     * last MAX_HISTORY messages. Fallback replies and their questions are left out.
     *
     * @return list<Message>
     */
    private function history(AssistantConversation $conversation): array
    {
        $rows = $conversation->messages()->orderByDesc('position')->limit(self::MAX_HISTORY * 3)->get(['role', 'text', 'status', 'position'])->reverse()->values();
        $pairs = [];
        $question = null;
        foreach ($rows as $row) {
            if ($row->role === AssistantMessage::USER) {
                $question = $row->text;
            } elseif ($question !== null && $row->status === 'ok' && trim($row->text) !== '') {
                $pairs[] = [Message::user($question), Message::assistant($row->text)];
                $question = null;
            } else {
                $question = null;
            }
        }

        return array_merge(...array_slice($pairs, -intdiv(self::MAX_HISTORY, 2)) ?: [[]]);
    }

    /**
     * Product slugs the tools returned in earlier turns of the conversation.
     *
     * @return list<string>
     */
    private function foundEarlier(AssistantConversation $conversation): array
    {
        $slugs = [];
        foreach ($conversation->messages()->where('role', AssistantMessage::ASSISTANT)->whereNotNull('reply')->pluck('reply') as $reply) {
            $reply = is_array($reply) ? $reply : (array) json_decode((string) $reply, true);
            foreach ((array) ($reply['found'] ?? []) as $slug) {
                $slugs[] = mb_strtolower((string) $slug);
            }
        }

        return array_values(array_unique($slugs));
    }

    private function shopperMessages(AssistantConversation $conversation): int
    {
        return $conversation->exists ? $conversation->messages()->where('role', AssistantMessage::USER)->count() : 0;
    }

    /**
     * New conversations of this store since the start of the store-local day.
     */
    private function startedToday(): int
    {
        $timezone = (string) ($this->organizations->summary($this->tenant->requireOrganization())['timezone'] ?? config('app.timezone'));

        return AssistantConversation::query()->where('started_at', '>=', CarbonImmutable::now($timezone)->startOfDay()->utc())->count();
    }

    /**
     * Appends a message (and, for a reply, its reply parts) and updates the conversation.
     *
     * @param  array<string, mixed>  $attributes  empty for a fallback reply (`$reply` holds it)
     * @param  array<string, mixed>|null  $reply
     */
    private function record(AssistantConversation $conversation, array $attributes, ?array $reply, string $status, string $language, bool $close = false): void
    {
        DB::transaction(function () use ($conversation, $attributes, $reply, $status, $language, $close) {
            $locked = AssistantConversation::query()->lockForUpdate()->findOrFail($conversation->id);
            $attributes = $attributes === [] ? ['role' => AssistantMessage::ASSISTANT, 'text' => (string) ($reply['text'] ?? '')] : $attributes;
            $stored = $reply;
            if ($stored !== null) {
                unset($stored['text']);
            }
            AssistantMessage::query()->create($attributes + [
                'conversation_id' => $locked->id,
                'position' => $locked->message_count + 1,
                'reply' => $stored,
                'status' => $status,
                'created_at' => now(),
            ]);
            $locked->forceFill([
                'message_count' => $locked->message_count + 1,
                'last_message_at' => now(),
                'language' => $language,
                'handed_off' => $locked->handed_off || ($reply['handoff'] ?? null) !== null,
                'status' => $close ? AssistantConversation::CLOSED : $locked->status,
            ])->save();
            $conversation->setRawAttributes($locked->getAttributes(), true);
        });
    }

    /**
     * A failed turn: the fixed reply is recorded after the shopper's message.
     *
     * @param  array<string, mixed>  $settings
     * @return array{conversation_token: ?string, reply: array{text: string, products: list<array<string, mixed>>, links: list<array{label: string, path: string}>, handoff: ?array{type: string, url: string}}, status: string, remaining_messages: int}
     */
    private function failed(AssistantConversation $conversation, string $token, string $kind, string $status, string $language, array $settings, int $remaining): array
    {
        $reply = $this->fallback($token, $kind, $status, $language, $settings, $conversation);
        $this->record($conversation, [], $reply['reply'], $status, $language);

        return ['remaining_messages' => $remaining] + $reply;
    }

    /**
     * @param  array<string, mixed>  $settings
     * @return array{conversation_token: ?string, reply: array{text: string, products: list<array<string, mixed>>, links: list<array{label: string, path: string}>, handoff: ?array{type: string, url: string}}, status: string, remaining_messages: int}
     */
    private function fallback(?string $token, string $kind, string $status, string $language, array $settings, ?AssistantConversation $conversation): array
    {
        $type = $settings['handoff'] === 'none' || $settings['handoff_url'] === null ? null : (string) $settings['handoff'];
        $handoff = $type === null ? null : $this->handoff($conversation, $settings);
        $remaining = match (true) {
            $kind === ShopperFallbacks::CONVERSATION_FULL => 0,
            $conversation === null => self::MAX_SHOPPER_MESSAGES,
            default => max(0, self::MAX_SHOPPER_MESSAGES - $this->shopperMessages($conversation)),
        };

        return [
            'conversation_token' => $token,
            'reply' => ['text' => ShopperFallbacks::text($kind, $language, $type), 'products' => [], 'links' => [], 'handoff' => $handoff],
            'status' => $status,
            'remaining_messages' => $remaining,
        ];
    }

    /**
     * The hand-off: the WhatsApp link with the conversation's first question prefilled, or the
     * contact page.
     *
     * @param  array<string, mixed>  $settings
     * @return array{type: string, url: string}|null
     */
    private function handoff(?AssistantConversation $conversation, array $settings): ?array
    {
        $url = $settings['handoff_url'];
        if ($settings['handoff'] === 'none' || ! is_string($url)) {
            return null;
        }
        if ($settings['handoff'] === 'whatsapp' && $conversation !== null && $conversation->exists) {
            $first = $conversation->messages()->where('role', AssistantMessage::USER)->orderBy('position')->value('text');
            if (is_string($first) && trim($first) !== '') {
                $url .= '?text='.rawurlencode(mb_substr(trim($first), 0, 200));
            }
        }

        return ['type' => (string) $settings['handoff'], 'url' => $url];
    }

    private static function newToken(): string
    {
        return rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
    }
}
