<?php

namespace App\Modules\AI\Application\Assistants;

use App\Modules\AI\Infrastructure\Models\AssistantConversation;
use App\Modules\AI\Infrastructure\Models\AssistantMessage;
use App\Modules\Customers\Application\Contracts\CustomerDirectory;
use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

/**
 * AI2b: the shopper assistant's conversations for staff (storefront.manage) — list, transcript
 * and summary of the current organization. Customer names only for holders of customers.view.
 * Conversations are kept for 30 days.
 */
final class ShopperConversations
{
    public const PREVIEW_LENGTH = 80;

    public function __construct(
        private readonly TenantContext $tenant,
        private readonly OrganizationDirectory $organizations,
        private readonly CustomerDirectory $customers,
    ) {}

    /**
     * @param  array{search?: ?string, from?: ?string, to?: ?string, handed_off?: mixed}  $filters
     * @return LengthAwarePaginator<int, AssistantConversation>
     */
    public function list(array $filters, int $perPage): LengthAwarePaginator
    {
        $query = AssistantConversation::query();
        $this->period($query, $filters['from'] ?? null, $filters['to'] ?? null);
        if (isset($filters['handed_off']) && $filters['handed_off'] !== '') {
            $query->where('handed_off', filter_var($filters['handed_off'], FILTER_VALIDATE_BOOLEAN));
        }
        $search = trim((string) ($filters['search'] ?? ''));
        if ($search !== '') {
            $like = '%'.addcslashes(mb_strtolower($search), '\\%_').'%';
            $query->whereExists(fn ($q) => $q->select(DB::raw(1))->from('assistant_messages')
                ->whereColumn('assistant_messages.conversation_id', 'assistant_conversations.id')
                ->whereRaw('lower(assistant_messages.text) like ?', [$like]));
        }

        return $query->orderByDesc('started_at')->orderByDesc('id')->paginate($perPage);
    }

    public function find(string $id): ?AssistantConversation
    {
        return AssistantConversation::query()->whereKey($id)->first();
    }

    /**
     * @param  list<AssistantConversation>  $conversations
     * @return list<array<string, mixed>>
     */
    public function rows(array $conversations, bool $withNames): array
    {
        $ids = array_map(fn (AssistantConversation $c) => $c->id, $conversations);
        $previews = $ids === [] ? [] : AssistantMessage::query()
            ->whereIn('conversation_id', $ids)->where('role', AssistantMessage::USER)
            ->orderBy('conversation_id')->orderBy('position')
            ->get(['conversation_id', 'text', 'position'])
            ->unique('conversation_id')->pluck('text', 'conversation_id')->all();
        $customerIds = array_values(array_unique(array_filter(array_map(fn (AssistantConversation $c) => $c->customer_id, $conversations))));
        $names = $withNames && $customerIds !== [] ? $this->customers->summaries($this->tenant->requireOrganization(), $customerIds) : [];

        return array_map(fn (AssistantConversation $c) => [
            'id' => $c->id,
            'started_at' => $c->started_at->toIso8601String(),
            'last_message_at' => $c->last_message_at->toIso8601String(),
            'language' => $c->language,
            'signed_in' => $c->customer_id !== null,
            'customer_name' => $c->customer_id === null ? null : ($names[$c->customer_id]['name'] ?? null),
            'message_count' => $c->message_count,
            'handed_off' => $c->handed_off,
            'status' => $c->status,
            'preview' => isset($previews[$c->id]) ? self::preview((string) $previews[$c->id]) : null,
        ], $conversations);
    }

    /**
     * @return array<string, mixed>
     */
    public function transcript(AssistantConversation $conversation, bool $withNames): array
    {
        $messages = $conversation->messages()->orderBy('position')->get();

        return $this->rows([$conversation], $withNames)[0] + [
            'messages' => $messages->map(fn (AssistantMessage $m) => [
                'id' => $m->id,
                'role' => $m->role,
                'text' => $m->text,
                'tools' => array_values($m->tools ?? []),
                'status' => $m->status,
                'created_at' => $m->created_at->toIso8601String(),
            ])->all(),
        ];
    }

