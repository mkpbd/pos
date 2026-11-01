<?php

namespace App\Modules\Orders\Domain;

use App\Modules\Payments\Domain\PaymentMethod as LedgerMethod;

/**
 * How a web order refund is paid out (E10b). Cash leaves a register drawer (the refunding
 * staff member's open session in the order's branch); the others are recorded without one.
 */
enum RefundMethod: string
{
    case Cash = 'cash';
    case BankTransfer = 'bank_transfer';
    case MobileBanking = 'mobile_banking';

    public function label(): string
    {
        return $this->ledgerMethod()->label();
    }

    public function ledgerMethod(): LedgerMethod
    {
        return match ($this) {
            self::Cash => LedgerMethod::Cash,
            self::BankTransfer => LedgerMethod::BankTransfer,
            self::MobileBanking => LedgerMethod::MobileBanking,
        };
    }
}
