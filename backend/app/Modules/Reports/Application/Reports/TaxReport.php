<?php

namespace App\Modules\Reports\Application\Reports;

use App\Modules\Reports\Application\Contracts\Report;
use App\Modules\Reports\Application\ReportContext;
use App\Modules\Reports\Application\ReportResult;
use App\Modules\Reports\Application\Support\SalesFacts;
use App\Modules\Reports\Application\Support\Sql;
use App\Modules\Reports\Domain\ReportColumn;
use App\Modules\Reports\Domain\ReportDefinition;
use App\Modules\Reports\Domain\ReportGroup;
use App\Modules\Reports\Domain\ReportParam;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Tax (VAT) per rate for the period:
 *   output tax  = tax on POS sales and delivered web orders − tax on their returns (SalesFacts,
 *                 by the line's rate); taxable sales = net sales at that rate
 *   input tax   = tax on goods receipts (invoice date) − tax on purchase returns (return date),
 *                 by line rate; taxable purchases = goods at that rate (excl. tax)
 *   charges     = recoverable tax on receipt charges (SC3, receipt invoice date) and on posted
 *                 landed cost vouchers (voucher date) — one "Charges" row (no single rate)
 *   net tax     = output tax − input tax (positive = payable)
 * Delivery and COD fees of web orders are untaxed. Needs `reports.financial`.
 */
class TaxReport implements Report
{
    public function __construct(private readonly SalesFacts $facts) {}

    public function definition(): ReportDefinition
    {
        return new ReportDefinition(
            key: 'tax',
            title: 'Tax',
            description: 'Output tax on sales and input tax on purchases and charges per tax rate, and the net tax payable.',
            group: ReportGroup::Finance,
            permission: 'reports.financial',
            params: [ReportParam::dateFrom(), ReportParam::dateTo(), ReportParam::branch()],
            columns: [
                ReportColumn::text('tax', 'Tax rate'),
                ReportColumn::percent('rate', 'Rate %'),
                ReportColumn::money('taxable_sales', 'Taxable sales'),
                ReportColumn::money('output_tax', 'Output tax'),
                ReportColumn::money('taxable_purchases', 'Taxable purchases'),
                ReportColumn::money('input_tax', 'Input tax'),
                ReportColumn::money('net_tax', 'Net tax'),
            ],
            defaultSort: 'rate',
        );
    }

    public function run(ReportContext $context): ReportResult
    {
        $rates = [];
        $row = function (?string $rate) use (&$rates): string {
            $key = $rate ?? 'charges';
            $rates[$key] ??= ['taxable_sales' => '0', 'output_tax' => '0', 'taxable_purchases' => '0', 'input_tax' => '0'];

            return $key;
        };
        $add = function (string $key, string $field, mixed $amount) use (&$rates) {
            $rates[$key][$field] = Decimal::add($rates[$key][$field], Sql::plain($amount), 6);
        };

        foreach ($this->facts->aggregate($context, ['tax_rate']) as $agg) {
            $key = $row(Decimal::round((string) $agg['tax_rate'], 4));
            $add($key, 'taxable_sales', $agg['net_sales']);
            $add($key, 'output_tax', $agg['tax']);
        }

        $received = $this->receipts($context)->groupBy('l.tax_rate')
            ->selectRaw('l.tax_rate as rate, SUM(l.line_subtotal) as base, SUM(l.line_tax) as tax')->get();
        foreach ($received as $r) {
            $key = $row(Decimal::round(Sql::plain($r->rate), 4));
            $add($key, 'taxable_purchases', $r->base);
            $add($key, 'input_tax', $r->tax);
        }
        $returned = $this->purchaseReturns($context)->groupBy('rl.tax_rate')
            ->selectRaw('rl.tax_rate as rate, SUM(rl.line_subtotal) as base, SUM(rl.line_tax) as tax')->get();
        foreach ($returned as $r) {
            $key = $row(Decimal::round(Sql::plain($r->rate), 4));
            $add($key, 'taxable_purchases', Decimal::negate(Sql::plain($r->base), 6));
            $add($key, 'input_tax', Decimal::negate(Sql::plain($r->tax), 6));
        }

        $charges = DB::table('goods_receipt_charges as c')->join('goods_receipts as r', 'r.id', '=', 'c.goods_receipt_id')
            ->where('c.organization_id', $context->organizationId)
            ->where('r.invoice_date', '>=', $context->from())->where('r.invoice_date', '<', $context->toExclusive());
        $context->scopeBranches($charges, 'r.branch_id');
        $charges = $charges->selectRaw('SUM(c.amount) as base, SUM(c.tax_amount) as tax, COUNT(*) as n')->first();
        $vouchers = DB::table('landed_cost_vouchers as v')->where('v.organization_id', $context->organizationId)->where('v.status', 'posted')
            ->where('v.voucher_date', '>=', $context->from())->where('v.voucher_date', '<', $context->toExclusive());
        $context->scopeBranches($vouchers, 'v.branch_id');
        $vouchers = $vouchers->selectRaw('SUM(v.charges_total) as base, SUM(v.tax_total) as tax, COUNT(*) as n')->first();
        if ((int) ($charges->n ?? 0) + (int) ($vouchers->n ?? 0) > 0) {
            $key = $row(null);
            $add($key, 'taxable_purchases', Decimal::add(Sql::plain($charges->base ?? 0), Sql::plain($vouchers->base ?? 0), 6));
            $add($key, 'input_tax', Decimal::add(Sql::plain($charges->tax ?? 0), Sql::plain($vouchers->tax ?? 0), 6));
        }

        $rows = [];
        $totals = ['taxable_sales' => '0.00', 'output_tax' => '0.00', 'taxable_purchases' => '0.00', 'input_tax' => '0.00', 'net_tax' => '0.00'];
        foreach ($rates as $key => $r) {
            $figures = array_map(fn (string $v) => Decimal::round($v, 2), $r);
            $figures['net_tax'] = Decimal::sub($figures['output_tax'], $figures['input_tax'], 2);
            $rate = $key === 'charges' ? null : Decimal::round($key, 2);
            $rows[] = [
                'key' => $key,
                'tax' => $rate === null ? 'Charges (freight, duty, …)' : self::label($rate),
                'rate' => $rate,
            ] + $figures;
            foreach ($totals as $field => $sum) {
                $totals[$field] = Decimal::add($sum, $figures[$field], 2);
            }
        }

        return ReportResult::rows($rows, $totals);
    }

    private static function label(string $rate): string
    {
        $text = str_contains($rate, '.') ? rtrim(rtrim($rate, '0'), '.') : $rate;

        return $text.'%';
    }

    private function receipts(ReportContext $context): Builder
    {
        $query = DB::table('goods_receipt_lines as l')->join('goods_receipts as r', 'r.id', '=', 'l.goods_receipt_id')
            ->where('r.organization_id', $context->organizationId)
            ->where('r.invoice_date', '>=', $context->from())->where('r.invoice_date', '<', $context->toExclusive());

        return $context->scopeBranches($query, 'r.branch_id');
    }

    private function purchaseReturns(ReportContext $context): Builder
    {
        $query = DB::table('purchase_return_lines as rl')->join('purchase_returns as pr', 'pr.id', '=', 'rl.purchase_return_id')
            ->where('pr.organization_id', $context->organizationId)
            ->where('pr.created_at', '>=', $context->fromInstant())->where('pr.created_at', '<', $context->toInstant());

        return $context->scopeBranches($query, 'pr.branch_id');
    }
}
