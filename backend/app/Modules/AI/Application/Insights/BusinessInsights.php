<?php

namespace App\Modules\AI\Application\Insights;

use App\Modules\AI\Application\Assistants\Prompts;
use App\Modules\AI\Application\Services\AiGate;
use App\Modules\AI\Application\Services\NarrativeWriter;
use App\Modules\AI\Application\Support\InsightsReader;
use App\Modules\AI\Infrastructure\Models\AiInsight;
use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Organizations\Application\Support\OrganizationDate;
use App\Modules\Shared\Application\Contracts\TenantUser;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Auth\Access\Authorizable;
use Illuminate\Contracts\Cache\Repository as Cache;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Business insights: InsightsCalculator's facts plus the model's narrative of them (null when AI
 * is off — the facts are always returned).
 *
 * Cache: insights of a whole scope — the organization (users with every branch) or one branch —
 * are stored in `ai_insights`, one row per organization × scope × period × day × cost visibility,
 * computed for an InsightsReader of that scope (so a cached row never holds more than a user of
 * that scope may see) and reused by every such user. The scheduled `ai:daily-insights` job fills
 * yesterday's daily rows (with cost) at 07:30 organization time. Only closed periods are stored:
 * a period that includes today, and users limited to several branches without choosing one, get
 * insights computed for exactly that scope, kept 15 min in the cache store. A cached row whose narrative is missing because AI was off or failing gets
 * its narrative written on the next read once AI is available. Shortage risk is removed for
 * users without purchases.view.
 */
final class BusinessInsights
{
    public const LIVE_CACHE_SECONDS = 900;

    private const RETRY_STATUSES = ['disabled', 'unavailable', 'budget_exceeded'];

