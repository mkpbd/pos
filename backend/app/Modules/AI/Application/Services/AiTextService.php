<?php

namespace App\Modules\AI\Application\Services;

use App\Modules\AI\Domain\Contracts\LanguageModel;
use App\Modules\AI\Domain\Exceptions\AiBudgetExceeded;
use App\Modules\AI\Domain\Exceptions\AiUnavailable;
use App\Modules\AI\Domain\Llm\CompletionOptions;
use App\Modules\AI\Domain\Llm\Conversation;
use App\Modules\AI\Domain\Llm\Message;
use App\Modules\AI\Domain\Llm\StopReason;
use App\Modules\Shared\Application\Contracts\AiTextWriter;

/**
 * P2b: Shared's AiTextWriter — one model call without tools for another module (social
 * captions), through the gate, the budget check and the usage log (AiRunner). The prompt and
 * the answer are never stored; the usage row keeps the feature, tokens and the answer's length.
 */
final class AiTextService implements AiTextWriter
{
    public function __construct(
        private readonly AiRunner $runner,
        private readonly AiGate $gate,
        private readonly LanguageModel $model,
    ) {}

    public function write(string $organizationId, ?string $userId, string $feature, string $system, string $prompt, int $maxTokens = 1000): array
    {
        if (! $this->gate->enabledFor($organizationId)) {
            return ['text' => null, 'status' => 'disabled'];
        }

        try {
            return $this->runner->run($organizationId, $userId, $feature, function (MeteredCall $metered) use ($system, $prompt, $maxTokens) {
                $completion = $this->model->complete(
                    new Conversation($system, [Message::user($prompt)]),
                    [],
                    new CompletionOptions(maxTokens: $maxTokens),
                );
                $metered->usage = $completion->usage;
                $metered->model = $completion->model;
                $text = trim($completion->text());
                $status = match (true) {
                    $completion->stopReason === StopReason::Refusal => 'refused',
                    $text === '' => 'empty',
                    default => 'ok',
                };
                $metered->status = $status === 'refused' ? 'refused' : 'ok';
                $metered->summary = 'text '.mb_strlen($text).' chars';

                return ['text' => $status === 'ok' ? $text : null, 'status' => $status];
            });
        } catch (AiBudgetExceeded) {
            return ['text' => null, 'status' => 'budget_exceeded'];
        } catch (AiUnavailable $e) {
            return ['text' => null, 'status' => $e->reason === 'disabled' ? 'disabled' : 'unavailable'];
        }
    }
}
