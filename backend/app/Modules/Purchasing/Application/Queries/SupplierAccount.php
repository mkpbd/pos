<?php

namespace App\Modules\Purchasing\Application\Queries;

use App\Modules\Purchasing\Domain\LandedCost\LandedCostVoucherStatus;
use App\Modules\Purchasing\Infrastructure\Models\GoodsReceipt;
use App\Modules\Purchasing\Infrastructure\Models\GoodsReceiptCharge;
use App\Modules\Purchasing\Infrastructure\Models\LandedCostVoucher;
use App\Modules\Purchasing\Infrastructure\Models\PurchaseReturn;
use App\Modules\Purchasing\Infrastructure\Models\SupplierPayment;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Suppliers\Application\Contracts\SupplierDirectory;
use Illuminate\Support\Collection;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * What the organization owes each supplier:
 *   opening balance + goods receipts (payable total) + receipt charges it billed
 *   + posted landed cost vouchers it billed − purchase returns − payments.
 * Payments are on account (not matched to documents), so a charge document is settled like
 * any invoice: by paying the supplier.
 * Positive = we owe the supplier. Computed from the posted documents (no stored balance
 * to drift out of sync).
 */
class SupplierAccount
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly SupplierDirectory $suppliers,
    ) {}

    /**
     * @param  list<string>  $supplierIds
     * @return array<string, string> supplier id => balance
     */
    public function balances(array $supplierIds): array
    {
        $balances = [];
        foreach (array_unique($supplierIds) as $id) {
            $supplier = $this->suppliers->find($id, $this->tenant->requireOrganization());
            if ($supplier === null) {
                continue;
            }
            $entries = $this->entries($id);
            $balances[$id] = $entries->reduce(fn (string $sum, array $e) => Decimal::add($sum, $e['amount'], 2), Decimal::round($supplier['opening_balance'], 2));
        }

        return $balances;
    }

    /**
     * @return array{supplier: array<string, mixed>, opening_balance: string, entries: list<array<string, mixed>>, closing_balance: string}
     */
    public function statement(string $supplierId, ?string $from, ?string $to): array
    {
        $supplier = $this->suppliers->find($supplierId, $this->tenant->requireOrganization()) ?? throw new NotFoundHttpException;
        $balance = Decimal::round($supplier['opening_balance'], 2);
        $rows = [];

        foreach ($this->entries($supplierId) as $entry) {
            if ($to !== null && $entry['date'] > $to) {
                continue;
            }
            if ($from !== null && $entry['date'] < $from) {
                $balance = Decimal::add($balance, $entry['amount'], 2); // carried into the opening balance

                continue;
            }
            $rows[] = $entry;
        }

        $opening = $balance;
        foreach ($rows as $i => $row) {
            $balance = Decimal::add($balance, $row['amount'], 2);
            $rows[$i]['balance'] = $balance;
        }

        return [
            'supplier' => ['id' => $supplier['id'], 'code' => $supplier['code'], 'name' => $supplier['name']],
            'opening_balance' => $opening,
            'entries' => $rows,
            'closing_balance' => $balance,
        ];
    }

    /**
     * All posted entries in date order; amount is signed (+ owed, − settled).
     *
     * @return Collection<int, array{date: string, type: string, id: string, number: string, reference: ?string, amount: string}>
     */
    private function entries(string $supplierId): Collection
    {
        // SC3: a receipt is owed at its payable total (goods + charges billed on the same invoice).
        $receipts = GoodsReceipt::query()->where('supplier_id', $supplierId)->get()->map(fn (GoodsReceipt $r) => [
            'date' => $r->invoice_date->toDateString(), 'type' => 'goods_receipt', 'id' => $r->id, 'number' => $r->number,
            'reference' => $r->supplier_invoice_number, 'amount' => $r->payable_total, 'created_at' => $r->created_at,
        ]);
        // SC3: charges this supplier billed on another supplier's receipt (freight, duty…), payable
        // like an invoice; `id`/`number` are the receipt's.
        $charges = GoodsReceiptCharge::query()
            ->join('goods_receipts as r', 'r.id', '=', 'goods_receipt_charges.goods_receipt_id')
            ->where('goods_receipt_charges.charge_supplier_id', $supplierId)
            ->get(['goods_receipt_charges.*', 'r.number as receipt_number', 'r.invoice_date as receipt_date', 'r.created_at as receipt_created_at'])
            ->map(fn (GoodsReceiptCharge $c) => [
                'date' => substr((string) $c->getAttribute('receipt_date'), 0, 10), 'type' => 'receipt_charge', 'id' => $c->goods_receipt_id,
                'number' => (string) $c->getAttribute('receipt_number'),
                'reference' => mb_substr('Charge on '.$c->getAttribute('receipt_number').': '.$c->type->label().($c->description !== null ? ' — '.$c->description : ''), 0, 255),
                'amount' => Decimal::add($c->amount, $c->tax_amount, 2), 'created_at' => $c->created_at,
            ]);
        $vouchers = LandedCostVoucher::query()->where('charge_supplier_id', $supplierId)->where('status', LandedCostVoucherStatus::Posted)->get()
            ->map(fn (LandedCostVoucher $v) => [
                'date' => $v->voucher_date->toDateString(), 'type' => 'landed_cost_voucher', 'id' => $v->id, 'number' => $v->number,
                'reference' => $v->reference ?? 'Landed cost', 'amount' => $v->total, 'created_at' => $v->posted_at,
            ]);
        $returns = PurchaseReturn::query()->where('supplier_id', $supplierId)->get()->map(fn (PurchaseReturn $r) => [
            'date' => $r->created_at->toDateString(), 'type' => 'purchase_return', 'id' => $r->id, 'number' => $r->number,
            'reference' => $r->reason, 'amount' => Decimal::negate($r->total, 2), 'created_at' => $r->created_at,
        ]);
        $payments = SupplierPayment::query()->where('supplier_id', $supplierId)->get()->map(fn (SupplierPayment $p) => [
            'date' => $p->paid_on->toDateString(), 'type' => 'payment', 'id' => $p->id, 'number' => $p->number,
            'reference' => $p->reference, 'amount' => Decimal::negate($p->amount, 2), 'created_at' => $p->created_at,
        ]);

        return $receipts->concat($charges)->concat($vouchers)->concat($returns)->concat($payments)
            ->sortBy([['date', 'asc'], ['created_at', 'asc']])
            ->map(fn (array $e) => array_diff_key($e, ['created_at' => true]))
            ->values();
    }
}
