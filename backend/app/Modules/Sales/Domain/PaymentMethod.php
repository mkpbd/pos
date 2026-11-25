<?php

namespace App\Modules\Sales\Domain;

/**
 * Ways to pay at the till. Loyalty points are redeemed at the value set by the loyalty
 * program (only for a customer with enough points). POS1b: store credit (the sale's customer's
 * balance) and gift cards / vouchers / credit notes are stored value held in the StoredValue
 * module — like points, they are not money and never go through the payments ledger.
 * POS1c: `exchange` is the value of goods returned at the till paying for the new sale (a
 * payment of the new sale and a refund of its return); it is set by the server only.
 */
enum PaymentMethod: string
{
    case Cash = 'cash';
    case Card = 'card';
    case MobileBanking = 'mobile_banking';
    case LoyaltyPoints = 'loyalty_points';
    case StoreCredit = 'store_credit';
    case GiftCard = 'gift_card';
    case Exchange = 'exchange';

    public function label(): string
    {
        return match ($this) {
            self::Cash => 'Cash',
            self::Card => 'Card',
            self::MobileBanking => 'Mobile banking',
            self::LoyaltyPoints => 'Loyalty points',
            self::StoreCredit => 'Store credit',
            self::GiftCard => 'Gift card',
            self::Exchange => 'Exchange',
        };
    }

    /**
     * Value held with the business rather than money (StoredValue module, loyalty).
     */
    public function isStoredValue(): bool
    {
        return in_array($this, [self::LoyaltyPoints, self::StoreCredit, self::GiftCard], true);
    }

    /**
     * Money that goes through the payments ledger (cash through the drawer). Stored value and
     * (POS1c) exchanges are value, not money, and are kept out of it.
     */
    public function isLedgerMoney(): bool
    {
        return in_array($this, [self::Cash, self::Card, self::MobileBanking], true);
    }

    /**
     * Methods a client may tender at checkout or refund a return with (`exchange` is internal).
     *
     * @return list<self>
     */
    public static function tenderable(): array
    {
        return array_values(array_filter(self::cases(), fn (self $m) => $m !== self::Exchange));
    }
}
