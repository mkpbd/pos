<?php

namespace App\Modules\StoredValue\Application\Services;

use App\Modules\Customers\Application\Contracts\CustomerStoreCredit;
use App\Modules\Sales\Application\Contracts\StoreCredit;
use App\Modules\Sales\Application\Services\SalesContext;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\StoredValue\Infrastructure\Models\StoreCreditEntry;

/**
 * Store credit as Sales (paying and refunding) and Customers (balances) see it. Runs inside
 * the caller's transaction; every change goes through StoreCreditLedger (customer lock).
 */
class EloquentStoreCredit implements CustomerStoreCredit, StoreCredit
{
    public function __construct(
        private readonly StoreCreditLedger $ledger,
        private readonly SalesContext $context,
    ) {}

    public function balance(string $customerId): string
    {
        return $this->ledger->balance($customerId);
    }

    public function balances(array $customerIds): array
    {
        return array_map(fn (array $b) => $b['balance'], $this->ledger->balances($customerIds));
    }

    public function spend(string $customerId, string $amount, string $saleId, string $saleNumber): void
    {
        $this->ledger->post($customerId, Decimal::negate($amount, 2), [
            'type' => 'sale_payment',
            'currency' => $this->context->currency(),
            'reference_type' => 'sale',
            'reference_id' => $saleId,
            'reference_number' => $saleNumber,
        ]);
    }

    public function reverseSale(string $saleId): void
    {
        $entries = StoreCreditEntry::query()
            ->where('reference_type', 'sale')
            ->where('reference_id', $saleId)
            ->whereIn('type', ['sale_payment', 'sale_reversal'])
            ->get();
        foreach ($entries->groupBy('customer_id') as $customerId => $rows) {
            $customerId = (string) $customerId;
            $this->ledger->lock($customerId);
            // Recomputed under the lock, so a repeated reversal finds nothing left to give back.
            $spent = Decimal::negate(Decimal::round((string) StoreCreditEntry::query()
                ->where('customer_id', $customerId)
                ->where('reference_type', 'sale')
                ->where('reference_id', $saleId)
                ->whereIn('type', ['sale_payment', 'sale_reversal'])
                ->sum('amount'), 2), 2);
            if (Decimal::compare($spent, '0') > 0) {
                /** @var StoreCreditEntry $first */
                $first = $rows->first();
                $this->ledger->post($customerId, $spent, [
                    'type' => 'sale_reversal',
                    'currency' => $first->currency,
                    'reference_type' => 'sale',
                    'reference_id' => $saleId,
                    'reference_number' => $first->reference_number,
                ]);
            }
        }
    }

    public function refund(string $customerId, string $amount, string $returnId, string $returnNumber): void
    {
        $this->ledger->post($customerId, Decimal::round($amount, 2), [
            'type' => 'refund',
            'currency' => $this->context->currency(),
            'reference_type' => 'sale_return',
            'reference_id' => $returnId,
            'reference_number' => $returnNumber,
        ]);
    }
}
