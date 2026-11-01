<?php

namespace App\Modules\Orders\Application\Events;

/**
 * A customer cancelled their own web order from the account area (E9), dispatched after the
 * cancellation committed.
 */
final readonly class OrderCancelledByCustomer
{
    public function __construct(
        public string $organizationId,
        public string $orderId,
        public string $siteUrl,
    ) {}
}
