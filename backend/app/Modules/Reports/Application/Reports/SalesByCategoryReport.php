<?php

namespace App\Modules\Reports\Application\Reports;

use App\Modules\Reports\Application\ReportContext;
use App\Modules\Reports\Application\ReportResult;
use App\Modules\Reports\Application\Support\Names;
use App\Modules\Reports\Application\Support\Sql;
use App\Modules\Reports\Domain\ReportColumn;
use App\Modules\Reports\Domain\ReportDefinition;
use App\Modules\Reports\Domain\ReportGroup;
use App\Modules\Reports\Domain\ReportParam;

/**
 * Category-wise sales: one row per product category (the product's own category; products
 * without one are "Uncategorized"), with its share of net sales. A category filter includes
 * its sub-categories, each as its own row.
 */
class SalesByCategoryReport extends SalesReport
{
    public const FIGURES = ['quantity', 'orders', 'gross_sales', 'discounts', 'returns', 'net_sales', 'cost', 'gross_profit', 'margin'];

    public function definition(): ReportDefinition
    {
        return new ReportDefinition(
            key: 'sales_by_category',
            title: 'Sales by category',
            description: 'Net sales, cost, profit and share of sales per product category.',
            group: ReportGroup::Sales,
            permission: 'reports.view',
            params: [
                ReportParam::dateFrom(), ReportParam::dateTo(), ReportParam::branch(), ReportParam::store(),
                ReportParam::category(), ReportParam::brand(), ReportParam::channel(),
            ],
            columns: [
                ReportColumn::text('category', 'Category'),
                ...self::figureColumns(self::FIGURES),
                ReportColumn::percent('share', 'Share of sales %'),
            ],
            defaultSort: '-net_sales',
        );
    }

    public function run(ReportContext $context): ReportResult
    {
        $aggregates = $this->facts->aggregate($context, ['category']);
        $totals = $this->facts->totals($context);
        $names = Names::of('category', $context->organizationId, array_column($aggregates, 'category'));

        $rows = array_map(fn (array $agg) => [
            'category_id' => $agg['category'],
            'category' => $agg['category'] === null ? 'Uncategorized' : ($names[$agg['category']] ?? 'Unknown category'),
        ] + self::figures($agg, self::FIGURES) + [
            'share' => Sql::percent($agg['net_sales'], $totals['net_sales']),
        ], $aggregates);

        return ReportResult::rows($rows, self::figures($totals, self::FIGURES) + ['share' => Sql::percent($totals['net_sales'], $totals['net_sales'])]);
    }
}
