<?php

namespace App\Modules\Reports\Application\Support;

use App\Modules\Reports\Application\ReportContext;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Illuminate\Database\Query\Builder;
use Illuminate\Database\Query\JoinClause;
use Illuminate\Support\Facades\DB;

/**
 * Low stock (shared by the low_stock report and the dashboard): per store and variant of a
 * stock-tracked, non-archived product, on hand (all batches) at or below its reorder point,
 * where the reorder point is the store's active SC1 reorder rule (`min_qty`) or else the
 * variant's `reorder_level`, and is above zero. Variants with an active rule but no stock row
 * in the store count with 0 on hand.
 */
final class LowStock
{
    /**
     * @return list<array{store_id: string, branch_id: string, variant_id: string, on_hand: string, reorder_point: string, shortfall: string, has_rule: bool}>
     */
    public function rows(ReportContext $context): array
    {
        $levels = DB::table('stock_levels as sl')
            ->join('product_variants as pv', 'pv.id', '=', 'sl.variant_id')
            ->join('products as p', 'p.id', '=', 'pv.product_id')
            ->leftJoin('stock_reorder_rules as r', fn (JoinClause $j) => $j->on('r.store_id', '=', 'sl.store_id')->on('r.variant_id', '=', 'sl.variant_id')->where('r.is_active', true))
            ->where('sl.organization_id', $context->organizationId);
        $this->filters($levels, $context, 'sl');
        $point = 'COALESCE(MAX(r.min_qty), MAX(pv.reorder_level))';
        $levels->groupBy('sl.store_id', 'sl.branch_id', 'sl.variant_id')
            ->havingRaw("{$point} > 0 AND SUM(sl.quantity) <= {$point}")
            ->selectRaw("sl.store_id, sl.branch_id, sl.variant_id, SUM(sl.quantity) as on_hand, {$point} as reorder_point, MAX(CASE WHEN r.id IS NULL THEN 0 ELSE 1 END) as has_rule");

        $rules = DB::table('stock_reorder_rules as r')
            ->join('product_variants as pv', 'pv.id', '=', 'r.variant_id')
            ->join('products as p', 'p.id', '=', 'pv.product_id')
            ->where('r.organization_id', $context->organizationId)
            ->where('r.is_active', true)
            ->where('r.min_qty', '>', 0)
            ->whereNotExists(fn (Builder $q) => $q->from('stock_levels as x')->whereColumn('x.store_id', 'r.store_id')->whereColumn('x.variant_id', 'r.variant_id'));
        $this->filters($rules, $context, 'r');
        $rules->select(['r.store_id', 'r.branch_id', 'r.variant_id', DB::raw('0 as on_hand'), 'r.min_qty as reorder_point', DB::raw('1 as has_rule')]);

        $rows = [];
        foreach ([...$levels->get()->all(), ...$rules->get()->all()] as $row) {
            $onHand = Sql::quantity($row->on_hand);
            $point = Sql::quantity($row->reorder_point);
            $rows[] = [
                'store_id' => $row->store_id,
                'branch_id' => $row->branch_id,
                'variant_id' => $row->variant_id,
                'on_hand' => $onHand,
                'reorder_point' => $point,
                'shortfall' => Decimal::sub($point, $onHand, 3),
                'has_rule' => (bool) $row->has_rule,
            ];
        }

        return $rows;
    }

    private function filters(Builder $query, ReportContext $context, string $alias): void
    {
        $query->whereNull('p.deleted_at')->whereNull('pv.deleted_at')->where('p.track_stock', true)->where('p.type', 'standard');
        $context->scopeBranches($query, $alias.'.branch_id');
        $query->when($context->param('store_id'), fn (Builder $q, string $id) => $q->where($alias.'.store_id', $id))
            ->when($context->param('product_id'), fn (Builder $q, string $id) => $q->where('pv.product_id', $id))
            ->when($context->categoryIds, fn (Builder $q, array $ids) => $q->whereIn('p.category_id', $ids))
            ->when($context->param('brand_id'), fn (Builder $q, string $id) => $q->where('p.brand_id', $id))
            ->when($context->param('supplier_id'), fn (Builder $q, string $id) => $q->whereExists(fn (Builder $s) => $s->from('supplier_products as sp')
                ->whereColumn('sp.variant_id', 'pv.id')->where('sp.supplier_id', $id)->where('sp.is_preferred', true)));
    }
}
