<?php

namespace App\Modules\OnlinePayments\Infrastructure\Gateways;

use App\Modules\OnlinePayments\Domain\GatewayCode;

/**
 * BD1c: bKash "Send Money" to the shop's bKash number, confirmed by staff from the TrxID.
 */
final class BkashSendMoneyGateway extends SendMoneyGateway
{
    public function code(): GatewayCode
    {
        return GatewayCode::BkashManual;
    }
}
