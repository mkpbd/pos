<?php

namespace App\Modules\Sales\Application\Services;

use App\Modules\Sales\Domain\SaleStatus;
use App\Modules\Sales\Infrastructure\Models\Sale;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Illuminate\Support\Facades\DB;

/**
 * What customers owe from sales: opening balance + dues of completed sales.
 * (Collections of dues arrive with the payments module in Phase 6.)
 */
class CustomerCredit
{
    /**
     * @param  array{id: string, opening_balance: string}  $customer
     */
    public function outstanding(array $customer): string
    {
        $due = Sale::query()
            ->where('customer_id', $customer['id'])
            ->where('status', SaleStatus::Completed)
            ->sum('due_total');

        return Decimal::add($customer['opening_balance'], Decimal::round((string) $due, 2), 2);
    }

    /**
     * Outstanding dues per customer (opening balances not included), keyed by customer id.
     *
     * @param  list<string>  $customerIds
     * @return array<string, string>
     */
    public function dues(array $customerIds): array
    {
        if ($customerIds === []) {
            return [];
        }

        $sums = Sale::query()
            ->whereIn('customer_id', $customerIds)
            ->where('status', SaleStatus::Completed)
            ->groupBy('customer_id')
            ->selectRaw('customer_id, SUM(due_total) as due')
            ->pluck('due', 'customer_id');

        return array_map(fn ($due) => Decimal::round((string) $due, 2), $sums->all() + array_fill_keys($customerIds, '0'));
    }

    /**
     * @param  array{credit_limit: string, opening_balance: string, id: string}  $customer
     * @return array{outstanding: string, credit_limit: string, available: string}
     */
    public function position(array $customer): array
    {
        $outstanding = $this->outstanding($customer);
        $available = Decimal::sub($customer['credit_limit'], $outstanding, 2);

        return [
            'outstanding' => $outstanding,
            'credit_limit' => Decimal::round($customer['credit_limit'], 2),
            'available' => Decimal::isNegative($available) ? '0.00' : $available,
        ];
    }

    /**
     * Serializes credit decisions for one customer until the transaction ends, so two tills
     * cannot both use the last of a credit limit. (SQLite serializes writers anyway.)
     */
    public function lock(string $customerId): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::select('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', ["customer-credit:{$customerId}"]);
        }
    }
}
