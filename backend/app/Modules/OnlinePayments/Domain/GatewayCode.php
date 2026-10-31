<?php

namespace App\Modules\OnlinePayments\Domain;

/**
 * Payment methods a shopper can choose at checkout. E8a ships the offline ones; online
 * gateways (sslcommerz, bkash, nagad) are added with their drivers in E8c.
 */
enum GatewayCode: string
{
    case CashOnDelivery = 'cod';
    case BankTransfer = 'bank_transfer';

    public function label(): string
    {
        return match ($this) {
            self::CashOnDelivery => 'Cash on delivery',
            self::BankTransfer => 'Bank transfer',
        };
    }

    /**
     * Settings of a method nobody configured yet: cash on delivery on, bank transfer off.
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
        };
    }
}
