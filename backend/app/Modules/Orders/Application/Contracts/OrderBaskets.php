<?php

namespace App\Modules\Orders\Application\Contracts;

use DateTimeInterface;

/**
 * P1b: what was bought together online, for co-purchase statistics ("frequently bought
 * together", computed by the OnlineCatalog module): the distinct product ids of every web order
 * of the organization placed since `$since` that still stands as a sale — confirmed, processing,
 * shipped or delivered, and not refunded in full (cancelled, failed and unpaid bank-transfer
 * orders do not count). Orders with fewer than two distinct products are left out. Streamed
 * order by order, so callers never hold every order at once.
 */
interface OrderBaskets
{
    /**
     * @return iterable<list<string>> one list of distinct product ids per order
     */
    public function since(string $organizationId, DateTimeInterface $since): iterable;
}
