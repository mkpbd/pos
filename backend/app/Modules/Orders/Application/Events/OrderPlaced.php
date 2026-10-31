<?php

namespace App\Modules\Orders\Application\Events;

/**
 * A web order was placed (dispatched after the placement transaction committed).
 * `accessToken` is the guest's plain token for the e-mail link (null for customers).
 */
final readonly class OrderPlaced
{
    public function __construct(
        public string $organizationId,
        public string $orderId,
        public string $siteUrl,
        public ?string $accessToken,
    ) {}
}
