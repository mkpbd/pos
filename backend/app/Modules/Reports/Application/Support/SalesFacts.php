<?php

namespace App\Modules\Reports\Application\Support;

use App\Modules\Reports\Application\ReportContext;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * The one definition of "sales" every sales report, the P&L, the tax report and the
 * dashboard share (Phase 7). Aggregated in the database, grouped by the requested dimensions,
 * then the four sources are merged per group:
 *
 * POS (channel `pos`)
 *   + lines of completed sales, by `sold_at` (cancelled sales are excluded entirely);
 *   − lines of completed sale returns, by the return's completion time (`decided_at`).
 * Online (channel `online`)
 *   + lines of web orders with status `delivered`, by `delivered_at` (revenue is recognised on
 *     delivery; pending, confirmed, shipped, cancelled and failed orders never count);
 *   − lines of web returns with status `refunded`, by `refunded_at`.
 *
 * Amounts (decimal strings; tax-inclusive organizations report net of tax):
 *   net         = Σ line net_amount (after item and invoice discounts, excluding tax)
 *   discounts   = Σ item discount + invoice-discount share (POS) / Σ discount_amount (web,
 *                 product + order promotions)
 *   gross       = net + discounts (before discounts, excluding the tax charged)
 *   returns     = Σ returned net (line share of what was charged, minus its tax)
 *   net_sales   = gross − discounts − returns
 *   tax         = Σ line tax − Σ returned tax (output tax)
 *   cost (COGS) = Σ line cost_total − Σ cost of returned lines that were restocked. Line costs
 *                 are the stock ledger's cost of the goods out (weighted average cost at the
 *                 time, which includes landed costs via WAC); written-off returns keep their
 *                 cost in COGS. Value-only landed_cost expenses (SC3, on account) are expenses,
 *                 not COGS.
 *   delivery    = Σ shipping_total + cod_fee of delivered web orders − Σ shipping refunds of
 *                 refunded web returns ("Delivery income", kept out of net sales).
 *   orders      = POS sales + delivered web orders (distinct documents).
 *
 * Dimensions: day, month (organization-local), branch, store, product, category, brand,
 * cashier (POS `created_by`; web orders have none → NULL, shown as "Online"; returns count
 * against the original sale's cashier), channel, tax_rate (the line's rate; returns use the
 * rate of the line they return).
 */
final class SalesFacts
{
    public const DIMENSIONS = ['day', 'month', 'branch', 'store', 'product', 'category', 'brand', 'cashier', 'channel', 'tax_rate'];

    private const DELIVERY_DIMENSIONS = ['day', 'month', 'branch', 'store', 'channel'];

    /**
     * @param  list<string>  $dims
     * @return list<array<string, mixed>> one row per group: the dimensions + orders, returns_count,
     *                                    sold_quantity, returned_quantity, quantity, gross, discounts, returns, net_sales, tax,
     *                                    cost, gross_profit, delivery_income
     */
    public function aggregate(ReportContext $ctx, array $dims, ?string $from = null, ?string $to = null): array
    {
        $from ??= $ctx->from();
        $to ??= $ctx->to();
        $groups = [];
        $merge = function (iterable $rows, string $channel, array $fields) use (&$groups, $dims) {
            foreach ($rows as $row) {
                $row = (array) $row;
                $key = [];
                $values = [];
                foreach ($dims as $dim) {
                    $value = $dim === 'channel' ? $channel : ($row['d_'.$dim] ?? null);
                    $values[$dim] = $value === null ? null : ($dim === 'tax_rate' ? Decimal::round(Sql::plain($value), 4) : (string) $value);
                    $key[] = $values[$dim] ?? "\0";
                }
                $k = implode("\x1f", $key);
                $groups[$k] ??= $values + self::zero();
                foreach ($fields as $field) {
                    $groups[$k][$field] = $field === 'docs' || $field === 'rdocs'
                        ? $groups[$k][$field] + (int) ($row[$field] ?? 0)
                        : Decimal::add($groups[$k][$field], Sql::plain($row[$field] ?? 0), 6);
                }
            }
        };

        if ($ctx->includesPos()) {
            $merge($this->posLines($ctx, $dims, $from, $to)->get(), 'pos', ['docs', 'qty', 'disc', 'net', 'tax', 'cost']);
            $merge($this->posReturns($ctx, $dims, $from, $to)->get(), 'pos', ['rdocs', 'rqty', 'rnet', 'rtax', 'rcost']);
        }
        if ($ctx->includesOnline()) {
            $merge($this->onlineLines($ctx, $dims, $from, $to)->get(), 'online', ['docs', 'qty', 'disc', 'net', 'tax', 'cost']);
            $merge($this->onlineReturns($ctx, $dims, $from, $to)->get(), 'online', ['rdocs', 'rqty', 'rnet', 'rtax', 'rcost']);
            if (array_diff($dims, self::DELIVERY_DIMENSIONS) === [] && ! $this->filtersProducts($ctx)) {
                $merge($this->delivery($ctx, $dims, $from, $to)->get(), 'online', ['delivery']);
                $merge($this->deliveryRefunds($ctx, $dims, $from, $to)->get(), 'online', ['delivery_refund']);
            }
        }

        return array_values(array_map(fn (array $g) => self::finish($g), $groups));
    }

