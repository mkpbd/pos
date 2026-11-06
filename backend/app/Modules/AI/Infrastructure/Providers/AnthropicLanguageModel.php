<?php

namespace App\Modules\AI\Infrastructure\Providers;

use App\Modules\AI\Domain\Contracts\LanguageModel;
use App\Modules\AI\Domain\Exceptions\AiUnavailable;
use App\Modules\AI\Domain\Llm\Completion;
use App\Modules\AI\Domain\Llm\CompletionOptions;
use App\Modules\AI\Domain\Llm\Conversation;
use App\Modules\AI\Domain\Llm\Message;
use App\Modules\AI\Domain\Llm\ProviderBlock;
use App\Modules\AI\Domain\Llm\StopReason;
use App\Modules\AI\Domain\Llm\TextBlock;
use App\Modules\AI\Domain\Llm\ToolCall;
use App\Modules\AI\Domain\Llm\ToolDefinition;
use App\Modules\AI\Domain\Llm\ToolResult;
use App\Modules\AI\Domain\Llm\Usage;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Factory as HttpFactory;
use Illuminate\Http\Client\Response;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Sleep;

/**
 * Claude over the Messages API (`POST /v1/messages`) with Laravel's HTTP client — no vendor SDK.
 *
 * Request: `x-api-key`, `anthropic-version` (2026-10-21 by default), JSON body with `model`,
 * `max_tokens`, `system`, `messages`, `tools` (name, description, input_schema),
 * `output_config.effort`, top-level `cache_control` (the system prompt and the tool list are the
 * stable prefix of a tool loop) and, unless disabled, `fallbacks: "default"` with the beta header
 * `server-side-fallback-2026-07-01` (a safety decline is retried server-side on the recommended
 * model). No sampling parameters (the 2026-10-21 version rejects them). A final round sends
 * `tool_choice: {type: none}`; forced tool choice is never used.
 *
 * Response: text and tool_use blocks become TextBlock / ToolCall; every other block (thinking,
 * redacted_thinking, …) is kept as an opaque ProviderBlock and sent back unchanged. After a
 * mid-output `fallback` block, the thinking / tool_use blocks before it are dropped (they belong
 * to the declined attempt), as the API requires when echoing the turn.
 *
 * Errors: 429, 5xx (incl. 529 overloaded) and connection failures/timeouts are retried with
 * exponential backoff (retry-after honoured, capped); then — and for any other status — the
 * call fails with AiUnavailable. The API key is never logged.
 */
final class AnthropicLanguageModel implements LanguageModel
{
    public const PROVIDER = 'anthropic';

    public const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

    /**
     * @param  array{base_url: string, version: string, max_tokens: int, effort: ?string, refusal_fallback: bool, max_retries: int, retry_base_ms: int, retry_max_ms: int}  $options
     */
    public function __construct(
        private readonly HttpFactory $http,
        private readonly string $apiKey,
        private readonly string $modelId,
        private readonly int $timeout,
        private readonly array $options,
    ) {}

    public function model(): string
    {
        return $this->modelId;
    }

    public function complete(Conversation $conversation, array $tools, CompletionOptions $options): Completion
    {
        $body = $this->body($conversation, $tools, $options);
        $headers = [
            'x-api-key' => $this->apiKey,
            'anthropic-version' => $this->options['version'],
            'content-type' => 'application/json',
        ];
        if ($this->options['refusal_fallback']) {
            $headers['anthropic-beta'] = self::FALLBACK_BETA;
        }

        $response = $this->send($headers, $body);

        return $this->parse((array) $response->json());
    }

    /**
     * The request body (public for tests and diagnostics; contains no credentials).
     *
     * @param  list<ToolDefinition>  $tools
     * @return array<string, mixed>
     */
    public function body(Conversation $conversation, array $tools, CompletionOptions $options): array
    {
        $body = [
            'model' => $this->modelId,
            'max_tokens' => $options->maxTokens ?? $this->options['max_tokens'],
            'system' => $conversation->system,
            'messages' => array_map(fn (Message $m) => $this->message($m), $conversation->messages),
            'cache_control' => ['type' => 'ephemeral'],
        ];
        if ($tools !== []) {
            $body['tools'] = array_map(fn (ToolDefinition $t) => [
                'name' => $t->name,
                'description' => $t->description,
                'input_schema' => self::schema($t->inputSchema),
            ], $tools);
            if (! $options->allowTools) {
                $body['tool_choice'] = ['type' => 'none'];
            }
        }
        if (($effort = $this->options['effort'] ?? null) !== null && $effort !== '') {
            $body['output_config'] = ['effort' => $effort];
        }
        if ($this->options['refusal_fallback']) {
            $body['fallbacks'] = 'default';
        }

        return $body;
    }

