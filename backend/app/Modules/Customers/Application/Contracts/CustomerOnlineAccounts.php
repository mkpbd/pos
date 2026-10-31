<?php

namespace App\Modules\Customers\Application\Contracts;

/**
 * The customer's online store account, as the customer screens show it. Implemented by
 * the CustomerAccounts module; without it every customer has none.
 */
interface CustomerOnlineAccounts
{
    /**
     * @return array{email: string, email_verified_at: ?string, last_login_at: ?string, status: string, created_at: ?string}|null
     */
    public function forCustomer(string $customerId): ?array;
}
