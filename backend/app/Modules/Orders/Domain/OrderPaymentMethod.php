<?php

namespace App\Modules\Orders\Domain;

/**
 * How the shopper chose to pay (the OnlinePayments method code). E8a: offline methods only.
 */
enum OrderPaymentMethod: string
{
    case CashOnDelivery = 'cod';
    case BankTransfer = 'bank_transfer';

    public function label(): string
    {
        return match ($this) {
            self::CashOnDelivery => 'Cash on delivery',
            self::BankTransfer => 'Bank transfer',
        };
    }
}
