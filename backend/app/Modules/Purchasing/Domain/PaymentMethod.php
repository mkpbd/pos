<?php

namespace App\Modules\Purchasing\Domain;

enum PaymentMethod: string
{
    case Cash = 'cash';
    case BankTransfer = 'bank_transfer';
    case MobileBanking = 'mobile_banking';
    case Cheque = 'cheque';
    case Card = 'card';
    /** Kept for payments recorded before ST1; new payments and refunds go through the payments ledger, which has no "other". */
    case Other = 'other';

    /**
     * ST1: methods a new supplier payment or refund may use (the payments ledger's methods).
     *
     * @return list<string>
     */
    public static function recordable(): array
    {
        return [self::Cash->value, self::BankTransfer->value, self::MobileBanking->value, self::Cheque->value, self::Card->value];
    }
}
