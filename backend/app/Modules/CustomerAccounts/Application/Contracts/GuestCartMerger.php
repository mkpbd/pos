<?php

namespace App\Modules\CustomerAccounts\Application\Contracts;

/**
 * Moves the current visitor's guest cart into a customer's cart when they sign in or
 * register. Implemented by the Cart module (which knows the guest cart cookie); without
 * it nothing is merged.
 */
interface GuestCartMerger
{
    /**
     * @return array{merged_lines: int, capped_lines: int}
     */
    public function mergeGuestCart(string $customerId): array;
}
