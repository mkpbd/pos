<?php

namespace App\Modules\Reports\Application\Reports;

use App\Modules\Reports\Application\ReportContext;
use App\Modules\Reports\Application\ReportResult;
use App\Modules\Reports\Domain\ReportColumn;
use App\Modules\Reports\Domain\ReportDefinition;
use App\Modules\Reports\Domain\ReportGroup;
use App\Modules\Reports\Domain\ReportParam;
use Carbon\CarbonImmutable;

/**
 * Monthly sales: one row per organization-local month touched by the range (`month` is
 * "YYYY-MM"; `month_label` "Nov 2026"; months without sales included as zeros). Partial
 * first/last months only count the days inside the range. Up to five years.
 */
class SalesMonthlyReport extends SalesReport
{
    public function definition(): ReportDefinition
    {
        return new ReportDefinition(
            key: 'sales_monthly',
            title: 'Monthly sales',
            description: 'Sales per month: POS sales and delivered web orders, net of discounts and returns, with tax and delivery income shown separately.',
            group: ReportGroup::Sales,
            permission: 'reports.view',
            params: [ReportParam::dateFrom(), ReportParam::dateTo(), ReportParam::branch(), ReportParam::channel()],
            columns: [ReportColumn::text('month', 'Month'), ...self::figureColumns(SalesDailyReport::FIGURES)],
            defaultSort: 'month',
            granularity: 'month',
        );
    }

    public function run(ReportContext $context): ReportResult
    {
        $byMonth = [];
        foreach ($this->facts->aggregate($context, ['month']) as $agg) {
            $byMonth[$agg['month']] = $agg;
        }

        $rows = [];
        $last = CarbonImmutable::parse($context->to())->startOfMonth();
        for ($month = CarbonImmutable::parse($context->from())->startOfMonth(); $month <= $last; $month = $month->addMonth()) {
            $key = $month->format('Y-m');
            $rows[] = ['month' => $key, 'month_label' => $month->format('M Y')] + self::figures($byMonth[$key] ?? self::emptyAggregate(), SalesDailyReport::FIGURES);
        }

        return ReportResult::rows($rows, self::figures($this->facts->totals($context), SalesDailyReport::FIGURES));
    }
}
