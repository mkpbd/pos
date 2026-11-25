<?php

namespace App\Modules\StoredValue\Domain;

/**
 * What a gift card row is: a card sold at the till, a voucher a manager issued for free, or a
 * credit note given as the refund of a return. All three are spent the same way.
 */
enum GiftCardKind: string
{
    case GiftCard = 'gift_card';
    case Voucher = 'voucher';
    case CreditNote = 'credit_note';

    public function label(): string
    {
        return match ($this) {
            self::GiftCard => 'Gift card',
            self::Voucher => 'Voucher',
            self::CreditNote => 'Credit note',
        };
    }
}
