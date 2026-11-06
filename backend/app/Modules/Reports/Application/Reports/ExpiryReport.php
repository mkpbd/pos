<?php

namespace App\Modules\Reports\Application\Reports;

use App\Modules\Reports\Application\Contracts\Report;
use App\Modules\Reports\Application\ReportContext;
use App\Modules\Reports\Application\ReportResult;
use App\Modules\Reports\Application\Support\Sql;
use App\Modules\Reports\Domain\ReportColumn;
use App\Modules\Reports\Domain\ReportDefinition;
use App\Modules\Reports\Domain\ReportGroup;
use App\Modules\Reports\Domain\ReportParam;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Carbon\CarbonImmutable;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Batches with stock on hand that expire within `days` days of today (organization date) —
 * and, unless `include_expired` is off, those already expired — per store, with quantity and
 * value at the level's average cost (cost-sensitive). days_left < 0 = expired.
 */
class ExpiryReport implements Report
{
    public function definition(): ReportDefinition
    {
        return new ReportDefinition(
            key: 'expiry',
            title: 'Expiry',
            description: 'Batches in stock that are expired or expire within the chosen number of days, with quantity and value.',
            group: ReportGroup::Inventory,
            permission: 'reports.view',
            params: [
                ReportParam::branch(), ReportParam::store(), ReportParam::product(),
                ReportParam::integer('days', 'Expiring within (days)', 0, 3650, 30),
                ReportParam::boolean('include_expired', 'Include expired', true),
            ],
            columns: [
                ReportColumn::text('product', 'Product'),
                ReportColumn::text('sku', 'SKU'),
                ReportColumn::text('batch', 'Batch'),
                ReportColumn::date('expires_on', 'Expires on'),
                ReportColumn::number('days_left', 'Days left'),
                ReportColumn::text('status', 'Status'),
                ReportColumn::text('store', 'Store'),
                ReportColumn::quantity('quantity', 'Quantity'),
                ReportColumn::money('value', 'Value', costSensitive: true),
            ],
            defaultSort: 'expires_on',
        );
    }

    public function run(ReportContext $context): ReportResult
    {
        $today = CarbonImmutable::parse($context->today());
        $until = $today->addDays((int) $context->param('days', 30))->toDateString();
        $query = DB::table('stock_levels as sl')
            ->join('batches as b', 'b.id', '=', 'sl.batch_id')
            ->join('product_variants as pv', 'pv.id', '=', 'sl.variant_id')
            ->join('products as p', 'p.id', '=', 'pv.product_id')
            ->join('stores as st', 'st.id', '=', 'sl.store_id')
            ->where('sl.organization_id', $context->organizationId)
            ->where('sl.quantity', '>', 0)
            ->whereNotNull('b.expires_on')
            ->where('b.expires_on', '<', CarbonImmutable::parse($until)->addDay()->toDateString());
        $context->scopeBranches($query, 'sl.branch_id');
        $query->when($context->param('store_id'), fn (Builder $q, string $id) => $q->where('sl.store_id', $id))
            ->when($context->param('product_id'), fn (Builder $q, string $id) => $q->where('pv.product_id', $id))
            ->when($context->param('include_expired') === false, fn (Builder $q) => $q->where('b.expires_on', '>=', $today->toDateString()));

        $rows = [];
        $quantity = '0.000';
        $value = '0.00';
        $expired = 0;
        foreach ($query->get(['sl.store_id', 'st.name as store_name', 'sl.variant_id', 'pv.sku', 'pv.name as variant_name', 'p.id as product_id', 'p.name as product_name',
            'b.id as batch_id', 'b.batch_number', 'b.expires_on', 'sl.quantity', DB::raw('sl.quantity * sl.average_cost as value')]) as $row) {
            $expiresOn = substr((string) $row->expires_on, 0, 10);
            $daysLeft = (int) $today->diffInDays(CarbonImmutable::parse($expiresOn), false);
            $rows[] = [
                'product_id' => $row->product_id,
                'variant_id' => $row->variant_id,
                'product' => $row->variant_name !== null && $row->variant_name !== '' ? $row->product_name.' — '.$row->variant_name : $row->product_name,
                'sku' => $row->sku,
                'batch_id' => $row->batch_id,
                'batch' => $row->batch_number,
                'expires_on' => $expiresOn,
                'days_left' => $daysLeft,
                'status' => $daysLeft < 0 ? 'Expired' : ($daysLeft === 0 ? 'Expires today' : 'Expiring'),
                'expired' => $daysLeft < 0,
                'store_id' => $row->store_id,
                'store' => $row->store_name,
                'quantity' => Sql::quantity($row->quantity),
                'value' => Sql::money($row->value),
            ];
            $quantity = Decimal::add($quantity, Sql::quantity($row->quantity), 3);
            $value = Decimal::add($value, Sql::money($row->value), 2);
            $expired += $daysLeft < 0 ? 1 : 0;
        }

        return ReportResult::rows($rows, ['quantity' => $quantity, 'value' => $value, 'batches' => count($rows), 'expired_batches' => $expired]);
    }
}
