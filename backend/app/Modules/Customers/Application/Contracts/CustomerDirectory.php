<?php

namespace App\Modules\Customers\Application\Contracts;

/**
 * Read access to customers for modules that sell to them (Sales, POS, later Payments).
 *
 * @phpstan-type CustomerInfo array{
 *   id: string, code: string, name: string, phone: ?string, is_active: bool, archived: bool,
 *   credit_limit: string, opening_balance: string, group_discount_percent: string,
 *   price_level: 'retail'|'wholesale'
 * }
 */
interface CustomerDirectory
{
    /**
     * @return CustomerInfo|null
     */
    public function find(string $customerId, string $organizationId): ?array;

    /**
     * Contact summaries keyed by customer id (archived customers included; BD2b: with their state).
     *
     * @param  list<string>  $customerIds
     * @return array<string, array{id: string, code: string, name: string, phone: ?string, email: ?string, is_active: bool, archived: bool}>
     */
    public function summaries(string $organizationId, array $customerIds): array;

    /**
     * @param  list<string>  $customerIds
     * @return array<string, string> opening balance keyed by customer id
     */
    public function openingBalances(string $organizationId, array $customerIds): array;
}
