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
 * Daily sales: one row per organization-local day of the range (days without sales included,
 * as zeros), POS and online (on delivery) per SalesFacts. At most 366 days.
 */
class SalesDailyReport extends SalesReport
{
    public const FIGURES = ['orders', 'gross_sales', 'discounts', 'returns', 'net_sales', 'tax', 'delivery_income', 'average_ticket', 'cost', 'gross_profit', 'margin'];

    public function definition(): ReportDefinition
    {
        return new ReportDefinition(
            key: 'sales_daily',
            title: 'Daily sales',
            description: 'Sales per day: POS sales and delivered web orders, net of discounts and returns, with tax and delivery income shown separately.',
            group: ReportGroup::Sales,
            permission: 'reports.view',
            params: [ReportParam::dateFrom(), ReportParam::dateTo(), ReportParam::branch(), ReportParam::channel()],
            columns: [ReportColumn::date('date', 'Date'), ...self::figureColumns(self::FIGURES)],
            defaultSort: 'date',
            granularity: 'day',
        );
    }

    public function run(ReportContext $context): ReportResult
    {
        $byDay = [];
        foreach ($this->facts->aggregate($context, ['day']) as $agg) {
            $byDay[$agg['day']] = $agg;
        }

        $rows = [];
        $last = CarbonImmutable::parse($context->to());
        for ($day = CarbonImmutable::parse($context->from()); $day <= $last; $day = $day->addDay()) {
            $date = $day->toDateString();
            $rows[] = ['date' => $date] + self::figures($byDay[$date] ?? self::emptyAggregate(), self::FIGURES);
        }

        return ReportResult::rows($rows, self::figures($this->facts->totals($context), self::FIGURES));
    }
}
