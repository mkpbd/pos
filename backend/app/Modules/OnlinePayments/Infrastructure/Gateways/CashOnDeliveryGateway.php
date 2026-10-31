<?php

namespace App\Modules\OnlinePayments\Infrastructure\Gateways;

use App\Modules\OnlinePayments\Domain\GatewayCode;
use App\Modules\OnlinePayments\Domain\GatewayInitiation;
use App\Modules\OnlinePayments\Domain\PaymentGateway;

/**
 * The order is confirmed at once; the courier collects the money, and staff record it
 * (`cash_on_delivery` in the payments ledger) once the remittance arrives.
 */
final class CashOnDeliveryGateway implements PaymentGateway
{
    public function code(): GatewayCode
    {
        return GatewayCode::CashOnDelivery;
    }

    public function initiate(array $order): GatewayInitiation
    {
        return new GatewayInitiation(awaitsPayment: false);
    }

    public function supportsRefund(): bool
    {
        return false;
    }
}
