<?php

namespace App\Modules\Customers\Application\Services;

use App\Modules\Customers\Application\Contracts\CustomerReviewStats;
use App\Modules\Customers\Application\Contracts\CustomerShoppingLists;
use App\Modules\Customers\Application\Contracts\CustomerWebOrders;

/**
 * Defaults while the Orders, Reviews or Cart module is not installed (E10b).
 */
class NoWebActivity implements CustomerReviewStats, CustomerShoppingLists, CustomerWebOrders
{
    public function summary(string $customerId): array
    {
        return [];
    }
}
