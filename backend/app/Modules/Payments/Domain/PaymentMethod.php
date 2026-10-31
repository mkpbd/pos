<?php

namespace App\Modules\Payments\Domain;

/**
 * Every way money moves in or out of the business. Only cash goes through a register
 * drawer. (Loyalty points are value, not money: they have their own ledger in Loyalty.)
 */
enum PaymentMethod: string
{
    case Cash = 'cash';
    case Card = 'card';
    case MobileBanking = 'mobile_banking';
    case BankTransfer = 'bank_transfer';
    case Cheque = 'cheque';
    /** Cash a courier collected on delivery of a web order (recorded when staff confirm the remittance). */
    case CashOnDelivery = 'cash_on_delivery';
    /** Paid through an online payment gateway (the gateway code is kept in the reference). */
    case OnlineGateway = 'online_gateway';

    public function label(): string
    {
        return match ($this) {
            self::Cash => 'Cash',
            self::Card => 'Card',
            self::MobileBanking => 'Mobile banking',
            self::BankTransfer => 'Bank transfer',
            self::Cheque => 'Cheque',
            self::CashOnDelivery => 'Cash on delivery',
            self::OnlineGateway => 'Online payment',
        };
    }

    public function isCash(): bool
    {
        return $this === self::Cash;
    }
}
