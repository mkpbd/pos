<?php

namespace App\Modules\Reports\Application\Reports;

use App\Modules\Reports\Application\Contracts\Report;
use App\Modules\Reports\Application\ReportContext;
use App\Modules\Reports\Application\ReportResult;
use App\Modules\Reports\Application\Support\AgingBuckets;
use App\Modules\Reports\Application\Support\Sql;
use App\Modules\Reports\Domain\Aging;
use App\Modules\Reports\Domain\ReportColumn;
use App\Modules\Reports\Domain\ReportDefinition;
use App\Modules\Reports\Domain\ReportGroup;
use App\Modules\Reports\Domain\ReportParam;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Supplier dues (accounts payable) as of today, per supplier — the same balance as
 * Purchasing's SupplierAccount (SC3 included): opening balance + goods receipts at their
 * payable total + receipt charges the supplier billed (amount + tax) + posted landed cost
 * vouchers it billed − purchase returns − supplier payments. Aged from invoice dates (receipt
 * invoice date, voucher date); the opening balance is "over 90 days"; returns and payments
 * settle the oldest buckets first.
 *
 * Branch scope: documents of the branches in scope; the opening balance and payments without
 * a branch are included only when the report covers every branch.
 */
class SupplierDuesReport implements Report
{
    public function definition(): ReportDefinition
    {
        return new ReportDefinition(
            key: 'supplier_dues',
            title: 'Supplier dues',
            description: 'What is owed to each supplier today (receipts, charges and landed cost vouchers less returns and payments), aged from invoice dates.',
            group: ReportGroup::Purchasing,
            permission: 'reports.view',
            params: [ReportParam::branch(), ReportParam::supplier()],
            columns: [
                ReportColumn::text('supplier', 'Supplier'),
                ReportColumn::text('code', 'Code'),
                ReportColumn::text('phone', 'Phone'),
                ReportColumn::money('outstanding', 'Outstanding'),
                ...CustomerDuesReport::bucketColumns(),
                ReportColumn::date('last_payment_on', 'Last payment'),
            ],
            defaultSort: '-outstanding',
        );
    }

    public function run(ReportContext $context): ReportResult
    {
        $aging = new AgingBuckets($context->today());
        $supplier = $context->param('supplier_id');
        $org = $context->organizationId;
        $all = $context->branchIds === null;

        $bucket = $aging->bucketSql($context->sql->date('r.invoice_date'));
        $receipts = DB::table('goods_receipts as r')->where('r.organization_id', $org);
        $this->scope($receipts, $context, 'r.branch_id', 'r.supplier_id', $supplier);
        $aging->addDebits($receipts->groupBy('r.supplier_id')->groupByRaw($bucket)->selectRaw("r.supplier_id as party, {$bucket} as bucket, SUM(r.payable_total) as amount"));

        $charges = DB::table('goods_receipt_charges as c')->join('goods_receipts as r', 'r.id', '=', 'c.goods_receipt_id')
            ->where('c.organization_id', $org)->whereNotNull('c.charge_supplier_id');
        $this->scope($charges, $context, 'r.branch_id', 'c.charge_supplier_id', $supplier);
        $aging->addDebits($charges->groupBy('c.charge_supplier_id')->groupByRaw($bucket)->selectRaw("c.charge_supplier_id as party, {$bucket} as bucket, SUM(c.amount + c.tax_amount) as amount"));

        $voucherBucket = $aging->bucketSql($context->sql->date('v.voucher_date'));
        $vouchers = DB::table('landed_cost_vouchers as v')->where('v.organization_id', $org)->where('v.status', 'posted');
        $this->scope($vouchers, $context, 'v.branch_id', 'v.charge_supplier_id', $supplier);
        $aging->addDebits($vouchers->groupBy('v.charge_supplier_id')->groupByRaw($voucherBucket)->selectRaw("v.charge_supplier_id as party, {$voucherBucket} as bucket, SUM(v.total) as amount"));

        $returns = DB::table('purchase_returns as pr')->where('pr.organization_id', $org);
        $this->scope($returns, $context, 'pr.branch_id', 'pr.supplier_id', $supplier);
        $aging->addCredits($returns->groupBy('pr.supplier_id')->selectRaw('pr.supplier_id as party, SUM(pr.total) as amount'));

        $payments = DB::table('supplier_payments as sp')->where('sp.organization_id', $org);
        $this->scope($payments, $context, 'sp.branch_id', 'sp.supplier_id', $supplier);
        $aging->addCredits((clone $payments)->groupBy('sp.supplier_id')->selectRaw('sp.supplier_id as party, SUM(sp.amount) as amount'));
        $lastPayments = (clone $payments)->groupBy('sp.supplier_id')->selectRaw('sp.supplier_id as party, MAX(sp.paid_on) as last_on')->pluck('last_on', 'party');

        if ($all) {
            $openings = DB::table('suppliers')->where('organization_id', $org)->where('opening_balance', '<>', 0)
                ->when($supplier, fn (Builder $q, string $id) => $q->where('id', $id))->get(['id', 'opening_balance']);
            foreach ($openings as $s) {
                $opening = Sql::money($s->opening_balance);
                Decimal::isNegative($opening) ? $aging->addCredit($s->id, Decimal::negate($opening, 2)) : $aging->addDebit($s->id, 'days_over_90', $opening);
            }
        }

        $results = array_filter($aging->results(), fn (array $r) => ! Decimal::isZero($r['outstanding']));
        $info = DB::table('suppliers')->where('organization_id', $org)->whereIn('id', array_keys($results))->get(['id', 'name', 'code', 'phone'])->keyBy('id');

        $rows = [];
        $totals = array_fill_keys(['outstanding', ...Aging::BUCKETS], '0.00');
        foreach ($results as $id => $r) {
            $s = $info[$id] ?? null;
            $last = $lastPayments[$id] ?? null;
            $rows[] = [
                'supplier_id' => $id,
                'supplier' => $s->name ?? 'Unknown supplier',
                'code' => $s->code ?? null,
                'phone' => $s->phone ?? null,
                ...$r,
                'last_payment_on' => $last === null ? null : substr((string) $last, 0, 10),
            ];
            foreach ($totals as $key => $sum) {
                $totals[$key] = Decimal::add($sum, $r[$key], 2);
            }
        }

        return ReportResult::rows($rows, $totals + ['suppliers' => count($rows)], meta: ['as_of' => $context->today(), 'includes_opening_balances' => $all]);
    }

    private function scope(Builder $query, ReportContext $context, string $branchColumn, string $supplierColumn, ?string $supplierId): void
    {
        // Supplier payments may have no branch: they belong to the whole organization.
        $context->scopeBranches($query, $branchColumn);
        $query->when($supplierId, fn (Builder $q, string $id) => $q->where($supplierColumn, $id));
    }
}
