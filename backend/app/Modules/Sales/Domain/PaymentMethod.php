<?php

namespace App\Modules\Sales\Domain;

enum PaymentMethod: string
{
    case Cash = 'cash';
    case Card = 'card';
    case MobileBanking = 'mobile_banking';

    public function label(): string
    {
        return match ($this) {
            self::Cash => 'Cash',
            self::Card => 'Card',
            self::MobileBanking => 'Mobile banking',
        };
    }
}
