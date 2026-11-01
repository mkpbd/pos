<?php

namespace App\Modules\Orders\Application\Events;

/**
 * Staff approved, rejected or refunded an online return (E10b): `$step` is `approved`,
 * `rejected` or `refunded`. Dispatched after the step committed; the customer is e-mailed.
 */
final readonly class OrderReturnUpdated
{
    public function __construct(
        public string $organizationId,
        public string $returnId,
        public string $step,
    ) {}
}
