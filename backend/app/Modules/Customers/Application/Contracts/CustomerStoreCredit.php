<?php

namespace App\Modules\Customers\Application\Contracts;

/**
 * POS1b: customers' store credit balances as the customer screens and the till's customer
 * search show them. Implemented by the StoredValue module; without it every balance is 0.
 */
interface CustomerStoreCredit
{
    /**
     * Balances of the given customers (currency scale), keyed by customer id — one query.
     *
     * @param  list<string>  $customerIds
     * @return array<string, string>
     */
    public function balances(array $customerIds): array;
}
