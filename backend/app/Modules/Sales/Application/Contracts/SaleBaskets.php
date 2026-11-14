<?php

namespace App\Modules\Sales\Application\Contracts;

use DateTimeInterface;

/**
 * P1b: what was bought together at the till, for co-purchase statistics ("frequently bought
 * together", computed by the OnlineCatalog module): the distinct product ids of every completed
 * POS sale of the organization since `$since`. Cancelled sales do not count, nor do lines whose
 * completed returns took back the whole quantity (a fully refunded sale is left with nothing).
 * Sales with fewer than two distinct products left are left out. Streamed sale by sale.
 */
interface SaleBaskets
{
    /**
     * @return iterable<list<string>> one list of distinct product ids per sale
     */
    public function since(string $organizationId, DateTimeInterface $since): iterable;
}
