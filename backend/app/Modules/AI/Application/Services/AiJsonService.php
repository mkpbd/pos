<?php

namespace App\Modules\AI\Application\Services;

use App\Modules\AI\Domain\Contracts\LanguageModel;
use App\Modules\AI\Domain\Exceptions\AiBudgetExceeded;
use App\Modules\AI\Domain\Exceptions\AiUnavailable;
use App\Modules\AI\Domain\Llm\CompletionOptions;
use App\Modules\AI\Domain\Llm\Conversation;
use App\Modules\AI\Domain\Llm\Message;
use App\Modules\AI\Domain\Llm\StopReason;
use App\Modules\Shared\Application\Contracts\AiJsonWriter;

/**
 * AI2a: Shared's AiJsonWriter — one model call without tools that must answer with JSON
 * following a schema (structured output), through the gate, the budget check and the usage log
 * (AiRunner). The prompt and the answer are never stored; the usage row keeps the feature,
 * tokens and the number of values in the answer.
 */
final class AiJsonService implements AiJsonWriter
{
    public function __construct(
        private readonly AiRunner $runner,
        private readonly AiGate $gate,
        private readonly LanguageModel $model,
    ) {}

    public function write(string $organizationId, ?string $userId, string $feature, string $system, string $prompt, array $schema, int $maxTokens = 2000): array
    {
        if (! $this->gate->enabledFor($organizationId)) {
            return ['status' => 'disabled', 'data' => null];
        }

        try {
            return $this->runner->run($organizationId, $userId, $feature, function (MeteredCall $metered) use ($system, $prompt, $schema, $maxTokens) {
                $completion = $this->model->complete(
                    new Conversation($system, [Message::user($prompt)]),
                    [],
                    new CompletionOptions(maxTokens: $maxTokens, outputSchema: $schema),
                );
                $metered->usage = $completion->usage;
                $metered->model = $completion->model;
                $text = trim($completion->text());

                if ($completion->stopReason === StopReason::Refusal) {
                    $metered->status = 'refused';
                    $metered->summary = 'json refused';

                    return ['status' => 'refused', 'data' => null];
                }
                if ($completion->stopReason === StopReason::MaxTokens) {
                    $metered->summary = 'json cut off at the token limit';

                    return ['status' => 'invalid', 'data' => null];
                }
                if ($text === '') {
                    $metered->summary = 'json empty';

                    return ['status' => 'empty', 'data' => null];
                }
                $data = self::decode($text);
                if ($data === null) {
                    $metered->summary = 'json invalid ('.mb_strlen($text).' chars)';

                    return ['status' => 'invalid', 'data' => null];
                }
                $metered->summary = 'json '.count($data).' field(s), '.self::values($data).' value(s)';

                return $data === [] ? ['status' => 'empty', 'data' => null] : ['status' => 'ok', 'data' => $data];
            });
        } catch (AiBudgetExceeded) {
            return ['status' => 'budget_exceeded', 'data' => null];
        } catch (AiUnavailable $e) {
            return ['status' => $e->reason === 'disabled' ? 'disabled' : 'unavailable', 'data' => null];
        }
    }

    /**
     * The answer as an associative array, or null when it is not a JSON object. A provider
     * without structured output may wrap the JSON in prose or a code fence: the outermost
     * braces are tried as well.
     *
     * @return array<string, mixed>|null
     */
    private static function decode(string $text): ?array
    {
        $candidates = [$text];
        $start = strpos($text, '{');
        $end = strrpos($text, '}');
        if ($start !== false && $end !== false && $end > $start && ($start > 0 || $end < strlen($text) - 1)) {
            $candidates[] = substr($text, $start, $end - $start + 1);
        }
        foreach ($candidates as $candidate) {
            $value = json_decode($candidate, false, 64);
            if ($value instanceof \stdClass) {
                return (array) json_decode($candidate, true, 64);
            }
        }

        return null;
    }

    /**
     * Number of scalar values in the answer (for the usage summary).
     *
     * @param  array<array-key, mixed>  $data
     */
    private static function values(array $data): int
    {
        $count = 0;
        array_walk_recursive($data, function () use (&$count) {
            $count++;
        });

        return $count;
    }
}
