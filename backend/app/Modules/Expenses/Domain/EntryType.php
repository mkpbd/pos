<?php

namespace App\Modules\Expenses\Domain;

use App\Modules\Payments\Domain\PaymentDirection;

enum EntryType: string
{
    case Expense = 'expense';
    case Income = 'income';

    /** Which way the money goes when the entry is recorded. */
    public function direction(): PaymentDirection
    {
        return $this === self::Expense ? PaymentDirection::Out : PaymentDirection::In;
    }

    public function prefix(): string
    {
        return $this === self::Expense ? 'EXP-' : 'INC-';
    }
}
