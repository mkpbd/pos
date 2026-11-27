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
 * VAT1: the purchase register (Mushak-6.1) — one row per line, paged in SQL. The same
 * purchases as the tax and purchases reports:
 *   Purchase  goods receipt lines by the receipt's `invoice_date`;
 *   Return    purchase return lines (receipt-based and direct) by the return's local date,
 *             negative.
 * value = line subtotal (excluding VAT, after the ST2a line discount), VAT = line tax (input
 * VAT), total = value + VAT; SD is always 0. Quantity = the invoiced quantity (bonus units are
 * free). Supplier BIN = the supplier's `tax_number`; the supplier invoice number of a return is
 * its receipt's. Landed-cost charges (receipt charges, landed cost vouchers) are not rows.
 * Needs `reports.financial` (as the tax report).
 */
class PurchaseRegisterReport implements Report
{
    public function definition(): ReportDefinition
    {
        return new ReportDefinition(
            key: 'mushak_6_1',
            title: 'Purchase register (Mushak-6.1)',
            description: 'Every goods receipt line with the supplier, value and input VAT; purchase returns as negative rows. Landed-cost charges (freight, duty, …) are not listed.',
            group: ReportGroup::Finance,
            permission: 'reports.financial',
            params: [ReportParam::dateFrom(), ReportParam::dateTo(), ReportParam::branch()],
            columns: [
                ReportColumn::date('date', 'Date'),
                ReportColumn::text('type', 'Type', sortable: false),
                ReportColumn::text('receipt_number', 'Receipt (GRN) no.', sortable: false),
                ReportColumn::text('supplier_name', "Supplier's name", sortable: false),
                ReportColumn::text('supplier_bin', "Supplier's BIN", sortable: false),
                ReportColumn::text('supplier_invoice_number', "Supplier's invoice no.", sortable: false),
                ReportColumn::text('description', 'Description of goods / services', sortable: false),
                ReportColumn::quantity('quantity', 'Quantity')->notSortable(),
                ReportColumn::money('value', 'Value (excl. VAT)')->notSortable(),
                ReportColumn::money('sd', 'Supplementary duty')->notSortable(),
                ReportColumn::percent('vat_rate', 'VAT rate %')->notSortable(),
                ReportColumn::money('vat', 'VAT (input)')->notSortable(),
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
                'receipt_number' => $l->number,
                'supplier_name' => $l->supplier_name,
                'supplier_bin' => $l->supplier_bin,
                'supplier_invoice_number' => $l->supplier_invoice_number,
                'description' => $l->variant_name !== null && $l->variant_name !== '' ? $l->product_name.' — '.$l->variant_name : $l->product_name,
                'quantity' => Sql::quantity($l->quantity),
                'value' => Sql::money($l->value),
                'sd' => '0.00',
                'vat_rate' => Decimal::round(Sql::plain($l->vat_rate), 2),
                'vat' => Sql::money($l->vat),
                'total' => Sql::money($l->total),
            ])->values()->all(),
            ['date' => 'x.date', ReportRunner::TIEBREAK => 'x.tiebreak'],
            ['value' => Sql::money($totals?->value), 'sd' => '0.00', 'vat' => Sql::money($totals?->vat), 'total' => Sql::money($totals?->total)],
        );
    }

    /**
     * Every register line of the period as one derived table `x` (id, date, type, number,
     * supplier_name, supplier_bin, supplier_invoice_number, product_name, variant_name,
     * quantity, value, vat_rate, vat, total, tiebreak) — also what the monthly VAT summary adds up.
     */
    public function lines(ReportContext $context): Builder
    {
        $receipts = DB::table('goods_receipt_lines as l')
            ->join('goods_receipts as r', 'r.id', '=', 'l.goods_receipt_id')
            ->join('suppliers as su', 'su.id', '=', 'r.supplier_id')
            ->join('product_variants as pv', 'pv.id', '=', 'l.variant_id')
            ->join('products as p', 'p.id', '=', 'pv.product_id')
            ->where('r.organization_id', $context->organizationId)
            ->where('r.invoice_date', '>=', $context->from())
            ->where('r.invoice_date', '<', $context->toExclusive());
        $context->scopeBranches($receipts, 'r.branch_id');
        $receipts->selectRaw('CAST(l.id AS TEXT) as id, '.$context->sql->date('r.invoice_date')." as date, 'Purchase' as type, r.number as number, "
            .'su.name as supplier_name, su.tax_number as supplier_bin, r.supplier_invoice_number as supplier_invoice_number, '
            .'p.name as product_name, pv.name as variant_name, l.quantity as quantity, l.line_subtotal as value, l.tax_rate as vat_rate, '
            ."l.line_tax as vat, l.line_subtotal + l.line_tax as total, r.number || ':' || CAST(l.id AS TEXT) as tiebreak");

        $returns = DB::table('purchase_return_lines as rl')
            ->join('purchase_returns as pr', 'pr.id', '=', 'rl.purchase_return_id')
            ->leftJoin('goods_receipts as gr', 'gr.id', '=', 'pr.goods_receipt_id')
            ->join('suppliers as su', 'su.id', '=', 'pr.supplier_id')
            ->join('product_variants as pv', 'pv.id', '=', 'rl.variant_id')
            ->join('products as p', 'p.id', '=', 'pv.product_id')
            ->where('pr.organization_id', $context->organizationId)
            ->where('pr.created_at', '>=', $context->fromInstant())
            ->where('pr.created_at', '<', $context->toInstant());
        $context->scopeBranches($returns, 'pr.branch_id');
        $returns->selectRaw('CAST(rl.id AS TEXT) as id, '.$context->sql->localDate('pr.created_at')." as date, 'Return' as type, pr.number as number, "
            .'su.name as supplier_name, su.tax_number as supplier_bin, gr.supplier_invoice_number as supplier_invoice_number, '
            .'p.name as product_name, pv.name as variant_name, -rl.quantity as quantity, -rl.line_subtotal as value, rl.tax_rate as vat_rate, '
            ."-rl.line_tax as vat, -(rl.line_subtotal + rl.line_tax) as total, pr.number || ':' || CAST(rl.id AS TEXT) as tiebreak");

        return DB::query()->fromSub($receipts->unionAll($returns), 'x');
    }
}