    public function __construct(
        private readonly InsightsCalculator $calculator,
        private readonly NarrativeWriter $narratives,
        private readonly AiGate $gate,
        private readonly BranchDirectory $branches,
        private readonly OrganizationDate $dates,
        private readonly Cache $cache,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function forUser(TenantUser&Authorizable $user, string $organizationId, string $period, ?string $branchId, ?string $date): array
    {
        $today = $this->dates->today();
        $date = $this->date($period, $date, $today);
        $withCost = $user->can('products.view_cost');
        if ($branchId !== null && ($this->branches->summaries($organizationId, [$branchId]) === [] || ! $user->canAccessBranch($branchId))) {
            throw ValidationException::withMessages(['branch_id' => ['The selected branch does not exist or is not accessible.']]);
        }
        $accessible = $user->accessibleBranchIds();
        if ($branchId === null && $accessible !== null && count($accessible) === 1) {
            $branchId = $accessible[0];
        }
        $userId = (string) $user->getAuthIdentifier();
        $to = InsightsCalculator::periods($period, $date, $today)[1];
        $shared = $branchId !== null || $accessible === null;

        if (! $shared || $to >= $today) {
            // Several (not all) branches, or a period still running: computed for exactly this scope
            // and kept briefly in the cache store (figures of today still change).
            $scope = $branchId !== null ? [$branchId] : $accessible;
            if ($scope !== null) {
                sort($scope);
            }
            $key = implode(':', ['ai:insights:v1', $organizationId, $scope === null ? 'all' : hash('sha256', implode(',', $scope)), $period, $date, (int) $withCost]);
            $payload = $this->cache->get($key);
            if (! is_array($payload)) {
                $reader = new InsightsReader($organizationId, $scope, $withCost);
                $facts = $this->calculator->facts($reader, $period, $date, $branchId, $today);
                $narrative = $this->narratives->write($organizationId, $userId, 'insights', Prompts::insights($period), self::forModel($facts));
                $payload = ['facts' => $facts, 'narrative' => $narrative['narrative'], 'narrative_status' => $narrative['status'],
                    'generated_at' => CarbonImmutable::now()->toIso8601String(), 'cached' => false];
                if (! in_array($narrative['status'], ['unavailable', 'budget_exceeded'], true)) {
                    $this->cache->put($key, $payload, self::LIVE_CACHE_SECONDS);
                }
            }

            return $this->present($user, $payload);
        }

        $row = $this->cached($organizationId, $branchId, $period, $date, $withCost, $today, $userId);

        return $this->present($user, [
            'facts' => $row->facts,
            'narrative' => $row->narrative,
            'narrative_status' => $row->narrative_status,
            'generated_at' => $row->generated_at->toIso8601String(),
            'cached' => true,
        ]);
    }

    /**
     * The cached insight of a scope, computed (and its narrative written) when missing.
     * Idempotent: a second call for the same key reuses the row.
     */
    public function cached(string $organizationId, ?string $branchId, string $period, string $date, bool $withCost, string $today, ?string $userId, string $feature = 'insights'): AiInsight
    {
        $scope = $branchId ?? 'all';
        $find = fn () => AiInsight::query()->withoutGlobalScope('organization')
            ->where('organization_id', $organizationId)->where('scope_key', $scope)
            ->where('period', $period)->whereDate('period_date', $date)->where('with_cost', $withCost)->first();

        $row = $find();
        if ($row === null) {
            $reader = new InsightsReader($organizationId, $branchId === null ? null : [$branchId], $withCost);
            $facts = $this->calculator->facts($reader, $period, $date, $branchId, $today);
            $narrative = $this->narratives->write($organizationId, $userId, $feature, Prompts::insights($period), self::forModel($facts));
            AiInsight::query()->withoutGlobalScope('organization')->insertOrIgnore([
                'id' => (string) Str::uuid7(),
                'organization_id' => $organizationId,
                'scope_key' => $scope,
                'branch_id' => $branchId,
                'period' => $period,
                'period_date' => $date,
                'with_cost' => $withCost,
                'facts' => json_encode($facts, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE),
                'narrative' => $narrative['narrative'],
                'narrative_status' => $narrative['status'],
                'model' => $narrative['model'],
                'input_tokens' => $narrative['usage']->inputTokens,
                'output_tokens' => $narrative['usage']->outputTokens,
                'generated_at' => now(),
                'created_at' => now(),
                'updated_at' => now(),
            ]);

            return $find();
        }

        if ($row->narrative === null && in_array($row->narrative_status, self::RETRY_STATUSES, true) && $this->gate->enabledFor($organizationId)) {
            $narrative = $this->narratives->write($organizationId, $userId, $feature, Prompts::insights($period), self::forModel($row->facts));
            if ($narrative['narrative'] !== null || $narrative['status'] !== $row->narrative_status) {
                $row->forceFill([
                    'narrative' => $narrative['narrative'],
                    'narrative_status' => $narrative['status'],
                    'model' => $narrative['model'],
                    'input_tokens' => $row->input_tokens + $narrative['usage']->inputTokens,
                    'output_tokens' => $row->output_tokens + $narrative['usage']->outputTokens,
                ])->save();
            }
        }

        return $row;
    }

    /**
     * Default day: yesterday (daily) or the current month (monthly); never in the future.
     */
    public function date(string $period, ?string $date, string $today): string
    {
        $todayDate = CarbonImmutable::createFromFormat('!Y-m-d', $today);
        if ($date === null) {
            return $period === 'daily' ? $todayDate->subDay()->toDateString() : $todayDate->startOfMonth()->toDateString();
        }
        $day = CarbonImmutable::createFromFormat('!Y-m-d', $date);
        if ($day === false || $day->greaterThan($todayDate)) {
            throw ValidationException::withMessages(['date' => ['The date cannot be in the future.']]);
        }

        return $period === 'monthly' ? $day->startOfMonth()->toDateString() : $day->toDateString();
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    private function present(TenantUser&Authorizable $user, array $payload): array
    {
        $facts = $payload['facts'];
        if (! $user->can('purchases.view')) {
            $facts['shortage_risk'] = null;
        }

        return [
            'facts' => $facts,
            'narrative' => $payload['narrative'],
            'narrative_status' => $payload['narrative_status'],
            'ai_enabled' => $this->gate->enabledFor($user->organizationId()),
            'generated_at' => $payload['generated_at'],
            'cached' => $payload['cached'],
        ];
    }

    /**
     * The facts for the model: product ids dropped (names are enough).
     *
     * @param  array<string, mixed>  $facts
     * @return array<string, mixed>
     */
    public static function forModel(array $facts): array
    {
        $strip = function (mixed $value) use (&$strip): mixed {
            if (! is_array($value)) {
                return $value;
            }
            $out = [];
            foreach ($value as $k => $v) {
                if (in_array($k, ['product_id', 'store_id', 'branch_id'], true)) {
                    continue;
                }
                $out[$k] = $strip($v);
            }

            return $out;
        };

        return $strip($facts);
    }
}
