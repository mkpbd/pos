<?php

namespace App\Modules\Orders\Domain;

/**
 * Whether the money of a web order has been received — and, from E10b, refunded:
 * `partially_refunded` after a refund smaller than what was paid, `refunded` once the refunds
 * add up to the paid total.
 *
 * BD1c: `partially_paid` — part of the total was received (the advance delivery charge of a
 * cash-on-delivery order); the courier collects the rest. It counts as paid (`isPaid()`): the
 * order is cancelled with a refund, cannot be edited and is not cancelled by the shopper.
 */
enum PaymentStatus: string
{
    case Unpaid = 'unpaid';
    case PartiallyPaid = 'partially_paid';
    case Paid = 'paid';
    case PartiallyRefunded = 'partially_refunded';
    case Refunded = 'refunded';

    public function label(): string
    {
        return match ($this) {
            self::Unpaid => 'Unpaid',
            self::PartiallyPaid => 'Partly paid',
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

    /**
     * BD1c: money is still to be received — nothing yet, or only part of the total.
     */
    public function owesMoney(): bool
    {
        return $this === self::Unpaid || $this === self::PartiallyPaid;
    }
}
