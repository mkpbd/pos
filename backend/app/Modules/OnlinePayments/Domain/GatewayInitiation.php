<?php

namespace App\Modules\OnlinePayments\Domain;

/**
 * What happens after placing an order with a method: offline methods never redirect.
 * `awaitsPayment` = the order waits for money before it is confirmed (bank transfer).
 */
final readonly class GatewayInitiation
{
    public function __construct(
        public bool $awaitsPayment,
        public ?string $redirectUrl = null,
    ) {}
}
