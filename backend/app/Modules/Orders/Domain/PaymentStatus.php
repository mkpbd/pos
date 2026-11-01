<?php

namespace App\Modules\Orders\Domain;

/**
 * Whether the money of a web order has been received — and, from E10b, refunded:
 * `partially_refunded` after a refund smaller than what was paid, `refunded` once the refunds
 * add up to the paid total.
 */
enum PaymentStatus: string
{
    case Unpaid = 'unpaid';
    case Paid = 'paid';
    case PartiallyRefunded = 'partially_refunded';
    case Refunded = 'refunded';

    public function label(): string
    {
        return match ($this) {
            self::Unpaid => 'Unpaid',
            self::Paid => 'Paid',
            self::PartiallyRefunded => 'Partially refunded',
            self::Refunded => 'Refunded',
        };
    }

    /**
     * Money was received (possibly refunded in part since).
     */
    public function isPaid(): bool
    {
        return $this !== self::Unpaid;
    }
}
