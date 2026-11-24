<?php

namespace App\Modules\OnlinePayments\Infrastructure\Gateways;

use App\Modules\OnlinePayments\Domain\GatewayInitiation;
use App\Modules\OnlinePayments\Domain\PaymentGateway;

/**
 * BD1c: a mobile wallet "Send Money" method — no API: the shopper sends the money to the
 * shop's wallet number, then reports the sender number and the transaction ID (a payment
 * claim). The order waits in `pending_payment` (stock held) until staff confirm the claim or
 * the hold expires. Refunds are paid out by staff (mobile banking), not through the wallet.
 */
abstract class SendMoneyGateway implements PaymentGateway
{
    public function initiate(array $order): GatewayInitiation
    {
        return new GatewayInitiation(awaitsPayment: true);
    }

    public function supportsRefund(): bool
    {
        return false;
    }
}
