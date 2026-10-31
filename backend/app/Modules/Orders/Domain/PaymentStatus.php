<?php

namespace App\Modules\Orders\Domain;

/**
 * Whether the money of a web order has been received. Refund states arrive with E10.
 */
enum PaymentStatus: string
{
    case Unpaid = 'unpaid';
    case Paid = 'paid';

    public function label(): string
    {
        return match ($this) {
            self::Unpaid => 'Unpaid',
            self::Paid => 'Paid',
        };
    }
}
