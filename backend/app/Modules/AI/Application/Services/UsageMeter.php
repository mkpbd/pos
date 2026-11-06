<?php

namespace App\Modules\AI\Application\Services;

use App\Modules\AI\Application\Support\Figures;
use App\Modules\AI\Domain\Exceptions\AiBudgetExceeded;
use App\Modules\AI\Infrastructure\Models\AiRequest;
use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use Carbon\CarbonImmutable;

/**
 * Monthly token usage per organization (calendar month in the organization's timezone, from
 * `ai_requests`) and the budget check made before every model call: when the month's input +
 * output tokens reach the budget (organization override or AI_MONTHLY_TOKEN_BUDGET; 0 =
 * unlimited) further calls fail with 429 AI_BUDGET_EXCEEDED until the month changes. The check
 * runs before a request, so one request may finish slightly above the budget.
 */
final class UsageMeter
{
    public function __construct(
        private readonly AiSettingsService $settings,
        private readonly OrganizationDirectory $organizations,
    ) {}

    /**
     * @throws AiBudgetExceeded
     */
    public function assertWithinBudget(string $organizationId): void
    {
        ['budget' => $budget] = $this->settings->budget($organizationId);
        if ($budget === 0) {
            return;
        }
        [$from, $to, $month] = $this->bounds($organizationId);
        $used = $this->tokens($organizationId, $from, $to);
        if ($used >= $budget) {
            throw new AiBudgetExceeded($budget, $used, $month);
        }
    }

    /**
     * Usage of one month (`Y-m`, default the current month of the organization).
     *
     * @return array<string, mixed>
     */
    public function month(string $organizationId, ?string $month = null): array
    {
        [$from, $to, $month] = $this->bounds($organizationId, $month);
        ['budget' => $budget, 'source' => $source] = $this->settings->budget($organizationId);

        $rows = AiRequest::query()->withoutGlobalScope('organization')
            ->where('organization_id', $organizationId)
            ->where('created_at', '>=', $from)
            ->where('created_at', '<', $to)
            ->groupBy('feature')
            ->selectRaw("feature, COUNT(*) as requests, SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed, SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens")
            ->orderBy('feature')
            ->toBase()
            ->get();

        $byFeature = $rows->map(fn ($r) => [
            'feature' => (string) $r->feature,
            'requests' => (int) $r->requests,
            'failed' => (int) $r->failed,
            'input_tokens' => (int) $r->input_tokens,
            'output_tokens' => (int) $r->output_tokens,
            'tokens' => (int) $r->input_tokens + (int) $r->output_tokens,
        ])->values()->all();
        $input = array_sum(array_column($byFeature, 'input_tokens'));
        $output = array_sum(array_column($byFeature, 'output_tokens'));
        $used = $input + $output;

        return [
            'month' => $month,
            'budget' => $budget,
            'budget_source' => $source,
            'unlimited' => $budget === 0,
            'used_tokens' => $used,
            'input_tokens' => $input,
            'output_tokens' => $output,
            'remaining_tokens' => $budget === 0 ? null : max(0, $budget - $used),
            'used_pct' => $budget === 0 ? null : Figures::percent((string) $used, (string) $budget),
            'requests' => array_sum(array_column($byFeature, 'requests')),
            'failed_requests' => array_sum(array_column($byFeature, 'failed')),
            'by_feature' => $byFeature,
        ];
    }

    /**
     * @return array{0: CarbonImmutable, 1: CarbonImmutable, 2: string} UTC bounds and the `Y-m` label
     */
    private function bounds(string $organizationId, ?string $month = null): array
    {
        $timezone = $this->organizations->summary($organizationId)['timezone'] ?? null;
        $timezone = is_string($timezone) && $timezone !== '' ? $timezone : (string) config('app.timezone');
        $start = $month === null
            ? CarbonImmutable::now($timezone)->startOfMonth()
            : CarbonImmutable::createFromFormat('!Y-m', $month, $timezone)->startOfMonth();

        return [$start->utc(), $start->addMonth()->utc(), $start->format('Y-m')];
    }

    private function tokens(string $organizationId, CarbonImmutable $from, CarbonImmutable $to): int
    {
        $row = AiRequest::query()->withoutGlobalScope('organization')
            ->where('organization_id', $organizationId)
            ->where('created_at', '>=', $from)
            ->where('created_at', '<', $to)
            ->toBase()
            ->selectRaw('COALESCE(SUM(input_tokens), 0) + COALESCE(SUM(output_tokens), 0) as used')
            ->first();

        return (int) ($row->used ?? 0);
    }
}
