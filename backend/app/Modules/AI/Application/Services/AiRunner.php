<?php

namespace App\Modules\AI\Application\Services;

use App\Modules\AI\Domain\Contracts\LanguageModel;
use App\Modules\AI\Domain\Exceptions\AiBudgetExceeded;
use App\Modules\AI\Domain\Exceptions\AiUnavailable;
use Closure;
use Throwable;

/**
 * Every model-backed request goes through here: AI must be on (app + organization, else 503
 * AI_UNAVAILABLE, nothing logged), the monthly budget must not be used up (else 429
 * AI_BUDGET_EXCEEDED, logged as failed), then the call runs and its usage row is written — also
 * when it fails (status `failed`, error code = the AiUnavailable reason).
 */
final class AiRunner
{
    public function __construct(
        private readonly AiGate $gate,
        private readonly UsageMeter $meter,
        private readonly AiRequestLog $log,
        private readonly LanguageModel $model,
    ) {}

    /**
     * @template T
     *
     * @param  Closure(MeteredCall): T  $call
     * @return T
     */
    public function run(string $organizationId, ?string $userId, string $feature, Closure $call): mixed
    {
        $this->gate->require($organizationId);
        $metered = new MeteredCall($this->model->model());
        $started = hrtime(true);
        $elapsed = fn () => (int) ((hrtime(true) - $started) / 1_000_000);

        try {
            $this->meter->assertWithinBudget($organizationId);
            $result = $call($metered);
        } catch (Throwable $e) {
            $code = match (true) {
                $e instanceof AiUnavailable => $e->reason,
                $e instanceof AiBudgetExceeded => 'AI_BUDGET_EXCEEDED',
                default => 'error',
            };
            $this->log->record($organizationId, $userId, $feature, 'failed', $metered->usage, $metered->model, $elapsed(), $metered->tools, $code, $metered->summary);

            throw $e;
        }

        $this->log->record($organizationId, $userId, $feature, $metered->status, $metered->usage, $metered->model, $elapsed(), $metered->tools, null, $metered->summary);

        return $result;
    }
}
