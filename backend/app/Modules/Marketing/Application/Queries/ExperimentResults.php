<?php

namespace App\Modules\Marketing\Application\Queries;

use App\Modules\Marketing\Application\Contracts\AttributedOrders;
use App\Modules\Marketing\Application\Contracts\PageInsightDocuments;
use App\Modules\Marketing\Domain\BetaBinomial;
use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * B13: how the two versions of a store builder page's A/B test do — per version the unique
 * visitors (the trials), the goal count (orders | add-to-carts | page views with a click on the
 * version's sections; at most the visitors), its rate, orders and revenue (non-cancelled orders
 * with the version in `attribution.builder.experiments`); the lift of B over A, the Bayesian
 * chance that B beats A (BetaBinomial), a confidence, whether there is enough data (≥ 100
 * visitors and ≥ 10 goal events per version) and a recommendation, plus every day of the range.
 *
 * The range: the local day the test started (else the last 30 days) to the day it ended (else
 * today), at most 365 days; counts are kept 90 days. Percentages are strings 0–100 with two
 * decimals, money NUMERIC strings.
 */
class ExperimentResults
{
    public const MIN_VISITORS = 100;

    public const MIN_GOALS = 10;

    public const DEFAULT_DAYS = 30;

    public const MAX_DAYS = 365;

    /** A / B decided at this chance (%), and the line for medium confidence. */
    public const DECISIVE = 95;

    public const LIKELY = 80;

    public function __construct(
        private readonly TenantContext $tenant,
        private readonly OrganizationDirectory $organizations,
        private readonly PageInsightDocuments $documents,
        private readonly AttributedOrders $orders,
    ) {}

    /**
     * The results, or `NOT_FOUND` (not a tracked page of this store) / `EXPERIMENT_NOT_FOUND`.
     *
     * @return array<string, mixed>|string
     */
    public function results(string $documentId, string $experimentId, ?string $device): array|string
    {
        if ($this->documents->existing([$documentId]) === []) {
            return 'NOT_FOUND';
        }
        $experiment = $this->documents->experiment($documentId, $experimentId);
        if ($experiment === null) {
            return 'EXPERIMENT_NOT_FOUND';
        }
        $documentId = strtolower($documentId);
        $organization = $this->organizations->summary($this->tenant->requireOrganization()) ?? [];
        $timezone = (string) ($organization['timezone'] ?? config('app.timezone'));
        $currency = (string) ($organization['base_currency'] ?? config('pos.default_currency'));
        [$from, $to] = self::range($experiment, $timezone);

        $zero = ['visitors' => 0, 'views' => 0, 'section_views' => 0, 'clicks' => 0, 'clicked_views' => 0, 'add_to_carts' => 0, 'orders' => 0, 'revenue' => '0.00'];
        $days = [];
        for ($day = CarbonImmutable::parse($from); $day->lte(CarbonImmutable::parse($to)); $day = $day->addDay()) {
            $days[$day->toDateString()] = ['A' => $zero, 'B' => $zero];
        }
        $rows = DB::table('builder_experiment_stats')
            ->where('organization_id', $this->tenant->requireOrganization())
            ->where('document_id', $documentId)
            ->where('experiment_id', $experimentId)
            ->whereBetween('day', [$from, $to])
            ->when($device !== null, fn (Builder $q) => $q->where('device', $device))
            ->groupBy('day', 'arm')->select('day', 'arm')
            ->selectRaw('SUM(views) AS views, SUM(visitors) AS visitors, SUM(section_views) AS section_views, SUM(clicks) AS clicks, SUM(clicked_views) AS clicked_views, SUM(add_to_carts) AS add_to_carts')
            ->get();
        foreach ($rows as $row) {
            $day = substr((string) $row->day, 0, 10);
            if (! isset($days[$day][$row->arm])) {
                continue;
            }
            foreach (['views', 'visitors', 'section_views', 'clicks', 'clicked_views', 'add_to_carts'] as $field) {
                $days[$day][$row->arm][$field] += (int) $row->{$field};
            }
        }
        $start = CarbonImmutable::parse($from, $timezone)->startOfDay();
        $end = CarbonImmutable::parse($to, $timezone)->startOfDay()->addDay();
        foreach ($this->orders->experimentGroups($start, $end, $timezone, $documentId, $experimentId, $device) as $row) {
            if (isset($days[$row['day']][$row['arm']])) {
                $days[$row['day']][$row['arm']]['orders'] += $row['orders'];
                $days[$row['day']][$row['arm']]['revenue'] = Decimal::add($days[$row['day']][$row['arm']]['revenue'], $row['revenue'], 2);
            }
        }

        $goal = $experiment['goal'];
        $totals = ['A' => $zero, 'B' => $zero];
        $daily = [];
        foreach ($days as $day => $arms) {
            $entry = ['day' => $day];
            foreach (['A', 'B'] as $arm) {
                foreach ($zero as $field => $_) {
                    $totals[$arm][$field] = $field === 'revenue'
                        ? Decimal::add($totals[$arm][$field], $arms[$arm][$field], 2)
                        : $totals[$arm][$field] + $arms[$arm][$field];
                }
                // The day's events as they happened (an order may follow a visit of the day before).
                $entry[$arm] = ['visitors' => $arms[$arm]['visitors'], 'goal_count' => self::goalCount($goal, $arms[$arm])];
            }
            $daily[] = $entry;
        }

        $arms = [];
        foreach (['A', 'B'] as $arm) {
            $t = $totals[$arm];
            $count = min(self::goalCount($goal, $t), $t['visitors']);
            $arms[$arm] = [
                'visitors' => $t['visitors'],
                'views' => $t['views'],
                'goal_count' => $count,
                'rate' => self::percent($count, $t['visitors']),
                'orders' => $t['orders'],
                'revenue' => $t['revenue'],
                'add_to_carts' => $t['add_to_carts'],
                'clicks' => $t['clicks'],
                'section_views' => $t['section_views'],
            ];
        }

        $verdict = self::verdict($arms['A']['visitors'], $arms['A']['goal_count'], $arms['B']['visitors'], $arms['B']['goal_count']);

        return [
            'experiment' => $experiment,
            'document_id' => $documentId,
            'from' => $from,
            'to' => $to,
            'device' => $device,
            'timezone' => $timezone,
            'currency' => $currency,
            'goal' => $goal,
            'arms' => $arms,
            ...$verdict,
            'daily' => $daily,
        ];
    }

