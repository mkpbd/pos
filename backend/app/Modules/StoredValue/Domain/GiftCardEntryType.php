<?php

namespace App\Modules\StoredValue\Domain;

/**
 * One movement of a gift card's balance (append-only).
 */
enum GiftCardEntryType: string
{
    case Issue = 'issue';
    case Redeem = 'redeem';
    case SaleReversal = 'sale_reversal';
    case Void = 'void';
}
