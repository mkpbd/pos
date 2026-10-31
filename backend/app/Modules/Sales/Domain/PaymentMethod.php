<?php

namespace App\Modules\Sales\Domain;

/**
 * Ways to pay at the till. Loyalty points are redeemed at the value set by the loyalty
 * program (only for a customer with enough points).
 */
enum PaymentMethod: string
{
    case Cash = 'cash';
    case Card = 'card';
    case MobileBanking = 'mobile_banking';
    case LoyaltyPoints = 'loyalty_points';

    public function label(): string
    {
        return match ($this) {
            self::Cash => 'Cash',
            self::Card => 'Card',
            self::MobileBanking => 'Mobile banking',
            self::LoyaltyPoints => 'Loyalty points',
        };
    }
}
