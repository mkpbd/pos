<?php

namespace App\Modules\OnlinePayments\Infrastructure\Gateways;

use App\Modules\OnlinePayments\Domain\GatewayCode;

/**
 * BD1c: Rocket "Send Money" to the shop's Rocket number, confirmed by staff from the TrxID.
 */
final class RocketSendMoneyGateway extends SendMoneyGateway
{
    public function code(): GatewayCode
    {
        return GatewayCode::RocketManual;
    }
}
