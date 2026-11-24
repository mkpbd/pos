<?php

namespace App\Modules\Orders\Application\Events;

use Illuminate\Contracts\Events\ShouldDispatchAfterCommit;

/**
 * BD1a: a web order moved from one status to another after it was placed (staff workflow
 * steps, payment confirmation, cancellation by staff, customer or the expiry job). Dispatched
 * after the transaction commits — a rolled-back step announces nothing. Placement itself is
 * OrderPlaced. `from` / `to` are OrderStatus values; `actorType` staff | customer | system.
 */
final readonly class OrderStatusChanged implements ShouldDispatchAfterCommit
{
    public function __construct(
        public string $organizationId,
        public string $orderId,
        public string $from,
        public string $to,
        public string $actorType,
    ) {}
}
