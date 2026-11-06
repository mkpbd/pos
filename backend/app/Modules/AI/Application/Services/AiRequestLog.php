<?php

namespace App\Modules\AI\Application\Services;

use App\Modules\AI\Domain\Llm\Usage;
use App\Modules\AI\Infrastructure\Models\AiRequest;

/**
 * Writes the usage / audit row of one AI request. Only metadata: the feature, the report keys
 * or tools used with their validated parameters, tokens, model, outcome, duration and a short
 * redacted summary. Questions, answers, prompts and result rows are never stored.
 */
final class AiRequestLog
{
    public const FEATURES = ['ask', 'explain_reorder', 'insights', 'daily_insights', 'customer_insights'];

    /**
     * @param  list<array{name: string, params: array<string, mixed>, ok: bool}>  $tools
     */
    public function record(
        string $organizationId,
        ?string $userId,
        string $feature,
        string $status,
        Usage $usage,
        ?string $model,
        int $durationMs,
        array $tools = [],
        ?string $errorCode = null,
        ?string $summary = null,
    ): AiRequest {
        $names = array_values(array_unique(array_column($tools, 'name')));

        return AiRequest::query()->withoutGlobalScope('organization')->create([
            'organization_id' => $organizationId,
            'user_id' => $userId,
            'feature' => $feature,
            'intent' => $names === [] ? null : mb_substr(implode(',', $names), 0, 255),
            'params' => $tools === [] ? null : array_map(fn (array $t) => ['tool' => $t['name'], 'params' => $t['params'], 'ok' => $t['ok']], array_slice($tools, 0, 20)),
            'input_tokens' => $usage->inputTokens,
            'output_tokens' => $usage->outputTokens,
            'model' => $model,
            'status' => $status,
            'duration_ms' => max(0, $durationMs),
            'error_code' => $errorCode === null ? null : mb_substr($errorCode, 0, 50),
            'summary' => $summary === null ? null : mb_substr($summary, 0, 255),
            'created_at' => now(),
        ]);
    }
}
