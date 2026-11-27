<?php

namespace App\Modules\Reports\Application\Reports;

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
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * VAT1: the sales register (Mushak-6.2) — one row per sales line, paged in SQL. The same
 * sales as SalesFacts (every sales report, the tax report):
 *   Sale    lines of completed till sales by `sold_at`; lines of delivered web orders by
 *           `delivered_at` (channel `pos` / `online`);
 *   Return  lines of completed till returns by `decided_at` and of refunded web returns by
 *           `refunded_at`, negative, at the rate of the line they return.
 * value = line net (after item and invoice discounts, excluding VAT; tax-inclusive shops'
 * stored net), VAT = line tax, total = value + VAT; SD is always 0 (no supplementary duty).
 * Buyer = the document's customer (name, BIN = `tax_number`); walk-in till sales
 * "Walk-in customer"; web orders the order's contact name. Delivery and COD fees are untaxed
 * and not listed. Needs `reports.financial` (as the tax report).
 */
class SalesRegisterReport implements Report
{
    public const WALK_IN = 'Walk-in customer';

    public function definition(): ReportDefinition
    {
        return new ReportDefinition(
            key: 'mushak_6_2',
            title: 'Sales register (Mushak-6.2)',
            description: 'Every sales line with the buyer, value, supplementary duty and VAT; till sales and delivered web orders, returns as negative rows.',
            group: ReportGroup::Finance,
            permission: 'reports.financial',
            params: [ReportParam::dateFrom(), ReportParam::dateTo(), ReportParam::branch(), ReportParam::channel()],
            columns: [
                ReportColumn::date('date', 'Date'),
                ReportColumn::text('type', 'Type', sortable: false),
                ReportColumn::text('invoice_number', 'Invoice no.', sortable: false),
                ReportColumn::text('buyer_name', "Buyer's name", sortable: false),
                ReportColumn::text('buyer_bin', "Buyer's BIN", sortable: false),
                ReportColumn::text('description', 'Description of goods / services', sortable: false),
                ReportColumn::quantity('quantity', 'Quantity')->notSortable(),
                ReportColumn::money('value', 'Value (excl. VAT)')->notSortable(),
                ReportColumn::money('sd', 'Supplementary duty')->notSortable(),
                ReportColumn::percent('vat_rate', 'VAT rate %')->notSortable(),
                ReportColumn::money('vat', 'VAT')->notSortable(),
                ReportColumn::money('total', 'Total value')->notSortable(),
            ],
            defaultSort: 'date',
        );
    }

    public function run(ReportContext $context): ReportResult
    {
        $totals = $this->lines($context)->selectRaw('SUM(x.value) as value, SUM(x.vat) as vat, SUM(x.total) as total')->first();

        return ReportResult::query(
            $this->lines($context)->select('x.*'),
            fn (Collection $rows) => $rows->map(fn ($l) => [
                'id' => $l->id,
                'date' => $l->date,
                'type' => $l->type,
                'channel' => $l->channel,
                'invoice_number' => $l->number,
                'buyer_name' => $l->buyer_name,
                'buyer_bin' => $l->buyer_bin,
                'description' => $l->variant_name !== null && $l->variant_name !== '' ? $l->product_name.' — '.$l->variant_name : $l->product_name,
                'quantity' => Sql::quantity($l->quantity),
                'value' => Sql::money($l->value),
                'sd' => '0.00',
                'vat_rate' => Decimal::round(Sql::plain($l->vat_rate), 2),
                'vat' => Sql::money($l->vat),
                'total' => Sql::money($l->total),
            ])->values()->all(),
            ['date' => 'x.at', ReportRunner::TIEBREAK => 'x.tiebreak'],
            ['value' => Sql::money($totals?->value), 'sd' => '0.00', 'vat' => Sql::money($totals?->vat), 'total' => Sql::money($totals?->total)],
        );
    }

    /**
     * Every register line of the period as one derived table `x` (id, at, date, type, channel,
     * number, buyer_name, buyer_bin, product_name, variant_name, quantity, value, vat_rate, vat,
     * total, tiebreak) — also what the monthly VAT summary (Mushak-9.1) adds up.
     */
    public function lines(ReportContext $context): Builder
    {
        $parts = [];
        if ($context->includesPos()) {
            $parts[] = $this->posSales($context);
            $parts[] = $this->posReturns($context);
        }
        if ($context->includesOnline()) {
            $parts[] = $this->webOrders($context);
            $parts[] = $this->webReturns($context);
        }
        $union = array_shift($parts);
        foreach ($parts as $part) {
            $union->unionAll($part);
        }

        return DB::query()->fromSub($union, 'x');
    }

    /** The leading columns of one source (literals are fixed words, never input). */
    private function columns(ReportContext $context, string $at, string $type, string $channel, string $line): string
    {
        return implode(', ', [
            "CAST({$line}.id AS TEXT) as id",
            "{$at} as at",
            $context->sql->localDate($at).' as date',
            "'{$type}' as type",
            "'{$channel}' as channel",
        ]).', ';
    }

