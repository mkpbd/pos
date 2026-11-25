<?php

namespace App\Modules\Customers\Application\Services;

use App\Modules\Customers\Application\Contracts\CustomerStoreCredit;

/**
 * Default while the StoredValue module is not installed.
 */
class NoStoreCredit implements CustomerStoreCredit
{
    public function balances(array $customerIds): array
    {
        return array_fill_keys($customerIds, '0.00');
    }
}
