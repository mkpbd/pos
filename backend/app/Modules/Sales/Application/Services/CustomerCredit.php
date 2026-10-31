<?php

namespace App\Modules\Sales\Application\Services;

use App\Modules\Sales\Domain\ReturnStatus;
use App\Modules\Sales\Domain\SaleStatus;
use App\Modules\Sales\Infrastructure\Models\CustomerPayment;
use App\Modules\Sales\Infrastructure\Models\Sale;
use App\Modules\Sales\Infrastructure\Models\SaleReturn;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Illuminate\Support\Facades\DB;

/**
 * What customers owe from sales (accounts receivable), computed from the posted documents:
 * opening balance + dues of completed sales − returns credited against them − payments received.
 */
class CustomerCredit
{
    /**
     * @param  array{id: string, opening_balance: string}  $customer
     */
    public function outstanding(array $customer): string
    {
        return Decimal::add($customer['opening_balance'], $this->dues([$customer['id']])[$customer['id']], 2);
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

        $due = Sale::query()
            ->whereIn('customer_id', $customerIds)
            ->where('status', SaleStatus::Completed)
            ->groupBy('customer_id')
            ->selectRaw('customer_id, SUM(due_total) as amount')
            ->pluck('amount', 'customer_id');
        $credited = SaleReturn::query()
            ->whereIn('customer_id', $customerIds)
            ->where('status', ReturnStatus::Completed)
            ->groupBy('customer_id')
            ->selectRaw('customer_id, SUM(credited_total) as amount')
            ->pluck('amount', 'customer_id');
        $paid = CustomerPayment::query()
            ->whereIn('customer_id', $customerIds)
            ->groupBy('customer_id')
            ->selectRaw('customer_id, SUM(amount) as amount')
            ->pluck('amount', 'customer_id');

        $result = [];
        foreach ($customerIds as $id) {
            $owed = Decimal::sub(Decimal::round((string) ($due[$id] ?? '0'), 2), Decimal::round((string) ($credited[$id] ?? '0'), 2), 2);
            $result[$id] = Decimal::sub($owed, Decimal::round((string) ($paid[$id] ?? '0'), 2), 2);
        }

        return $result;
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
     * cannot both use the last of a credit limit (and a payment and a return cannot both
     * settle the same due). SQLite serializes writers anyway.
     */
    public function lock(string $customerId): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::select('SELECT pg_advisory_xact_lock(hashtextextended(?, 0))', ["customer-credit:{$customerId}"]);
        }
    }
}
