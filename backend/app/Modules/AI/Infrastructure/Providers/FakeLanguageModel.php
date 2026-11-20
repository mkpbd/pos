<?php

namespace App\Modules\AI\Infrastructure\Providers;

use App\Modules\AI\Domain\Contracts\LanguageModel;
use App\Modules\AI\Domain\Exceptions\AiUnavailable;
use App\Modules\AI\Domain\Llm\Completion;
use App\Modules\AI\Domain\Llm\CompletionOptions;
use App\Modules\AI\Domain\Llm\Conversation;
use App\Modules\AI\Domain\Llm\Message;
use App\Modules\AI\Domain\Llm\StopReason;
use App\Modules\AI\Domain\Llm\TextBlock;
use App\Modules\AI\Domain\Llm\ToolCall;
use App\Modules\AI\Domain\Llm\ToolDefinition;
use App\Modules\AI\Domain\Llm\Usage;
use Closure;
use RuntimeException;

/**
 * Scripted model for tests (and AI_PROVIDER=fake outside production): each call takes the next
 * scripted reply — a text answer, a JSON answer, tool calls, an exception or a closure that
 * builds a Completion from the conversation. Every request is recorded so tests can assert what
 * the model was shown (tools, tool results, prompts).
 *
 * AI2a: with nothing scripted, a call that asks for structured output (CompletionOptions
 * outputSchema) gets a deterministic answer synthesized from the schema — strings
 * `"Sample <property>"`, the first enum / const value, one item per array, numbers 1, booleans
 * true — so AI_PROVIDER=fake works end to end; other calls get the fallback text.
 */
final class FakeLanguageModel implements LanguageModel
{
    /** @var list<Completion|Closure(Conversation, list<ToolDefinition>, CompletionOptions): Completion|\Throwable> */
    private array $script = [];

    /** @var list<array{conversation: Conversation, tools: list<ToolDefinition>, options: CompletionOptions}> */
    public array $requests = [];

    private int $calls = 0;

    public function __construct(private readonly string $fallbackAnswer = 'This is a test answer.') {}

    public function model(): string
    {
        return 'fake-model';
    }

    /** Replies with text (end of turn). */
    public function answer(string $text, int $inputTokens = 100, int $outputTokens = 20): self
    {
        $this->script[] = self::completion([new TextBlock($text)], StopReason::EndTurn, $inputTokens, $outputTokens);

        return $this;
    }

    /**
     * AI2a: replies with a JSON document (a structured answer), encoded as the provider sends it.
     *
     * @param  array<array-key, mixed>  $data
     */
    public function answerJson(array $data, int $inputTokens = 100, int $outputTokens = 20): self
    {
        return $this->answer((string) json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), $inputTokens, $outputTokens);
    }

    /**
     * Replies with tool calls.
     *
     * @param  array<string, array<string, mixed>>|list<array{0: string, 1: array<string, mixed>}>  $calls  [name, input] pairs
     */
    public function callTools(array $calls, int $inputTokens = 100, int $outputTokens = 20, string $preamble = ''): self
    {
        $blocks = $preamble === '' ? [] : [new TextBlock($preamble)];
        foreach (array_values($calls) as $i => [$name, $input]) {
            $blocks[] = new ToolCall('toolu_fake_'.(count($this->script) + 1).'_'.$i, $name, $input);
        }
        $this->script[] = self::completion($blocks, StopReason::ToolUse, $inputTokens, $outputTokens);

        return $this;
    }

    public function refuse(): self
    {
        $this->script[] = self::completion([], StopReason::Refusal, 50, 0);

        return $this;
    }

    public function fail(?\Throwable $error = null): self
    {
        $this->script[] = $error ?? new AiUnavailable('provider_error');

        return $this;
    }

    /**
     * @param  Closure(Conversation, list<ToolDefinition>, CompletionOptions): Completion  $reply
     */
    public function reply(Closure $reply): self
    {
        $this->script[] = $reply;

        return $this;
    }

    public function complete(Conversation $conversation, array $tools, CompletionOptions $options): Completion
    {
        $this->requests[] = ['conversation' => $conversation, 'tools' => $tools, 'options' => $options];
        $next = $this->script[$this->calls++] ?? null;

        if ($next === null) {
            $text = $options->outputSchema !== null
                ? (string) json_encode(self::synthesize($options->outputSchema), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
                : $this->fallbackAnswer;

            return self::completion([new TextBlock($text)], StopReason::EndTurn, 100, 20);
        }
        if ($next instanceof \Throwable) {
            throw $next;
        }
        if ($next instanceof Closure) {
            $result = $next($conversation, $tools, $options);
            if (! $result instanceof Completion) {
                throw new RuntimeException('A scripted reply must return a Completion.');
            }

            return $result;
        }

        return $next;
    }

    public function callCount(): int
    {
        return count($this->requests);
    }

    /**
     * A deterministic value that follows a JSON schema (the subset structured outputs accept).
     *
     * @param  array<string, mixed>  $schema
     */
    public static function synthesize(array $schema, string $name = 'value'): mixed
    {
        if (array_key_exists('const', $schema)) {
            return $schema['const'];
        }
        if (is_array($schema['enum'] ?? null) && $schema['enum'] !== []) {
            return array_values($schema['enum'])[0];
        }
        foreach (['anyOf', 'oneOf', 'allOf'] as $key) {
            if (is_array($schema[$key] ?? null) && $schema[$key] !== []) {
                $first = array_values($schema[$key])[0];

                return is_array($first) ? self::synthesize($first, $name) : null;
            }
        }
        $type = $schema['type'] ?? (isset($schema['properties']) ? 'object' : 'string');
        if (is_array($type)) {
            $types = array_values(array_filter($type, fn ($t) => $t !== 'null'));
            $type = $types[0] ?? 'null';
        }

        return match ($type) {
            'object' => self::object($schema),
            'array' => [is_array($schema['items'] ?? null) ? self::synthesize($schema['items'], $name) : 'Sample '.$name],
            'integer', 'number' => 1,
            'boolean' => true,
            'null' => null,
            default => 'Sample '.$name,
        };
    }

    /**
     * @param  array<string, mixed>  $schema
     */
    private static function object(array $schema): object
    {
        $result = [];
        foreach ((array) ($schema['properties'] ?? []) as $key => $property) {
            $result[(string) $key] = is_array($property) ? self::synthesize($property, (string) $key) : null;
        }

        return (object) $result;
    }

    /**
     * @param  list<TextBlock|ToolCall>  $blocks
     */
    public static function completion(array $blocks, StopReason $stop, int $inputTokens, int $outputTokens): Completion
    {
        return new Completion(new Message(Message::ASSISTANT, $blocks), $stop, new Usage($inputTokens, $outputTokens), 'fake-model');
    }
}
