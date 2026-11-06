<?php

namespace App\Modules\AI\Application\Insights;

use App\Modules\AI\Application\Assistants\Prompts;
use App\Modules\AI\Application\Services\AiGate;
use App\Modules\AI\Application\Services\NarrativeWriter;
use App\Modules\AI\Domain\Insights\LoyaltySuggestions;
use App\Modules\AI\Domain\Insights\RfmScorer;
use App\Modules\AI\Domain\Insights\Segment;
use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Customers\Application\Contracts\CustomerDirectory;
use App\Modules\Loyalty\Application\Contracts\LoyaltyBalances;
use App\Modules\Organizations\Application\Support\OrganizationDate;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Auth\Access\Authorizable;
use Illuminate\Contracts\Cache\Repository as Cache;
use Illuminate\Validation\ValidationException;

/**
 * Customer insights: deterministic RFM over the last 12 months (365 days up to today) of POS
 * sales and delivered web orders per named customer — the `sales_by_customer` registry report in
 * the user's branch scope — scored by RfmScorer into segments, with loyalty suggestions by rule
 * (LoyaltySuggestions). Top customers per segment are shown masked (name + last 3 phone digits;
 * the name only with customers.view). The model receives segment aggregates and suggestion counts
 * only — never names, phones or ids — and writes an optional narrative. Cached 1 hour per scope.
 */
final class CustomerInsights
{
    public const WINDOW_DAYS = 365;

    public const TOP_PER_SEGMENT = 5;

    public const CACHE_SECONDS = 3600;

