<?php

namespace App\Modules\Loyalty\Application\Contracts;

/**
 * Read access to the loyalty program and customers' point balances for other modules
 * (Phase 8: the AI customer insights' loyalty suggestions).
 */
interface LoyaltyBalances
{
    /**
     * @return array{enabled: bool, point_value: string}
     */
    public function program(string $organizationId): array;

    /**
     * Current point balances; customers without an account are left out (0 points).
     *
     * @param  list<string>  $customerIds
     * @return array<string, int>
     */
    public function balances(string $organizationId, array $customerIds): array;
}
