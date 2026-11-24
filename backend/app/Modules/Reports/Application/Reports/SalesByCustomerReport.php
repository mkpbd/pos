<?php

namespace App\Modules\Reports\Application\Reports;

use App\Modules\Reports\Application\ReportContext;
use App\Modules\Reports\Application\ReportResult;
use App\Modules\Reports\Domain\ReportColumn;
use App\Modules\Reports\Domain\ReportDefinition;
use App\Modules\Reports\Domain\ReportGroup;
use App\Modules\Reports\Domain\ReportParam;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Shared\Infrastructure\Persistence\WhereInChunks;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Customer-wise sales (Phase 8; the input of the AI customer insights' RFM analysis): one row per
 * named customer with their purchases in the period — POS sales and delivered web orders, net of
 * returns, as in SalesFacts — and the last purchase day (organization-local). Walk-in sales (no
 * customer) are left out, so totals cover named customers only.
 */
class SalesByCustomerReport extends SalesReport
{
    /** Customer lists up to this size are queried with IN (…); longer ones are filtered in PHP. */
    private const IN_LIST_LIMIT = 500;

    public const FIGURES = ['orders', 'returns', 'net_sales', 'average_ticket', 'gross_profit'];

    public function definition(): ReportDefinition
    {
        return new ReportDefinition(
            key: 'sales_by_customer',
            title: 'Sales by customer',
            description: 'Purchases, net sales and the last purchase day per customer (POS and delivered web orders; walk-in sales excluded).',
            group: ReportGroup::Customers,
            permission: 'reports.view',
            params: [ReportParam::dateFrom(), ReportParam::dateTo(), ReportParam::branch(), ReportParam::customer(), ReportParam::channel()],
            columns: [
                ReportColumn::text('customer', 'Customer'),
                ReportColumn::text('code', 'Code'),
                ...self::figureColumns(self::FIGURES),
                ReportColumn::date('last_purchase_on', 'Last purchase'),
            ],
            defaultSort: '-net_sales',
        );
    }

    public function run(ReportContext $context): ReportResult
    {
        $only = $context->param('customer_id');
        $aggregates = array_values(array_filter(
            $this->facts->aggregate($context, ['customer']),
            fn (array $agg) => $agg['customer'] !== null && ($only === null || $agg['customer'] === $only),
        ));
        $ids = array_column($aggregates, 'customer');
        $customers = [];
        foreach (array_chunk($ids, WhereInChunks::SIZE) as $chunk) {
            foreach (DB::table('customers')->where('organization_id', $context->organizationId)->whereIn('id', $chunk)->get(['id', 'code', 'name']) as $c) {
                $customers[$c->id] = $c;
            }
        }
        $last = $this->lastPurchases($context, $ids);

        $rows = [];
        // Totals: Σ of the customer rows (walk-in sales are not part of this report).
        $totals = ['orders' => 0, 'returns' => '0.00', 'net_sales' => '0.00', 'gross_profit' => '0.00'];
        foreach ($aggregates as $agg) {
            $c = $customers[$agg['customer']] ?? null;
            $rows[] = [
                'customer_id' => $agg['customer'],
                'customer' => $c->name ?? 'Unknown customer',
                'code' => $c->code ?? null,
            ] + self::figures($agg, self::FIGURES) + ['last_purchase_on' => $last[$agg['customer']] ?? null];
            $totals['orders'] += (int) $agg['orders'];
            $totals['returns'] = Decimal::add($totals['returns'], $agg['returns'], 2);
            $totals['net_sales'] = Decimal::add($totals['net_sales'], $agg['net_sales'], 2);
            $totals['gross_profit'] = Decimal::add($totals['gross_profit'], $agg['gross_profit'], 2);
        }

        return ReportResult::rows($rows, [
            'orders' => $totals['orders'],
            'returns' => $totals['returns'],
            'net_sales' => $totals['net_sales'],
            'average_ticket' => $totals['orders'] > 0 ? Decimal::div($totals['net_sales'], (string) $totals['orders'], 2) : null,
            'gross_profit' => $totals['gross_profit'],
            'last_purchase_on' => null,
        ]);
    }

    /**
     * The last purchase day per customer in the period: the latest completed POS sale or
     * delivered web order (organization-local date).
     *
     * @param  list<string>  $customerIds
     * @return array<string, string>
     */
    private function lastPurchases(ReportContext $context, array $customerIds): array
    {
        $latest = [];
        // G1c: a long customer list (a year of a busy shop) is not sent as IN (…) chunks — one
        // grouped query per channel over the period, keeping only the listed customers, is the
        // same answer in two statements instead of two per 500 customers.
        $wanted = count($customerIds) > self::IN_LIST_LIMIT ? array_flip($customerIds) : null;
        $keep = function (iterable $rows) use (&$latest, $wanted) {
            foreach ($rows as $row) {
                if ($wanted !== null && ! isset($wanted[$row->customer_id])) {
                    continue;
                }
                $at = CarbonImmutable::parse((string) $row->at, 'UTC');
                if (! isset($latest[$row->customer_id]) || $at->greaterThan($latest[$row->customer_id])) {
                    $latest[$row->customer_id] = $at;
                }
            }
        };
        foreach ($wanted === null ? array_chunk($customerIds, self::IN_LIST_LIMIT) : [null] as $chunk) {
            if ($context->includesPos()) {
                $query = DB::table('sales as s')
                    ->where('s.organization_id', $context->organizationId)
                    ->where('s.status', 'completed')
                    ->where('s.sold_at', '>=', $context->fromInstant())
                    ->where('s.sold_at', '<', $context->toInstant())
                    ->when($chunk !== null, fn (Builder $q) => $q->whereIn('s.customer_id', $chunk), fn (Builder $q) => $q->whereNotNull('s.customer_id'));
                $context->scopeBranches($query, 's.branch_id');
                $keep($query->groupBy('s.customer_id')->selectRaw('s.customer_id as customer_id, MAX(s.sold_at) as at')->get());
            }
            if ($context->includesOnline()) {
                $query = DB::table('orders as o')
                    ->where('o.organization_id', $context->organizationId)
                    ->where('o.status', 'delivered')
                    ->where('o.delivered_at', '>=', $context->fromInstant())
                    ->where('o.delivered_at', '<', $context->toInstant())
                    ->when($chunk !== null, fn (Builder $q) => $q->whereIn('o.customer_id', $chunk), fn (Builder $q) => $q->whereNotNull('o.customer_id'));
                $context->scopeBranches($query, 'o.branch_id');
                $keep($query->groupBy('o.customer_id')->selectRaw('o.customer_id as customer_id, MAX(o.delivered_at) as at')->get());
            }
        }

        return array_map(fn (CarbonImmutable $at) => $at->setTimezone($context->timezone)->toDateString(), $latest);
    }
}
