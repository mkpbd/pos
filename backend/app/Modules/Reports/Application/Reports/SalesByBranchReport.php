<?php

namespace App\Modules\Reports\Application\Reports;

use App\Modules\Reports\Application\ReportContext;
use App\Modules\Reports\Application\ReportResult;
use App\Modules\Reports\Application\Support\Names;
use App\Modules\Reports\Domain\ReportColumn;
use App\Modules\Reports\Domain\ReportDefinition;
use App\Modules\Reports\Domain\ReportGroup;
use App\Modules\Reports\Domain\ReportParam;

/**
 * Branch-wise sales: one row per branch the user can report on (web orders count for the
 * branch of their fulfilment store).
 */
class SalesByBranchReport extends SalesReport
{
    public const FIGURES = ['orders', 'gross_sales', 'discounts', 'returns', 'net_sales', 'tax', 'delivery_income', 'average_ticket', 'cost', 'gross_profit', 'margin'];

    public function definition(): ReportDefinition
    {
        return new ReportDefinition(
            key: 'sales_by_branch',
            title: 'Sales by branch',
            description: 'Orders, net sales, tax, delivery income, cost and profit per branch.',
            group: ReportGroup::Sales,
            permission: 'reports.view',
            params: [ReportParam::dateFrom(), ReportParam::dateTo(), ReportParam::branch(), ReportParam::channel()],
            columns: [ReportColumn::text('branch', 'Branch'), ...self::figureColumns(self::FIGURES)],
            defaultSort: '-net_sales',
        );
    }

    public function run(ReportContext $context): ReportResult
    {
        $aggregates = $this->facts->aggregate($context, ['branch']);
        $names = Names::of('branch', $context->organizationId, array_column($aggregates, 'branch'));

        $rows = array_map(fn (array $agg) => [
            'branch_id' => $agg['branch'],
            'branch' => $names[$agg['branch']] ?? 'Unknown branch',
        ] + self::figures($agg, self::FIGURES), $aggregates);

        return ReportResult::rows($rows, self::figures($this->facts->totals($context), self::FIGURES));
    }
}
