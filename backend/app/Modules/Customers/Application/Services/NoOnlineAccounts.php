<?php

namespace App\Modules\Customers\Application\Services;

use App\Modules\Customers\Application\Contracts\CustomerOnlineAccounts;

/**
 * Default while the CustomerAccounts module is not installed.
 */
class NoOnlineAccounts implements CustomerOnlineAccounts
{
    public function forCustomer(string $customerId): ?array
    {
        return null;
    }
}
