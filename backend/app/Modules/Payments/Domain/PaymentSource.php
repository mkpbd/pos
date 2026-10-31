<?php

namespace App\Modules\Payments\Domain;

/**
 * The document a ledger entry belongs to (a sale, a return, an expense, …).
 */
final readonly class PaymentSource
{
    /** Web order payments (bank transfer confirmed by staff, cash on delivery remitted, gateways). */
    public const ONLINE_ORDER = 'online_order';

    /** Refunds of web orders (E10). */
    public const ONLINE_ORDER_REFUND = 'online_order_refund';

    public function __construct(
        public string $type,
        public ?string $id = null,
        public ?string $number = null,
    ) {}
}
