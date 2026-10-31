<?php

namespace App\Modules\CustomerAccounts\Application\Services;

use App\Modules\CustomerAccounts\Application\Contracts\GuestCartMerger;

/**
 * Default while the Cart module is not installed.
 */
class NoGuestCart implements GuestCartMerger
{
    public function mergeGuestCart(string $customerId): array
    {
        return ['merged_lines' => 0, 'capped_lines' => 0];
    }
}
