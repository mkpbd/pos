<?php

namespace App\Modules\Orders\Application\Services;

use App\Modules\Orders\Domain\RefundMethod;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Payments\Application\Contracts\PaymentLedger;
use App\Modules\Payments\Domain\LedgerEntry;
use App\Modules\Payments\Domain\PaymentDirection;
use App\Modules\Payments\Domain\PaymentSource;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\ValueObjects\Money;

/**
 * Pays a web order refund out through the payments ledger (`online_order_refund`, direction
 * out) — the single path of return refunds (E10b) and paid cancellations (E11). Bank transfer
 * and mobile banking are recorded without a drawer; cash leaves the refunding user's open
 * register session in the order's branch (CASH_SESSION_REQUIRED, INSUFFICIENT_CASH).
 * Call it inside the caller's transaction, with the order row locked.
 */
class RefundPayout
{
    public function __construct(private readonly PaymentLedger $payments) {}

    /**
     * @throws BusinessRuleViolation CASH_SESSION_REQUIRED, INSUFFICIENT_CASH
     */
    public function payOut(Order $order, Money $amount, RefundMethod $method, ?string $reference, TenantUser $actor, PaymentSource $source, string $memo): void
    {
        if (! $amount->isPositive()) {
            return;
        }

        $entry = new LedgerEntry(PaymentDirection::Out, $method->ledgerMethod(), $amount->amount(), $order->customer_id, $reference, $memo);
        if ($method === RefundMethod::Cash) {
            $this->payments->record($actor, $order->branch_id, [$entry], $source);
        } else {
            $this->payments->recordSystem($order->branch_id, [$entry], $source, (string) $actor->getAuthIdentifier());
        }
    }
}
