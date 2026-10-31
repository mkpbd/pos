<?php

namespace App\Modules\Payments\Domain;

/**
 * Every way money moves in or out of the business. Only cash goes through a register
 * drawer. (Loyalty points are value, not money: they have their own ledger in Loyalty.)
 */
enum PaymentMethod: string
{
    case Cash = 'cash';
    case Card = 'card';
    case MobileBanking = 'mobile_banking';
    case BankTransfer = 'bank_transfer';
    case Cheque = 'cheque';

    public function label(): string
    {
        return match ($this) {
            self::Cash => 'Cash',
            self::Card => 'Card',
            self::MobileBanking => 'Mobile banking',
            self::BankTransfer => 'Bank transfer',
            self::Cheque => 'Cheque',
        };
    }

    public function isCash(): bool
    {
        return $this === self::Cash;
    }
}
