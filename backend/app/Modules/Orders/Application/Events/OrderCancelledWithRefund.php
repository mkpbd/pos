<?php

namespace App\Modules\Orders\Application\Events;

/**
 * Staff cancelled a paid web order and refunded it (E11), dispatched after the cancellation
 * committed; the customer is e-mailed. `$method` is the RefundMethod value.
 */
final readonly class OrderCancelledWithRefund
{
    public function __construct(
        public string $organizationId,
        public string $orderId,
        public string $method,
        public ?string $reference,
    ) {}
}
