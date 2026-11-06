<?php

namespace App\Modules\Reports\Application\Reports;

use App\Modules\Reports\Application\ReportContext;
use App\Modules\Reports\Application\ReportResult;
use App\Modules\Reports\Application\Support\Names;
use App\Modules\Reports\Domain\ReportColumn;
use App\Modules\Reports\Domain\ReportDefinition;
use App\Modules\Reports\Domain\ReportGroup;
use App\Modules\Reports\Domain\ReportParam;
use Illuminate\Support\Facades\DB;

/**
 * Product-wise sales: one row per product (its variants together) with net quantity (sold −
 * returned), sales figures, cost, profit and margin. Filters by product, category (with its
 * sub-categories), brand, store, branch and channel.
 */
class SalesByProductReport extends SalesReport
{
    public const FIGURES = ['quantity', 'orders', 'gross_sales', 'discounts', 'returns', 'net_sales', 'cost', 'gross_profit', 'margin'];

    public function definition(): ReportDefinition
    {
        return new ReportDefinition(
            key: 'sales_by_product',
            title: 'Sales by product',
            description: 'Quantity, net sales, cost, profit and margin per product (POS and delivered web orders, net of returns).',
            group: ReportGroup::Sales,
            permission: 'reports.view',
            params: [
                ReportParam::dateFrom(), ReportParam::dateTo(), ReportParam::branch(), ReportParam::store(),
                ReportParam::product(), ReportParam::category(), ReportParam::brand(), ReportParam::channel(),
            ],
            columns: [
                ReportColumn::text('product', 'Product'),
                ReportColumn::text('category', 'Category'),
                ReportColumn::text('brand', 'Brand'),
                ...self::figureColumns(self::FIGURES),
            ],
            defaultSort: '-net_sales',
        );
    }

    public function run(ReportContext $context): ReportResult
    {
        $aggregates = $this->facts->aggregate($context, ['product']);
        $products = DB::table('products')->where('organization_id', $context->organizationId)
            ->whereIn('id', array_column($aggregates, 'product'))
            ->get(['id', 'name', 'category_id', 'brand_id'])->keyBy('id');
        $categories = Names::of('category', $context->organizationId, $products->pluck('category_id'));
        $brands = Names::of('brand', $context->organizationId, $products->pluck('brand_id'));

        $rows = array_map(function (array $agg) use ($products, $categories, $brands) {
            $product = $products[$agg['product']] ?? null;

            return [
                'product_id' => $agg['product'],
                'product' => $product->name ?? 'Unknown product',
                'category_id' => $product->category_id ?? null,
                'category' => $product?->category_id === null ? null : ($categories[$product->category_id] ?? null),
                'brand_id' => $product->brand_id ?? null,
                'brand' => $product?->brand_id === null ? null : ($brands[$product->brand_id] ?? null),
            ] + self::figures($agg, self::FIGURES);
        }, $aggregates);

        return ReportResult::rows($rows, self::figures($this->facts->totals($context), self::FIGURES));
    }
}