    /**
     * One row over every group (no dimensions), zeros when nothing was sold.
     *
     * @return array<string, mixed>
     */
    public function totals(ReportContext $ctx, ?string $from = null, ?string $to = null): array
    {
        return $this->aggregate($ctx, [], $from, $to)[0] ?? self::finish(self::zero());
    }

    /**
     * @return array<string, mixed>
     */
    private static function zero(): array
    {
        return ['docs' => 0, 'qty' => '0', 'disc' => '0', 'net' => '0', 'tax' => '0', 'cost' => '0',
            'rdocs' => 0, 'rqty' => '0', 'rnet' => '0', 'rtax' => '0', 'rcost' => '0', 'delivery' => '0', 'delivery_refund' => '0'];
    }

    /**
     * @param  array<string, mixed>  $g
     * @return array<string, mixed>
     */
    private static function finish(array $g): array
    {
        $money = fn (string $v) => Decimal::round($v, 2);
        $net = $money($g['net']);
        $discounts = $money($g['disc']);
        $returns = $money($g['rnet']);
        $netSales = Decimal::sub($net, $returns, 2);
        $cost = Decimal::sub($money($g['cost']), $money($g['rcost']), 2);
        $dims = array_diff_key($g, self::zero());

        return $dims + [
            'orders' => $g['docs'],
            'returns_count' => $g['rdocs'],
            'sold_quantity' => Decimal::round($g['qty'], 3),
            'returned_quantity' => Decimal::round($g['rqty'], 3),
            'quantity' => Decimal::sub(Decimal::round($g['qty'], 3), Decimal::round($g['rqty'], 3), 3),
            'gross' => Decimal::add($net, $discounts, 2),
            'discounts' => $discounts,
            'returns' => $returns,
            'net_sales' => $netSales,
            'tax' => Decimal::sub($money($g['tax']), $money($g['rtax']), 2),
            'cost' => $cost,
            'gross_profit' => Decimal::sub($netSales, $cost, 2),
            'delivery_income' => Decimal::sub($money($g['delivery']), $money($g['delivery_refund']), 2),
        ];
    }

    private function filtersProducts(ReportContext $ctx): bool
    {
        return $ctx->param('product_id') !== null || $ctx->categoryIds !== null || $ctx->param('brand_id') !== null;
    }

    /**
     * @param  list<string>  $dims
     * @param  array<string, string|null>  $expressions  dimension => SQL (null = not available → NULL)
     */
    private function select(Builder $query, array $dims, array $expressions, array $measures): Builder
    {
        $selects = [];
        foreach ($dims as $dim) {
            if ($dim === 'channel') {
                continue;
            }
            $expression = $expressions[$dim] ?? null;
            if ($expression === null) {
                $selects[] = 'NULL as d_'.$dim;

                continue;
            }
            $selects[] = $expression.' as d_'.$dim;
            $query->groupByRaw($expression);
        }
        foreach ($measures as $alias => $sql) {
            $selects[] = $sql.' as '.$alias;
        }

        return $query->selectRaw(implode(', ', $selects));
    }

    /**
     * @param  list<string>  $dims
     */
    private function needsProducts(ReportContext $ctx, array $dims): bool
    {
        return array_intersect($dims, ['category', 'brand']) !== [] || $ctx->categoryIds !== null || $ctx->param('brand_id') !== null;
    }

    private function productFilters(Builder $query, ReportContext $ctx, string $productColumn): void
    {
        $query->when($ctx->param('product_id'), fn (Builder $q, string $id) => $q->where($productColumn, $id))
            ->when($ctx->categoryIds, fn (Builder $q, array $ids) => $q->whereIn('p.category_id', $ids))
            ->when($ctx->param('brand_id'), fn (Builder $q, string $id) => $q->where('p.brand_id', $id));
    }

