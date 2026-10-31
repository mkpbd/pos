<?php

namespace App\Modules\Customers\Application\Contracts;

/**
 * Read access to customers for modules that sell to them (Sales, POS, later Payments).
 *
 * @phpstan-type CustomerInfo array{
 *   id: string, code: string, name: string, phone: ?string, is_active: bool, archived: bool,
 *   credit_limit: string, opening_balance: string, group_discount_percent: string
 * }
 */
interface CustomerDirectory
{
    /**
     * @return CustomerInfo|null
     */
    public function find(string $customerId, string $organizationId): ?array;

    /**
     * @param  list<string>  $customerIds
     * @return array<string, array{id: string, code: string, name: string, phone: ?string}>
     */
    public function summaries(string $organizationId, array $customerIds): array;

    /**
     * @param  list<string>  $customerIds
     * @return array<string, string> opening balance keyed by customer id
     */
    public function openingBalances(string $organizationId, array $customerIds): array;
}
