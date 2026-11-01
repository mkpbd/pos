<?php

namespace App\Modules\Orders\Domain;

/**
 * How a courier's COD remittance (the net amount) reached the business.
 */
enum RemittanceMethod: string
{
    case BankTransfer = 'bank_transfer';
    case Cash = 'cash';
    case MobileBanking = 'mobile_banking';

    public function label(): string
    {
        return match ($this) {
            self::BankTransfer => 'Bank transfer',
            self::Cash => 'Cash',
            self::MobileBanking => 'Mobile banking',
        };
    }
}