    /**
     * @param  list<string>  $dims
     */
    private function posLines(ReportContext $ctx, array $dims, string $from, string $to): Builder
    {
        $query = DB::table('sale_lines as sl')
            ->join('sales as s', 's.id', '=', 'sl.sale_id')
            ->where('s.organization_id', $ctx->organizationId)
            ->where('s.status', 'completed')
            ->where('s.sold_at', '>=', $ctx->fromInstant($from))
            ->where('s.sold_at', '<', $ctx->toInstant($to));
        $this->posScope($query, $ctx, 's');
        $product = $this->joinVariant($query, $ctx, $dims, 'sl.variant_id');

        return $this->select($query, $dims, [
            'day' => $ctx->sql->localDate('s.sold_at'),
            'month' => $ctx->sql->localMonth('s.sold_at'),
            'branch' => 's.branch_id',
            'store' => 's.store_id',
            'product' => $product,
            'category' => 'p.category_id',
            'brand' => 'p.brand_id',
            'cashier' => 's.created_by',
            'tax_rate' => 'sl.tax_rate',
        ], [
            'docs' => 'COUNT(DISTINCT s.id)',
            'qty' => 'SUM(sl.quantity)',
            'disc' => 'SUM(sl.discount_amount + sl.invoice_discount_share)',
            'net' => 'SUM(sl.net_amount)',
            'tax' => 'SUM(sl.tax_amount)',
            'cost' => 'SUM(sl.cost_total)',
        ]);
    }

    /**
     * @param  list<string>  $dims
     */
    private function posReturns(ReportContext $ctx, array $dims, string $from, string $to): Builder
    {
        $query = DB::table('sale_return_lines as rl')
            ->join('sale_returns as r', 'r.id', '=', 'rl.sale_return_id')
            ->join('sales as s', 's.id', '=', 'r.sale_id')
            ->where('r.organization_id', $ctx->organizationId)
            ->where('r.status', 'completed')
            ->where('r.decided_at', '>=', $ctx->fromInstant($from))
            ->where('r.decided_at', '<', $ctx->toInstant($to));
        $this->posScope($query, $ctx, 'r', 's.created_by');
        $product = $this->joinVariant($query, $ctx, $dims, 'rl.variant_id');
        if (in_array('tax_rate', $dims, true)) {
            $query->join('sale_lines as osl', 'osl.id', '=', 'rl.sale_line_id');
        }

        return $this->select($query, $dims, [
            'day' => $ctx->sql->localDate('r.decided_at'),
            'month' => $ctx->sql->localMonth('r.decided_at'),
            'branch' => 'r.branch_id',
            'store' => 'r.store_id',
            'product' => $product,
            'category' => 'p.category_id',
            'brand' => 'p.brand_id',
            'cashier' => 's.created_by',
            'tax_rate' => 'osl.tax_rate',
        ], [
            'rdocs' => 'COUNT(DISTINCT r.id)',
            'rqty' => 'SUM(rl.quantity)',
            'rnet' => 'SUM(rl.net_amount)',
            'rtax' => 'SUM(rl.tax_amount)',
            'rcost' => 'SUM(CASE WHEN '.$ctx->sql->isTrue('rl.restock').' THEN rl.cost_total ELSE 0 END)',
        ]);
    }

    /**
     * @param  list<string>  $dims
     */
    private function onlineLines(ReportContext $ctx, array $dims, string $from, string $to): Builder
    {
        $query = DB::table('order_lines as ol')
            ->join('orders as o', 'o.id', '=', 'ol.order_id')
            ->where('o.organization_id', $ctx->organizationId)
            ->where('o.status', 'delivered')
            ->where('o.delivered_at', '>=', $ctx->fromInstant($from))
            ->where('o.delivered_at', '<', $ctx->toInstant($to));
        $this->onlineScope($query, $ctx);
        if ($this->needsProducts($ctx, $dims)) {
            $query->join('products as p', 'p.id', '=', 'ol.product_id');
        }
        $this->productFilters($query, $ctx, 'ol.product_id');

        return $this->select($query, $dims, [
            'day' => $ctx->sql->localDate('o.delivered_at'),
            'month' => $ctx->sql->localMonth('o.delivered_at'),
            'branch' => 'o.branch_id',
            'store' => 'o.store_id',
            'product' => 'ol.product_id',
            'category' => 'p.category_id',
            'brand' => 'p.brand_id',
            'cashier' => null,
            'tax_rate' => 'ol.tax_rate',
        ], [
            'docs' => 'COUNT(DISTINCT o.id)',
            'qty' => 'SUM(ol.quantity)',
            'disc' => 'SUM(ol.discount_amount)',
            'net' => 'SUM(ol.net_amount)',
            'tax' => 'SUM(ol.tax_amount)',
            'cost' => 'SUM(ol.cost_total)',
        ]);
    }

