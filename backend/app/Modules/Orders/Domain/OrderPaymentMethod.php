<?php

namespace App\Modules\Orders\Domain;

/**
 * How the shopper chose to pay (the OnlinePayments method code). E8a: offline methods only.
 * BD1c: the bKash / Nagad / Rocket "Send Money" methods (the shopper reports the TrxID).
 */
enum OrderPaymentMethod: string
{
    case CashOnDelivery = 'cod';
    case BankTransfer = 'bank_transfer';
    case BkashManual = 'bkash_manual';
    case NagadManual = 'nagad_manual';
    case RocketManual = 'rocket_manual';

    public function label(): string
    {
        return match ($this) {
            self::CashOnDelivery => 'Cash on delivery',
            self::BankTransfer => 'Bank transfer',
            self::BkashManual => 'bKash (Send Money)',
            self::NagadManual => 'Nagad (Send Money)',
            self::RocketManual => 'Rocket (Send Money)',
        };
    }

    /**
     * BD1c: paid by "Send Money" to the shop's wallet number and confirmed from a payment claim.
     */
    public function isSendMoney(): bool
    {
        return in_array($this, self::sendMoney(), true);
    }

    /**
     * BD1c: the wallet's name in ledger references ("bKash TrxID …"); null for other methods.
     */
    public function walletName(): ?string
    {
        return match ($this) {
            self::BkashManual => 'bKash',
            self::NagadManual => 'Nagad',
            self::RocketManual => 'Rocket',
            default => null,
        };
    }

    /**
     * @return list<self>
     */
    public static function sendMoney(): array
    {
        return [self::BkashManual, self::NagadManual, self::RocketManual];
    }

    /**
     * @return list<string>
     */
    public static function values(): array
    {
        return array_map(fn (self $m) => $m->value, self::cases());
    }
}
