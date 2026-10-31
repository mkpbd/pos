<?php

namespace App\Modules\Purchasing\Application\Queries;

use App\Modules\Purchasing\Infrastructure\Models\GoodsReceipt;
use App\Modules\Purchasing\Infrastructure\Models\PurchaseReturn;
use App\Modules\Purchasing\Infrastructure\Models\SupplierPayment;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Suppliers\Application\Contracts\SupplierDirectory;
use Illuminate\Support\Collection;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * What the organization owes each supplier:
 *   opening balance + goods receipts − purchase returns − payments.
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
        $receipts = GoodsReceipt::query()->where('supplier_id', $supplierId)->get()->map(fn (GoodsReceipt $r) => [
            'date' => $r->invoice_date->toDateString(), 'type' => 'goods_receipt', 'id' => $r->id, 'number' => $r->number,
            'reference' => $r->supplier_invoice_number, 'amount' => $r->total, 'created_at' => $r->created_at,
        ]);
        $returns = PurchaseReturn::query()->where('supplier_id', $supplierId)->get()->map(fn (PurchaseReturn $r) => [
            'date' => $r->created_at->toDateString(), 'type' => 'purchase_return', 'id' => $r->id, 'number' => $r->number,
            'reference' => $r->reason, 'amount' => Decimal::negate($r->total, 2), 'created_at' => $r->created_at,
        ]);
        $payments = SupplierPayment::query()->where('supplier_id', $supplierId)->get()->map(fn (SupplierPayment $p) => [
            'date' => $p->paid_on->toDateString(), 'type' => 'payment', 'id' => $p->id, 'number' => $p->number,
            'reference' => $p->reference, 'amount' => Decimal::negate($p->amount, 2), 'created_at' => $p->created_at,
        ]);

        return $receipts->concat($returns)->concat($payments)
            ->sortBy([['date', 'asc'], ['created_at', 'asc']])
            ->map(fn (array $e) => array_diff_key($e, ['created_at' => true]))
            ->values();
    }
}
