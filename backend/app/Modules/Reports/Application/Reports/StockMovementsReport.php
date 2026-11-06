<?php

namespace App\Modules\Reports\Application\Reports;

use App\Modules\Inventory\Domain\MovementType;
use App\Modules\Reports\Application\Contracts\Report;
use App\Modules\Reports\Application\ReportContext;
use App\Modules\Reports\Application\ReportResult;
use App\Modules\Reports\Application\ReportRunner;
use App\Modules\Reports\Application\Support\Sql;
use App\Modules\Reports\Domain\ReportColumn;
use App\Modules\Reports\Domain\ReportDefinition;
use App\Modules\Reports\Domain\ReportGroup;
use App\Modules\Reports\Domain\ReportParam;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * The stock ledger over a date range (paged in SQL — it can be long): every movement with
 * its direction, quantity, balance after and cost. Totals: quantity in / out and value. With a
 * product chosen (one product, all its variants, in the stores in scope), the totals also
 * carry the opening quantity (Σ movements before the range) and the closing quantity
 * (opening + in − out) — unless a movement type is chosen too. Value-only `landed_cost` movements move no quantity and carry their
 * value. Unit cost and value are cost-sensitive.
 */
class StockMovementsReport implements Report
{
    public function definition(): ReportDefinition
    {
        $types = [];
        foreach (MovementType::cases() as $type) {
            $types[$type->value] = Str::ucfirst(str_replace('_', ' ', $type->value));
        }

        return new ReportDefinition(
            key: 'stock_movements',
            title: 'Stock movements',
            description: 'Every stock movement in the period with quantities in and out and the balance after; opening and closing quantity when a product is chosen.',
            group: ReportGroup::Inventory,
            permission: 'reports.view',
            params: [
                ReportParam::dateFrom(), ReportParam::dateTo(), ReportParam::branch(), ReportParam::store(),
                ReportParam::product(), ReportParam::enum('type', 'Movement type', $types),
            ],
            columns: [
                ReportColumn::dateTime('date', 'Date'),
                ReportColumn::text('product', 'Product', sortable: false),
                ReportColumn::text('sku', 'SKU', sortable: false),
                ReportColumn::text('store', 'Store', sortable: false),
                ReportColumn::text('type', 'Type', sortable: false),
                ReportColumn::text('reference', 'Reference', sortable: false),
                ReportColumn::quantity('quantity_in', 'In'),
                ReportColumn::quantity('quantity_out', 'Out'),
                ReportColumn::quantity('balance_after', 'Balance after'),
                ReportColumn::money('unit_cost', 'Unit cost', costSensitive: true),
                ReportColumn::money('value', 'Value', costSensitive: true),
            ],
            defaultSort: 'date',
        );
    }

    public function run(ReportContext $context): ReportResult
    {
        $query = $this->base($context)
            ->where('m.created_at', '>=', $context->fromInstant())
            ->where('m.created_at', '<', $context->toInstant())
            ->join('stores as st', 'st.id', '=', 'm.store_id')
            ->select([
                'm.id', 'm.created_at', 'm.type', 'm.quantity', 'm.unit_cost', 'm.value', 'm.balance_after',
                'm.reference_type', 'm.reference_id', 'm.reference_number', 'm.store_id', 'm.variant_id',
                'p.id as product_id', 'p.name as product_name', 'pv.name as variant_name', 'pv.sku', 'st.name as store_name',
            ]);

        $totals = $this->base($context)
            ->where('m.created_at', '>=', $context->fromInstant())
            ->where('m.created_at', '<', $context->toInstant())
            ->selectRaw('SUM(CASE WHEN m.quantity > 0 THEN m.quantity ELSE 0 END) as quantity_in, SUM(CASE WHEN m.quantity < 0 THEN -m.quantity ELSE 0 END) as quantity_out, '
                .'SUM(CASE WHEN m.value IS NOT NULL THEN m.value ELSE m.quantity * m.unit_cost END) as value')
            ->first();
        $in = Sql::quantity($totals?->quantity_in);
        $out = Sql::quantity($totals?->quantity_out);
        $summary = ['quantity_in' => $in, 'quantity_out' => $out, 'value' => Sql::money($totals?->value)];

        if ($context->param('product_id') !== null && $context->param('type') === null) {
            $opening = Sql::quantity($this->base($context)->where('m.created_at', '<', $context->fromInstant())->sum('m.quantity'));
            $summary['opening_quantity'] = $opening;
            $summary['closing_quantity'] = Decimal::sub(Decimal::add($opening, $in, 3), $out, 3);
        }

        $timezone = $context->timezone;

        return ReportResult::query(
            $query,
            fn (Collection $rows) => $rows->map(fn ($m) => [
                'id' => $m->id,
                'date' => CarbonImmutable::parse($m->created_at, 'UTC')->setTimezone($timezone)->toIso8601String(),
                'product_id' => $m->product_id,
                'variant_id' => $m->variant_id,
                'product' => $m->variant_name !== null && $m->variant_name !== '' ? $m->product_name.' — '.$m->variant_name : $m->product_name,
                'sku' => $m->sku,
                'store_id' => $m->store_id,
                'store' => $m->store_name,
                'movement_type' => $m->type,
                'type' => Str::ucfirst(str_replace('_', ' ', (string) $m->type)),
                'reference_type' => $m->reference_type,
                'reference_id' => $m->reference_id,
                'reference' => $m->reference_number,
                'quantity_in' => Decimal::compare(Sql::plain($m->quantity), '0') > 0 ? Sql::quantity($m->quantity) : '0.000',
                'quantity_out' => Decimal::compare(Sql::plain($m->quantity), '0') < 0 ? Decimal::negate(Sql::quantity($m->quantity), 3) : '0.000',
                'balance_after' => Sql::quantity($m->balance_after),
                'unit_cost' => Decimal::round(Sql::plain($m->unit_cost), 4),
                'value' => $m->value !== null ? Sql::money($m->value) : Decimal::round(Decimal::mul(Sql::plain($m->quantity), Sql::plain($m->unit_cost), 6), 2),
            ])->values()->all(),
            ['date' => 'm.created_at', ReportRunner::TIEBREAK => 'm.id'],
            $summary,
        );
    }

    private function base(ReportContext $context): Builder
    {
        $query = DB::table('stock_movements as m')
            ->join('product_variants as pv', 'pv.id', '=', 'm.variant_id')
            ->join('products as p', 'p.id', '=', 'pv.product_id')
            ->where('m.organization_id', $context->organizationId);
        $context->scopeBranches($query, 'm.branch_id');

        return $query->when($context->param('store_id'), fn (Builder $q, string $id) => $q->where('m.store_id', $id))
            ->when($context->param('product_id'), fn (Builder $q, string $id) => $q->where('pv.product_id', $id))
            ->when($context->param('type'), fn (Builder $q, string $type) => $q->where('m.type', $type));
    }
}