    /**
     * Lift, chance that B beats A, confidence, enough data and the recommendation from the
     * versions' visitors and goal counts.
     *
     * @return array{lift: ?string, probability_b_beats_a: ?string, confidence: string, enough_data: bool, recommendation: string}
     */
    public static function verdict(int $visitorsA, int $goalsA, int $visitorsB, int $goalsB): array
    {
        $goalsA = min($goalsA, $visitorsA);
        $goalsB = min($goalsB, $visitorsB);
        $lift = $visitorsA > 0 && $visitorsB > 0 && $goalsA > 0
            ? Decimal::round(Decimal::sub(Decimal::div((string) ($goalsB * $visitorsA * 100), (string) ($goalsA * $visitorsB), 6), '100', 6), 2)
            : null;
        $probability = $visitorsA > 0 && $visitorsB > 0
            ? 100 * BetaBinomial::probabilityBBeatsA($visitorsA, $goalsA, $visitorsB, $goalsB)
            : null;
        $enough = $visitorsA >= self::MIN_VISITORS && $visitorsB >= self::MIN_VISITORS && $goalsA >= self::MIN_GOALS && $goalsB >= self::MIN_GOALS;

        $confidence = 'low';
        $recommendation = 'keep_running';
        if ($enough && $probability !== null) {
            $sureness = max($probability, 100 - $probability);
            $confidence = $sureness >= self::DECISIVE ? 'high' : ($sureness >= self::LIKELY ? 'medium' : 'low');
            if ($probability >= self::DECISIVE) {
                $recommendation = 'keep_b';
            } elseif ($probability <= 100 - self::DECISIVE) {
                $recommendation = 'keep_a';
            }
        }

        return [
            'lift' => $lift,
            'probability_b_beats_a' => $probability === null ? null : number_format($probability, 2, '.', ''),
            'confidence' => $confidence,
            'enough_data' => $enough,
            'recommendation' => $recommendation,
        ];
    }

    /**
     * The calendar days (organization time zone) to show.
     *
     * @param  array<string, mixed>  $experiment
     * @return array{0: string, 1: string}
     */
    public static function range(array $experiment, string $timezone): array
    {
        $today = CarbonImmutable::now($timezone)->startOfDay();
        $local = fn (?string $instant) => $instant === null ? null : CarbonImmutable::parse($instant)->setTimezone($timezone)->startOfDay();
        $to = $local($experiment['ended_at'] ?? null) ?? $today;
        if ($to->gt($today)) {
            $to = $today;
        }
        $from = $local($experiment['started_at'] ?? null) ?? $to->subDays(self::DEFAULT_DAYS - 1);
        if ($from->gt($to)) {
            $from = $to;
        }
        if ($from->lt($to->subDays(self::MAX_DAYS - 1))) {
            $from = $to->subDays(self::MAX_DAYS - 1);
        }

        return [$from->toDateString(), $to->toDateString()];
    }

    /**
     * @param  array<string, int|string>  $counts
     */
    private static function goalCount(string $goal, array $counts): int
    {
        return (int) match ($goal) {
            'add_to_cart' => $counts['add_to_carts'],
            'clicks' => $counts['clicked_views'],
            default => $counts['orders'],
        };
    }

    private static function percent(int $part, int $whole): ?string
    {
        return $whole > 0 ? Decimal::round(Decimal::div((string) ($part * 100), (string) $whole, 4), 2) : null;
    }
}
