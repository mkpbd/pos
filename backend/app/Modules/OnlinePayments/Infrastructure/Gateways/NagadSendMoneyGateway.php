<?php

namespace App\Modules\OnlinePayments\Infrastructure\Gateways;

use App\Modules\OnlinePayments\Domain\GatewayCode;

/**
 * BD1c: Nagad "Send Money" to the shop's Nagad number, confirmed by staff from the TrxID.
 */
final class NagadSendMoneyGateway extends SendMoneyGateway
{
    public function code(): GatewayCode
    {
        return GatewayCode::NagadManual;
    }
}
