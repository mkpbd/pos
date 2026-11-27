<?php

namespace App\Modules\Customers\Application\Contracts;

/**
 * R1: what customers owe from sales (opening balances not included) — for due reminders.
 * Implemented by the Sales module's CustomerCredit (receivables).
 */
interface CustomerDues
{
    /**
     * Outstanding dues per customer (currency scale), keyed by customer id.
     *
     * @param  list<string>  $customerIds
     * @return array<string, string>
     */
    public function dues(array $customerIds): array;
}