    /**
     * Conversations started in the period (store-local dates, default the last 30 days) and
     * their messages: counts, the share handed off, fallback replies by kind and the most used
     * tools.
     *
     * @return array{from: string, to: string, conversations: int, messages: int, handed_off: int, handed_off_share: float, unavailable: int, limit: int, budget: int, top_tools: list<array{name: string, count: int}>}
     */
    public function summary(?string $from, ?string $to): array
    {
        $today = CarbonImmutable::now($this->timezone())->toDateString();
        $to ??= $today;
        $from ??= CarbonImmutable::parse($to)->subDays(29)->toDateString();

        $conversations = AssistantConversation::query();
        $this->period($conversations, $from, $to);
        $totals = (clone $conversations)->toBase()
            ->selectRaw('count(*) as conversations, coalesce(sum(message_count), 0) as messages, coalesce(sum(case when handed_off then 1 else 0 end), 0) as handed_off')
            ->first();
        $count = (int) ($totals->conversations ?? 0);
        $handedOff = (int) ($totals->handed_off ?? 0);

        $ids = (clone $conversations)->select('id');
        $statuses = AssistantMessage::query()->whereIn('conversation_id', $ids)->where('role', AssistantMessage::ASSISTANT)
            ->whereIn('status', ['unavailable', 'limit', 'budget'])
            ->toBase()->selectRaw('status, count(*) as total')->groupBy('status')->pluck('total', 'status')->all();

        $tools = [];
        foreach (AssistantMessage::query()->whereIn('conversation_id', $ids)->whereNotNull('tools')->pluck('tools') as $names) {
            $names = is_array($names) ? $names : (array) json_decode((string) $names, true);
            foreach ($names as $name) {
                $tools[(string) $name] = ($tools[(string) $name] ?? 0) + 1;
            }
        }
        // Most used first, then by name.
        uksort($tools, fn ($a, $b) => [$tools[$b], (string) $a] <=> [$tools[$a], (string) $b]);
        $top = [];
        foreach (array_slice($tools, 0, 5, true) as $name => $n) {
            $top[] = ['name' => (string) $name, 'count' => $n];
        }

        return [
            'from' => $from,
            'to' => $to,
            'conversations' => $count,
            'messages' => (int) ($totals->messages ?? 0),
            'handed_off' => $handedOff,
            'handed_off_share' => $count === 0 ? 0.0 : round($handedOff / $count, 2),
            'unavailable' => (int) ($statuses['unavailable'] ?? 0),
            'limit' => (int) ($statuses['limit'] ?? 0),
            'budget' => (int) ($statuses['budget'] ?? 0),
            'top_tools' => $top,
        ];
    }

    /**
     * @param  Builder<AssistantConversation>  $query
     */
    private function period(Builder $query, ?string $from, ?string $to): void
    {
        $timezone = $this->timezone();
        if ($from !== null && $from !== '') {
            $query->where('started_at', '>=', CarbonImmutable::parse($from, $timezone)->startOfDay()->utc());
        }
        if ($to !== null && $to !== '') {
            $query->where('started_at', '<', CarbonImmutable::parse($to, $timezone)->addDay()->startOfDay()->utc());
        }
    }

    private function timezone(): string
    {
        $timezone = $this->organizations->summary($this->tenant->requireOrganization())['timezone'] ?? null;

        return is_string($timezone) && $timezone !== '' ? $timezone : (string) config('app.timezone');
    }

    private static function preview(string $text): string
    {
        $text = trim((string) preg_replace('/\s+/u', ' ', $text));

        return mb_strlen($text) > self::PREVIEW_LENGTH ? rtrim(mb_substr($text, 0, self::PREVIEW_LENGTH - 1)).'…' : $text;
    }
}
