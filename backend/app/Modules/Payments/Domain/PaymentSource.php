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

    /** ST1: money paid to a supplier (Purchasing); its reversal is `supplier_payment_void`. */
    public const SUPPLIER_PAYMENT = 'supplier_payment';

    public const SUPPLIER_PAYMENT_VOID = 'supplier_payment_void';

    /** ST1: money a supplier gave back (Purchasing); its reversal is `supplier_refund_void`. */
    public const SUPPLIER_REFUND = 'supplier_refund';

    public const SUPPLIER_REFUND_VOID = 'supplier_refund_void';

    /** POS1b: a customer advance (money in, raises the customer's store credit; StoredValue). */
    public const STORE_CREDIT_TOP_UP = 'store_credit_top_up';

    /** POS1b: store credit paid out to the customer (money out; StoredValue). */
    public const STORE_CREDIT_WITHDRAWAL = 'store_credit_withdrawal';

    /** POS1b: a gift card sold at the till (money in, receipt GCS-000001; StoredValue). Not a sale. */
    public const GIFT_CARD_SALE = 'gift_card_sale';

    public function __construct(
        public string $type,
        public ?string $id = null,
        public ?string $number = null,
    ) {}
}
