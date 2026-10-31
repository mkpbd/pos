<?php

namespace App\Modules\OnlinePayments\Infrastructure\Gateways;

use App\Modules\OnlinePayments\Domain\GatewayCode;
use App\Modules\OnlinePayments\Domain\GatewayInitiation;
use App\Modules\OnlinePayments\Domain\PaymentGateway;

/**
 * The shopper transfers the money using the instructions shown after placing the order;
 * the order waits in `pending_payment` (stock held) until staff confirm the transfer or the
 * hold expires.
 */
final class BankTransferGateway implements PaymentGateway
{
    public function code(): GatewayCode
    {
        return GatewayCode::BankTransfer;
    }

    public function initiate(array $order): GatewayInitiation
    {
        return new GatewayInitiation(awaitsPayment: true);
    }

    public function supportsRefund(): bool
    {
        return false;
    }
}