    /**
     * @param  array<string, mixed>  $headers
     * @param  array<string, mixed>  $body
     */
    private function send(array $headers, array $body): Response
    {
        $attempts = max(0, $this->options['max_retries']) + 1;
        for ($attempt = 1; ; $attempt++) {
            try {
                $response = $this->http->baseUrl(rtrim($this->options['base_url'], '/'))
                    ->withHeaders($headers)
                    ->acceptJson()
                    ->timeout($this->timeout)
                    ->connectTimeout(min(10, $this->timeout))
                    ->post('/v1/messages', $body);
            } catch (ConnectionException $e) {
                if ($attempt < $attempts) {
                    $this->backoff($attempt, null);

                    continue;
                }
                Log::warning('AI provider unreachable', ['provider' => self::PROVIDER, 'attempts' => $attempt, 'error' => self::redact($e->getMessage())]);

                throw new AiUnavailable('timeout', 'The AI service did not respond in time. Try again in a moment.');
            }

            if ($response->successful()) {
                return $response;
            }

            $status = $response->status();
            $retryable = $status === 429 || $status >= 500;
            if ($retryable && $attempt < $attempts) {
                $this->backoff($attempt, $response->header('retry-after'));

                continue;
            }

            Log::warning('AI provider error', [
                'provider' => self::PROVIDER,
                'status' => $status,
                'type' => $response->json('error.type'),
                'request_id' => $response->header('request-id'),
                'attempts' => $attempt,
            ]);

            throw new AiUnavailable(match (true) {
                $status === 429 => 'rate_limited',
                $status >= 500 => 'provider_error',
                $status === 401 || $status === 403 => 'provider_auth',
                default => 'provider_rejected',
            });
        }
    }

    private function backoff(int $attempt, ?string $retryAfter): void
    {
        $delay = $this->options['retry_base_ms'] * (2 ** ($attempt - 1));
        if ($retryAfter !== null && is_numeric($retryAfter)) {
            $delay = max($delay, (int) ((float) $retryAfter * 1000));
        }
        Sleep::for(min($delay, $this->options['retry_max_ms']))->milliseconds();
    }

    /**
     * @param  array<string, mixed>  $data
     */
    private function parse(array $data): Completion
    {
        $raw = is_array($data['content'] ?? null) ? array_values($data['content']) : [];
        $lastFallback = null;
        foreach ($raw as $i => $block) {
            if (($block['type'] ?? null) === 'fallback') {
                $lastFallback = $i;
            }
        }

        $content = [];
        foreach ($raw as $i => $block) {
            $type = (string) ($block['type'] ?? '');
            if ($type === 'fallback') {
                continue; // audit marker of a server-side fallback; not echoed
            }
            if ($lastFallback !== null && $i < $lastFallback && in_array($type, ['thinking', 'redacted_thinking', 'tool_use', 'server_tool_use'], true)) {
                continue; // belongs to the declined attempt
            }
            $content[] = match ($type) {
                'text' => new TextBlock((string) ($block['text'] ?? '')),
                'tool_use' => new ToolCall((string) ($block['id'] ?? ''), (string) ($block['name'] ?? ''), is_array($block['input'] ?? null) ? $block['input'] : []),
                default => new ProviderBlock(self::PROVIDER, (array) $block),
            };
        }

        $usage = (array) ($data['usage'] ?? []);

        return new Completion(
            new Message(Message::ASSISTANT, $content),
            match ($data['stop_reason'] ?? null) {
                'end_turn', 'stop_sequence' => StopReason::EndTurn,
                'tool_use' => StopReason::ToolUse,
                'max_tokens' => StopReason::MaxTokens,
                'refusal' => StopReason::Refusal,
                default => StopReason::Other,
            },
            new Usage(
                (int) ($usage['input_tokens'] ?? 0) + (int) ($usage['cache_creation_input_tokens'] ?? 0) + (int) ($usage['cache_read_input_tokens'] ?? 0),
                (int) ($usage['output_tokens'] ?? 0),
            ),
            (string) ($data['model'] ?? $this->modelId),
        );
    }

    /**
     * @return array<string, mixed>
     */
    private function message(Message $message): array
    {
        $blocks = [];
        foreach ($message->content as $block) {
            $blocks[] = match (true) {
                $block instanceof TextBlock => ['type' => 'text', 'text' => $block->text],
                $block instanceof ToolCall => ['type' => 'tool_use', 'id' => $block->id, 'name' => $block->name, 'input' => (object) $block->input],
                $block instanceof ToolResult => array_filter([
                    'type' => 'tool_result',
                    'tool_use_id' => $block->toolCallId,
                    'content' => $block->content,
                    'is_error' => $block->isError ?: null,
                ], fn ($v) => $v !== null),
                $block instanceof ProviderBlock => $block->raw,
            };
        }

        return ['role' => $message->role, 'content' => $blocks];
    }

    /**
     * JSON schema with empty `properties` encoded as an object.
     *
     * @param  array<string, mixed>  $schema
     * @return array<string, mixed>
     */
    private static function schema(array $schema): array
    {
        if (array_key_exists('properties', $schema) && $schema['properties'] === []) {
            $schema['properties'] = (object) [];
        }

        return $schema;
    }

    private static function redact(string $message): string
    {
        return mb_substr(preg_replace('/sk-[A-Za-z0-9_\-]+/', '[redacted]', $message) ?? '', 0, 300);
    }
}