    private function posSales(ReportContext $context): Builder
    {
        $query = DB::table('sale_lines as sl')
            ->join('sales as s', 's.id', '=', 'sl.sale_id')
            ->leftJoin('customers as c', 'c.id', '=', 's.customer_id')
            ->where('s.organization_id', $context->organizationId)
            ->where('s.status', 'completed')
            ->where('s.sold_at', '>=', $context->fromInstant())
            ->where('s.sold_at', '<', $context->toInstant());
        $context->scopeBranches($query, 's.branch_id');

        return $query->selectRaw($this->columns($context, 's.sold_at', 'Sale', 'pos', 'sl')
            ."s.number as number, COALESCE(c.name, '".self::WALK_IN."') as buyer_name, c.tax_number as buyer_bin, "
            .'sl.product_name as product_name, sl.variant_name as variant_name, sl.quantity as quantity, sl.net_amount as value, sl.tax_rate as vat_rate, '
            ."sl.tax_amount as vat, sl.net_amount + sl.tax_amount as total, s.number || ':' || CAST(sl.position + 10000 AS TEXT) as tiebreak");
    }

    private function posReturns(ReportContext $context): Builder
    {
        $query = DB::table('sale_return_lines as rl')
            ->join('sale_returns as r', 'r.id', '=', 'rl.sale_return_id')
            ->join('sale_lines as osl', 'osl.id', '=', 'rl.sale_line_id')
            ->join('sales as s', 's.id', '=', 'r.sale_id')
            ->leftJoin('customers as c', 'c.id', '=', 's.customer_id')
            ->where('r.organization_id', $context->organizationId)
            ->where('r.status', 'completed')
            ->where('r.decided_at', '>=', $context->fromInstant())
            ->where('r.decided_at', '<', $context->toInstant());
        $context->scopeBranches($query, 'r.branch_id');

        return $query->selectRaw($this->columns($context, 'r.decided_at', 'Return', 'pos', 'rl')
            ."r.number as number, COALESCE(c.name, '".self::WALK_IN."') as buyer_name, c.tax_number as buyer_bin, "
            .'osl.product_name as product_name, osl.variant_name as variant_name, -rl.quantity as quantity, -rl.net_amount as value, osl.tax_rate as vat_rate, '
            ."-rl.tax_amount as vat, -(rl.net_amount + rl.tax_amount) as total, r.number || ':' || CAST(osl.position + 10000 AS TEXT) as tiebreak");
    }

    private function webOrders(ReportContext $context): Builder
    {
        $query = DB::table('order_lines as ol')
            ->join('orders as o', 'o.id', '=', 'ol.order_id')
            ->leftJoin('customers as c', 'c.id', '=', 'o.customer_id')
            ->where('o.organization_id', $context->organizationId)
            ->where('o.status', 'delivered')
            ->where('o.delivered_at', '>=', $context->fromInstant())
            ->where('o.delivered_at', '<', $context->toInstant());
        $context->scopeBranches($query, 'o.branch_id');

        return $query->selectRaw($this->columns($context, 'o.delivered_at', 'Sale', 'online', 'ol')
            .'o.number as number, o.contact_name as buyer_name, c.tax_number as buyer_bin, '
            .'ol.product_name as product_name, ol.variant_name as variant_name, ol.quantity as quantity, ol.net_amount as value, ol.tax_rate as vat_rate, '
            ."ol.tax_amount as vat, ol.net_amount + ol.tax_amount as total, o.number || ':' || CAST(ol.position + 10000 AS TEXT) as tiebreak");
    }

    private function webReturns(ReportContext $context): Builder
    {
        $query = DB::table('order_return_lines as rl')
            ->join('order_returns as r', 'r.id', '=', 'rl.return_id')
            ->join('order_lines as ol', 'ol.id', '=', 'rl.order_line_id')
            ->join('orders as o', 'o.id', '=', 'r.order_id')
            ->leftJoin('customers as c', 'c.id', '=', 'o.customer_id')
            ->where('r.organization_id', $context->organizationId)
            ->where('r.status', 'refunded')
            ->where('r.refunded_at', '>=', $context->fromInstant())
            ->where('r.refunded_at', '<', $context->toInstant());
        $context->scopeBranches($query, 'o.branch_id');

        return $query->selectRaw($this->columns($context, 'r.refunded_at', 'Return', 'online', 'rl')
            .'r.number as number, o.contact_name as buyer_name, c.tax_number as buyer_bin, '
            .'ol.product_name as product_name, ol.variant_name as variant_name, -rl.quantity as quantity, -(rl.amount - rl.tax_amount) as value, ol.tax_rate as vat_rate, '
            ."-rl.tax_amount as vat, -rl.amount as total, r.number || ':' || CAST(ol.position + 10000 AS TEXT) as tiebreak");
    }
}
