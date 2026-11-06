<?php

namespace App\Modules\AI\Application\Services;

use App\Modules\AI\Domain\Contracts\LanguageModel;
use App\Modules\AI\Domain\Exceptions\AiBudgetExceeded;
use App\Modules\AI\Domain\Exceptions\AiUnavailable;
use App\Modules\AI\Domain\Llm\CompletionOptions;
use App\Modules\AI\Domain\Llm\Conversation;
use App\Modules\AI\Domain\Llm\Message;
use App\Modules\AI\Domain\Llm\StopReason;
use App\Modules\AI\Domain\Llm\Usage;
use JsonException;

/**
 * One model call that turns deterministic facts (JSON) into a short narrative, without tools.
 * For pages whose facts stand on their own (insights, customer insights), a missing narrative is
 * not an error: write() never throws for an unavailable provider or a used-up budget — it
 * returns `narrative: null` with the reason in `status` (ok | disabled | unavailable |
 * budget_exceeded | refused | empty). require() is the strict variant (explain-reorder).
 */
final class NarrativeWriter
{
    public function __construct(
        private readonly AiRunner $runner,
        private readonly AiGate $gate,
        private readonly LanguageModel $model,
    ) {}

    /**
     * @param  array<string, mixed>  $facts
     * @return array{narrative: ?string, status: string, model: ?string, usage: Usage}
     */
    public function write(string $organizationId, ?string $userId, string $feature, string $system, array $facts, int $maxTokens = 2000): array
    {
        if (! $this->gate->enabledFor($organizationId)) {
            return ['narrative' => null, 'status' => 'disabled', 'model' => null, 'usage' => new Usage];
        }
        try {
            return $this->require($organizationId, $userId, $feature, $system, $facts, $maxTokens);
        } catch (AiBudgetExceeded) {
            return ['narrative' => null, 'status' => 'budget_exceeded', 'model' => null, 'usage' => new Usage];
        } catch (AiUnavailable $e) {
            return ['narrative' => null, 'status' => $e->reason === 'disabled' ? 'disabled' : 'unavailable', 'model' => null, 'usage' => new Usage];
        }
    }

    /**
     * @param  array<string, mixed>  $facts
     * @return array{narrative: ?string, status: string, model: ?string, usage: Usage}
     *
     * @throws AiUnavailable|AiBudgetExceeded
     */
    public function require(string $organizationId, ?string $userId, string $feature, string $system, array $facts, int $maxTokens = 2000): array
    {
        return $this->runner->run($organizationId, $userId, $feature, function (MeteredCall $metered) use ($system, $facts, $maxTokens) {
            $completion = $this->model->complete(
                new Conversation($system, [Message::user("Facts (JSON):\n".self::json($facts))]),
                [],
                new CompletionOptions(maxTokens: $maxTokens),
            );
            $metered->usage = $completion->usage;
            $metered->model = $completion->model;
            $text = $completion->text();
            $status = match (true) {
                $completion->stopReason === StopReason::Refusal => 'refused',
                $text === '' => 'empty',
                default => 'ok',
            };
            $metered->status = $status === 'refused' ? 'refused' : 'ok';
            $metered->summary = 'narrative '.mb_strlen($text).' chars';

            return ['narrative' => $status === 'ok' ? $text : null, 'status' => $status, 'model' => $completion->model, 'usage' => $completion->usage];
        });
    }

    /**
     * @param  array<string, mixed>  $data
     */
    public static function json(array $data): string
    {
        try {
            return json_encode($data, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
        } catch (JsonException) {
            return '{}';
        }
    }
}