    public function __construct(
        private readonly InsightsCalculator $calculator,
        private readonly LoyaltyBalances $loyalty,
        private readonly CustomerDirectory $customers,
        private readonly NarrativeWriter $narratives,
        private readonly AiGate $gate,
        private readonly BranchDirectory $branches,
        private readonly OrganizationDate $dates,
        private readonly Cache $cache,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function forUser(TenantUser&Authorizable $user, string $organizationId, ?string $branchId): array
    {
        if ($branchId !== null && ($this->branches->summaries($organizationId, [$branchId]) === [] || ! $user->canAccessBranch($branchId))) {
            throw ValidationException::withMessages(['branch_id' => ['The selected branch does not exist or is not accessible.']]);
        }
        $today = $this->dates->today();
        $scope = $branchId !== null ? [$branchId] : $user->accessibleBranchIds();
        if ($scope !== null) {
            sort($scope);
        }
        $canSeeNames = $user->can('customers.view');
        $key = implode(':', ['ai:customer-insights:v1', $organizationId, $scope === null ? 'all' : hash('sha256', implode(',', $scope)), $today, (int) $canSeeNames]);
        $cached = $this->cache->get($key);
        if (is_array($cached)) {
            return ['ai_enabled' => $this->gate->enabledFor($organizationId)] + $cached;
        }

        $analysis = $this->analyse($user, $organizationId, $branchId, $today, $canSeeNames);
        $narrative = $this->narratives->write($organizationId, (string) $user->getAuthIdentifier(), 'customer_insights', Prompts::customers(), $analysis['model_facts']);
        $payload = [
            'period' => $analysis['period'],
            'branch_id' => $branchId,
            'customers_analyzed' => $analysis['customers_analyzed'],
            'loyalty_program_enabled' => $analysis['loyalty_program_enabled'],
            'segments' => $analysis['segments'],
            'suggestions' => $analysis['suggestions'],
            'narrative' => $narrative['narrative'],
            'narrative_status' => $narrative['status'],
            'generated_at' => CarbonImmutable::now()->toIso8601String(),
        ];
        if (! in_array($narrative['status'], ['unavailable', 'budget_exceeded'], true)) {
            $this->cache->put($key, $payload, self::CACHE_SECONDS);
        }

        return ['ai_enabled' => $this->gate->enabledFor($organizationId)] + $payload;
    }

    /**
     * The deterministic analysis (no model call).
     *
     * @return array{period: array{date_from: string, date_to: string}, customers_analyzed: int, loyalty_program_enabled: bool, segments: list<array<string, mixed>>, suggestions: list<array<string, mixed>>, model_facts: array<string, mixed>}
     */
    public function analyse(TenantUser&Authorizable $user, string $organizationId, ?string $branchId, string $today, bool $canSeeNames): array
    {
        $end = CarbonImmutable::createFromFormat('!Y-m-d', $today);
        $from = $end->subDays(self::WINDOW_DAYS - 1)->toDateString();
        $input = ['date_from' => $from, 'date_to' => $today] + ($branchId === null ? [] : ['branch_id' => $branchId]);
        $rows = array_values(array_filter(
            $this->calculator->run('sales_by_customer', $input, $user)['rows'],
            fn (array $r) => (int) $r['orders'] > 0 && $r['last_purchase_on'] !== null,
        ));

        $inputs = [];
        $byId = [];
        foreach ($rows as $r) {
            $recency = (int) CarbonImmutable::createFromFormat('!Y-m-d', $r['last_purchase_on'])->diffInDays($end);
            $inputs[] = ['id' => $r['customer_id'], 'recency_days' => max(0, $recency), 'frequency' => (int) $r['orders'], 'monetary' => (string) $r['net_sales']];
            $byId[$r['customer_id']] = $r + ['recency_days' => max(0, $recency)];
        }
        $scores = RfmScorer::score($inputs);
        $ids = array_keys($byId);
        $points = $this->loyalty->balances($organizationId, $ids);
        $program = $this->loyalty->program($organizationId);

        $groups = [];
        foreach ($scores as $id => $score) {
            $groups[$score['segment']->value][] = $id;
        }
        $top = [];
        foreach ($groups as $segment => $members) {
            usort($members, fn (string $a, string $b) => Decimal::compare((string) $byId[$b]['net_sales'], (string) $byId[$a]['net_sales']) ?: strcmp($a, $b));
            $top[$segment] = array_slice($members, 0, self::TOP_PER_SEGMENT);
        }
        $contacts = $this->customers->summaries($organizationId, array_values(array_merge([], ...array_values($top))));

        $total = count($scores);
        $segments = [];
        $modelSegments = [];
        foreach (Segment::cases() as $segment) {
            $members = $groups[$segment->value] ?? [];
            $count = count($members);
            $netSales = '0.00';
            $orders = 0;
            $recency = 0;
            $withPoints = 0;
            foreach ($members as $id) {
                $netSales = Decimal::add($netSales, (string) $byId[$id]['net_sales'], 2);
                $orders += (int) $byId[$id]['orders'];
                $recency += $byId[$id]['recency_days'];
                $withPoints += ($points[$id] ?? 0) > 0 ? 1 : 0;
            }
            $summary = [
                'segment' => $segment->value,
                'label' => $segment->label(),
                'description' => $segment->description(),
                'count' => $count,
                'share' => $total === 0 ? '0.00' : Decimal::round(Decimal::div((string) ($count * 100), (string) $total, 4), 2),
                'net_sales' => $netSales,
                'average_orders' => $count === 0 ? null : Decimal::div((string) $orders, (string) $count, 2),
                'average_recency_days' => $count === 0 ? null : Decimal::div((string) $recency, (string) $count, 1),
                'average_net_sales' => $count === 0 ? null : Decimal::div($netSales, (string) $count, 2),
                'with_loyalty_points' => $withPoints,
            ];
            $modelSegments[] = array_diff_key($summary, ['description' => true]);
            $summary['top_customers'] = array_map(fn (string $id) => $this->customer($id, $byId[$id], $scores[$id], $points[$id] ?? 0, $contacts[$id] ?? null, $canSeeNames), $top[$segment->value] ?? []);
            $segments[] = $summary;
        }

        $suggestions = LoyaltySuggestions::suggest(
            array_map(fn (string $id) => ['segment' => $scores[$id]['segment'], 'points' => $points[$id] ?? 0], array_keys($scores)),
            $program['enabled'],
            $program['point_value'],
        );

        return [
            'period' => ['date_from' => $from, 'date_to' => $today],
            'customers_analyzed' => $total,
            'loyalty_program_enabled' => $program['enabled'],
            'segments' => $segments,
            'suggestions' => $suggestions,
            'model_facts' => [
                'period' => ['date_from' => $from, 'date_to' => $today],
                'scope' => $branchId === null ? 'all accessible branches' : 'one branch',
                'customers_analyzed' => $total,
                'loyalty_program_enabled' => $program['enabled'],
                'segments' => $modelSegments,
                'suggestions' => array_map(fn (array $s) => array_diff_key($s, ['message' => true]) + ['action' => $s['message']], $suggestions),
            ],
        ];
    }

    /**
     * A top customer, masked: the name (with customers.view) and the last 3 phone digits.
     *
     * @param  array<string, mixed>  $row
     * @param  array{r: int, f: int, m: int, segment: Segment}  $score
     * @param  array{id: string, code: string, name: string, phone: ?string, email: ?string}|null  $contact
     * @return array<string, mixed>
     */
    private function customer(string $id, array $row, array $score, int $points, ?array $contact, bool $canSeeNames): array
    {
        $digits = preg_replace('/\D+/', '', (string) ($contact['phone'] ?? '')) ?? '';

        return [
            'customer_id' => $canSeeNames ? $id : null,
            'name' => $canSeeNames ? ($contact['name'] ?? 'Unknown customer') : null,
            'phone_hint' => strlen($digits) >= 3 ? '…'.substr($digits, -3) : null,
            'orders' => (int) $row['orders'],
            'net_sales' => (string) $row['net_sales'],
            'last_purchase_on' => $row['last_purchase_on'],
            'recency_days' => $row['recency_days'],
            'loyalty_points' => $points,
            'scores' => ['r' => $score['r'], 'f' => $score['f'], 'm' => $score['m']],
        ];
    }
}