    /**
     * @param  list<string>  $dims
     */
    private function onlineReturns(ReportContext $ctx, array $dims, string $from, string $to): Builder
    {
        $query = DB::table('order_return_lines as rl')
            ->join('order_returns as r', 'r.id', '=', 'rl.return_id')
            ->join('order_lines as ol', 'ol.id', '=', 'rl.order_line_id')
            ->join('orders as o', 'o.id', '=', 'r.order_id')
            ->where('r.organization_id', $ctx->organizationId)
            ->where('r.status', 'refunded')
            ->where('r.refunded_at', '>=', $ctx->fromInstant($from))
            ->where('r.refunded_at', '<', $ctx->toInstant($to));
        $this->onlineScope($query, $ctx);
        if ($this->needsProducts($ctx, $dims)) {
            $query->join('products as p', 'p.id', '=', 'ol.product_id');
        }
        $this->productFilters($query, $ctx, 'ol.product_id');

        return $this->select($query, $dims, [
            'day' => $ctx->sql->localDate('r.refunded_at'),
            'month' => $ctx->sql->localMonth('r.refunded_at'),
            'branch' => 'o.branch_id',
            'store' => 'o.store_id',
            'product' => 'ol.product_id',
            'category' => 'p.category_id',
            'brand' => 'p.brand_id',
            'cashier' => null,
            'tax_rate' => 'ol.tax_rate',
        ], [
            'rdocs' => 'COUNT(DISTINCT r.id)',
            'rqty' => 'SUM(rl.quantity)',
            'rnet' => 'SUM(rl.amount - rl.tax_amount)',
            'rtax' => 'SUM(rl.tax_amount)',
            'rcost' => 'SUM(CASE WHEN '.$ctx->sql->isTrue('rl.restock').' THEN rl.cost_total ELSE 0 END)',
        ]);
    }

    /**
     * @param  list<string>  $dims
     */
    private function delivery(ReportContext $ctx, array $dims, string $from, string $to): Builder
    {
        $query = DB::table('orders as o')
            ->where('o.organization_id', $ctx->organizationId)
            ->where('o.status', 'delivered')
            ->where('o.delivered_at', '>=', $ctx->fromInstant($from))
            ->where('o.delivered_at', '<', $ctx->toInstant($to));
        $this->onlineScope($query, $ctx);

        return $this->select($query, $dims, [
            'day' => $ctx->sql->localDate('o.delivered_at'),
            'month' => $ctx->sql->localMonth('o.delivered_at'),
            'branch' => 'o.branch_id',
            'store' => 'o.store_id',
        ], ['delivery' => 'SUM(o.shipping_total + o.cod_fee)']);
    }

    /**
     * @param  list<string>  $dims
     */
    private function deliveryRefunds(ReportContext $ctx, array $dims, string $from, string $to): Builder
    {
        $query = DB::table('order_returns as r')
            ->join('orders as o', 'o.id', '=', 'r.order_id')
            ->where('r.organization_id', $ctx->organizationId)
            ->where('r.status', 'refunded')
            ->where('r.refunded_at', '>=', $ctx->fromInstant($from))
            ->where('r.refunded_at', '<', $ctx->toInstant($to));
        $this->onlineScope($query, $ctx);

        return $this->select($query, $dims, [
            'day' => $ctx->sql->localDate('r.refunded_at'),
            'month' => $ctx->sql->localMonth('r.refunded_at'),
            'branch' => 'o.branch_id',
            'store' => 'o.store_id',
        ], ['delivery_refund' => 'SUM(r.shipping_refund)']);
    }

    private function posScope(Builder $query, ReportContext $ctx, string $alias, ?string $cashierColumn = null): void
    {
        $ctx->scopeBranches($query, $alias.'.branch_id');
        $query->when($ctx->param('store_id'), fn (Builder $q, string $id) => $q->where($alias.'.store_id', $id))
            ->when($ctx->param('cashier_id'), fn (Builder $q, string $id) => $q->where($cashierColumn ?? $alias.'.created_by', $id));
    }

    private function onlineScope(Builder $query, ReportContext $ctx): void
    {
        $ctx->scopeBranches($query, 'o.branch_id');
        $query->when($ctx->param('store_id'), fn (Builder $q, string $id) => $q->where('o.store_id', $id));
    }

    /**
     * Joins the variant (and product when needed) of POS lines; returns the product id expression.
     *
     * @param  list<string>  $dims
     */
    private function joinVariant(Builder $query, ReportContext $ctx, array $dims, string $variantColumn): string
    {
        $needsVariant = in_array('product', $dims, true) || $ctx->param('product_id') !== null || $this->needsProducts($ctx, $dims);
        if ($needsVariant) {
            $query->join('product_variants as pv', 'pv.id', '=', $variantColumn);
        }
        if ($this->needsProducts($ctx, $dims)) {
            $query->join('products as p', 'p.id', '=', 'pv.product_id');
        }
        $this->productFilters($query, $ctx, 'pv.product_id');

        return 'pv.product_id';
    }
}
