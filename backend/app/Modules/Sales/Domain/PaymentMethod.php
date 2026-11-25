<?php

namespace App\Modules\Sales\Domain;

/**
 * Ways to pay at the till. Loyalty points are redeemed at the value set by the loyalty
 * program (only for a customer with enough points). POS1b: store credit (the sale's customer's
 * balance) and gift cards / vouchers / credit notes are stored value held in the StoredValue
 * module — like points, they are not money and never go through the payments ledger.
 */
enum PaymentMethod: string
{
    case Cash = 'cash';
    case Card = 'card';
    case MobileBanking = 'mobile_banking';
    case LoyaltyPoints = 'loyalty_points';
    case StoreCredit = 'store_credit';
    case GiftCard = 'gift_card';

    public function label(): string
    {
        return match ($this) {
            self::Cash => 'Cash',
            self::Card => 'Card',
            self::MobileBanking => 'Mobile banking',
            self::LoyaltyPoints => 'Loyalty points',
            self::StoreCredit => 'Store credit',
            self::GiftCard => 'Gift card',
        };
    }

    /**
     * Value held with the business rather than money: kept out of the payments ledger.
     */
    public function isStoredValue(): bool
    {
        return in_array($this, [self::LoyaltyPoints, self::StoreCredit, self::GiftCard], true);
    }
}
