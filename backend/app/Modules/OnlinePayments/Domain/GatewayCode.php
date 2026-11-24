<?php

namespace App\Modules\OnlinePayments\Domain;

/**
 * Payment methods a shopper can choose at checkout. E8a ships the offline ones; online
 * gateways (sslcommerz, bkash, nagad) are added with their drivers in E8c.
 *
 * BD1c: the "Send Money" methods (`bkash_manual`, `nagad_manual`, `rocket_manual`) — the
 * shopper sends the money to the shop's own mobile wallet number from their phone, then types
 * the sender number and the transaction ID; staff check it in their wallet app and confirm.
 */
enum GatewayCode: string
{
    case CashOnDelivery = 'cod';
    case BankTransfer = 'bank_transfer';
    case BkashManual = 'bkash_manual';
    case NagadManual = 'nagad_manual';
    case RocketManual = 'rocket_manual';

    /** BD1c: whose number a Send Money method shows (the wallet's account kinds). */
    public const ACCOUNT_TYPES = ['personal', 'agent', 'merchant'];

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
     * BD1c: a Send Money method (the shopper pays to the shop's wallet number and reports the TrxID).
     */
    public function isSendMoney(): bool
    {
        return in_array($this, self::sendMoney(), true);
    }

    /**
     * @return list<self>
     */
    public static function sendMoney(): array
    {
        return [self::BkashManual, self::NagadManual, self::RocketManual];
    }

    /**
     * Settings of a method nobody configured yet: cash on delivery on, the others off.
     *
     * @return array{is_enabled: bool, display_name: string, instructions: ?string, settings: array<string, mixed>, sort_order: int}
     */
    public function defaults(): array
    {
        return match ($this) {
            self::CashOnDelivery => [
                'is_enabled' => true,
                'display_name' => 'Cash on delivery',
                'instructions' => 'Pay in cash when your order is delivered.',
                'settings' => ['max_order_total' => null],
                'sort_order' => 0,
            ],
            self::BankTransfer => [
                'is_enabled' => false,
                'display_name' => 'Bank transfer',
                'instructions' => null,
                'settings' => ['hold_hours' => 48],
                'sort_order' => 1,
            ],
            self::BkashManual, self::NagadManual, self::RocketManual => [
                'is_enabled' => false,
                'display_name' => $this->label(),
                'instructions' => null,
                // account_number: the shop's wallet number (01XXXXXXXXX), required to switch the method on.
                'settings' => ['account_number' => null, 'account_type' => 'personal', 'hold_hours' => 24],
                'sort_order' => match ($this) {
                    self::BkashManual => 2,
                    self::NagadManual => 3,
                    default => 4,
                },
            ],
        };
    }
}
