<?php

namespace App\Modules\Reports\Application\Reports;

use App\Modules\Reports\Application\ReportContext;
use App\Modules\Reports\Application\ReportResult;
use App\Modules\Reports\Application\Support\Names;
use App\Modules\Reports\Domain\ReportColumn;
use App\Modules\Reports\Domain\ReportDefinition;
use App\Modules\Reports\Domain\ReportGroup;
use App\Modules\Reports\Domain\ReportParam;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Cashier-wise sales: one row per POS cashier (the user who rang the sale up; returns count
 * against the original sale's cashier), plus one "Online" row for delivered web orders (no
 * cashier; left out when a cashier is chosen or the channel is POS). `cancelled` = sales of
 * the cashier in the range that were cancelled afterwards (excluded from every figure).
 */
class SalesByCashierReport extends SalesReport
{
    public const FIGURES = ['orders', 'gross_sales', 'discounts', 'returns', 'net_sales', 'tax', 'average_ticket'];

    public function definition(): ReportDefinition
    {
        return new ReportDefinition(
            key: 'sales_by_cashier',
            title: 'Sales by cashier',
            description: 'POS sales per cashier (with cancellations) and one row for online orders.',
            group: ReportGroup::Sales,
            permission: 'reports.view',
            params: [ReportParam::dateFrom(), ReportParam::dateTo(), ReportParam::branch(), ReportParam::cashier(), ReportParam::channel()],
            columns: [
                ReportColumn::text('cashier', 'Cashier'),
                ...self::figureColumns(self::FIGURES),
                ReportColumn::number('cancelled', 'Cancelled sales'),
            ],
            defaultSort: '-net_sales',
        );
    }

    public function run(ReportContext $context): ReportResult
    {
        $aggregates = $this->facts->aggregate($context, ['channel', 'cashier']);
        $cancelled = $context->includesPos() ? $this->cancelled($context) : [];
        $names = Names::of('user', $context->organizationId, [...array_column($aggregates, 'cashier'), ...array_keys($cancelled)]);

        $rows = [];
        foreach ($aggregates as $agg) {
            $online = $agg['channel'] === 'online';
            $key = $online ? 'online' : (string) $agg['cashier'];
            $rows[$key] = [
                'cashier_id' => $online ? null : $agg['cashier'],
                'cashier' => $online ? 'Online' : ($names[$agg['cashier']] ?? 'Unknown user'),
                'channel' => $agg['channel'],
            ] + self::figures($agg, self::FIGURES) + ['cancelled' => $online ? null : ($cancelled[$agg['cashier']] ?? 0)];
        }
        // Cashiers whose every sale in the range was cancelled.
        foreach ($cancelled as $cashierId => $count) {
            $rows[$cashierId] ??= [
                'cashier_id' => $cashierId,
                'cashier' => $names[$cashierId] ?? 'Unknown user',
                'channel' => 'pos',
            ] + self::figures(self::emptyAggregate(), self::FIGURES) + ['cancelled' => $count];
        }

        return ReportResult::rows(array_values($rows), self::figures($this->facts->totals($context), self::FIGURES) + ['cancelled' => array_sum($cancelled)]);
    }

    /**
     * @return array<string, int> cashier id => cancelled sales
     */
    private function cancelled(ReportContext $context): array
    {
        $query = DB::table('sales as s')
            ->where('s.organization_id', $context->organizationId)
            ->where('s.status', 'cancelled')
            ->where('s.sold_at', '>=', $context->fromInstant())
            ->where('s.sold_at', '<', $context->toInstant())
            ->whereNotNull('s.created_by');
        $context->scopeBranches($query, 's.branch_id');
        $query->when($context->param('cashier_id'), fn (Builder $q, string $id) => $q->where('s.created_by', $id));

        return $query->groupBy('s.created_by')->selectRaw('s.created_by as cashier, COUNT(*) as cancelled')
            ->pluck('cancelled', 'cashier')->map(fn ($n) => (int) $n)->all();
    }
}
