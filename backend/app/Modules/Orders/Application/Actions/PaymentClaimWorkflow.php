<?php

namespace App\Modules\Orders\Application\Actions;

use App\Modules\Orders\Application\Events\OrderStatusChanged;
use App\Modules\Orders\Application\Queries\OrderPaymentDue;
use App\Modules\Orders\Domain\OrderStatus;
use App\Modules\Orders\Domain\PaymentStatus;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Orders\Infrastructure\Models\OrderPaymentClaim;
use App\Modules\Orders\Infrastructure\Models\OrderStatusChange;
use App\Modules\Payments\Application\Contracts\PaymentLedger;
use App\Modules\Payments\Domain\LedgerEntry;
use App\Modules\Payments\Domain\PaymentDirection;
use App\Modules\Payments\Domain\PaymentMethod as LedgerMethod;
use App\Modules\Payments\Domain\PaymentSource;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\ValueObjects\Money;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * BD1c: Send Money payment claims. The shopper sends the money from their phone, then reports
 * the sender number and the transaction ID (TrxID); staff check it in their wallet app and
 * confirm or reject it.
 *
 * - submit: only while the order owes a payment (OrderPaymentDue, else 422 PAYMENT_NOT_DUE),
 *   with a method allowed for it (else 422 on `method`), no other claim waiting
 *   (409 PAYMENT_CLAIM_PENDING) and a TrxID not used by another claim of the organization for
 *   that wallet unless it was rejected (422 TRANSACTION_ID_USED). The claim keeps the amount
 *   due at that moment.
 * - confirm (staff, order row locked): the claim's amount (at most what is left to pay) goes
 *   into the payments ledger as `mobile_banking` ("bKash TrxID … from …", no drawer),
 *   `paid_total` grows, the order becomes `paid` or — an advance of a cash-on-delivery order —
 *   `partially_paid`, and `pending_payment → confirmed`; history, audit, OrderStatusChanged.
 * - reject (staff, reason): the claim is rejected and the order is unchanged (still pending,
 *   same expiry) — the shopper may submit another claim.
 *
 * Only `submitted` claims can be reviewed (else 422 INVALID_STATUS_TRANSITION).
 */
class PaymentClaimWorkflow
{
    public function __construct(
        private readonly OrderPaymentDue $due,
        private readonly PaymentLedger $payments,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  string  $senderPhone  normalised 01XXXXXXXXX
     * @param  string  $transactionId  as typed (trimmed and upper-cased here)
     *
     * @throws BusinessRuleViolation PAYMENT_NOT_DUE, PAYMENT_CLAIM_PENDING, TRANSACTION_ID_USED
     * @throws ValidationException method, transaction_id
     */
    public function submit(Order $order, string $method, string $senderPhone, string $transactionId, ?string $ip): OrderPaymentClaim
    {
        $transactionId = self::normalizeTransactionId($transactionId);
        if (preg_match('/^[A-Z0-9]{6,40}$/', $transactionId) !== 1) {
            throw ValidationException::withMessages(['transaction_id' => ['Enter the transaction ID (TrxID) from the payment message: 6–40 letters and digits.']]);
        }

        try {
            return DB::transaction(function () use ($order, $method, $senderPhone, $transactionId, $ip) {
                /** @var Order $locked */
                $locked = Order::query()->whereKey($order->id)->lockForUpdate()->firstOrFail();
                $due = $this->due->of($locked);
                if ($due === null) {
                    throw new BusinessRuleViolation('PAYMENT_NOT_DUE', "Nothing is waiting to be paid for {$locked->number}.", ['status' => $locked->status->value]);
                }
                if (! in_array($method, OrderPaymentDue::methodCodes($locked, $due), true)) {
                    throw ValidationException::withMessages(['method' => ['Choose one of the payment methods shown for this order.']]);
                }
                if (OrderPaymentClaim::query()->where('order_id', $locked->id)->where('status', OrderPaymentClaim::SUBMITTED)->exists()) {
                    throw new BusinessRuleViolation('PAYMENT_CLAIM_PENDING', 'We are already checking a payment for this order. Please wait for it to be confirmed.', [], 409);
                }
                $this->assertUnused($method, $transactionId);

                $claim = OrderPaymentClaim::query()->create([
                    'organization_id' => $locked->organization_id,
                    'order_id' => $locked->id,
                    'method' => $method,
                    'purpose' => $due['purpose'],
                    'amount' => $due['amount'],
                    'sender_phone' => $senderPhone,
                    'transaction_id' => $transactionId,
                    'status' => OrderPaymentClaim::SUBMITTED,
                    'submitted_at' => now(),
                    'ip' => $ip,
                ]);
                $this->audit->record('web_order.payment_claim_submitted', $locked, new: [
                    'number' => $locked->number, 'claim_id' => $claim->id, 'method' => $method, 'purpose' => $due['purpose'],
                    'amount' => $due['amount'], 'transaction_id' => $transactionId, 'sender_phone' => $senderPhone,
                ]);

                return $claim;
            });
        } catch (UniqueConstraintViolationException) {
            // Two shoppers reporting the same TrxID at once: the partial unique index decides.
            throw self::transactionIdUsed();
        }
    }

    /**
     * @throws BusinessRuleViolation INVALID_STATUS_TRANSITION, PAYMENT_NOT_DUE
     */
    public function confirm(Order $order, string $claimId, string $actorId): Order
    {
        return DB::transaction(function () use ($order, $claimId, $actorId) {
            /** @var Order $locked */
            $locked = Order::query()->whereKey($order->id)->lockForUpdate()->firstOrFail();
            $claim = $this->submittedClaim($locked, $claimId);
            // A claim sent in time may be confirmed after the hold ran out (the expiry job waits for it).
            if ($this->due->of($locked, ignoreExpiry: true) === null) {
                throw new BusinessRuleViolation('PAYMENT_NOT_DUE', "Nothing is waiting to be paid for {$locked->number} any more; reject the claim instead.", ['status' => $locked->status->value]);
            }

            $currency = $locked->currency;
            $total = Money::of((string) $locked->total, $currency);
            $paidBefore = Money::of((string) $locked->paid_total, $currency);
            $left = $total->minus($paidBefore);
            $amount = Money::of((string) $claim->amount, $currency);
            if ($amount->greaterThan($left)) {
                $amount = $left;
            }
            $paid = $paidBefore->plus($amount);
            $paymentFrom = $locked->payment_status;
            $paymentTo = $paid->lessThan($total) ? PaymentStatus::PartiallyPaid : PaymentStatus::Paid;
            $wallet = $claim->method->walletName() ?? $claim->method->label();
            $reference = "{$wallet} TrxID {$claim->transaction_id} from {$claim->sender_phone}";

            $this->payments->recordSystem($locked->branch_id, [
                new LedgerEntry(PaymentDirection::In, LedgerMethod::MobileBanking, $amount->amount(), $locked->customer_id, $reference, "Web order {$locked->number}"),
            ], new PaymentSource(PaymentSource::ONLINE_ORDER, $locked->id, $locked->number), $actorId);

            $now = now();
            $claim->update(['status' => OrderPaymentClaim::CONFIRMED, 'reviewed_by' => $actorId, 'reviewed_at' => $now]);
            $from = $locked->status;
            $from->assertCanBecome(OrderStatus::Confirmed, $locked->number);
            $locked->update([
                'status' => OrderStatus::Confirmed,
                'payment_status' => $paymentTo,
                'paid_total' => $paid->amount(),
                'confirmed_at' => $now,
                'expires_at' => null,
            ]);
            $note = $claim->purpose === OrderPaymentClaim::PURPOSE_ADVANCE
                ? "Advance delivery charge received ({$wallet} TrxID {$claim->transaction_id})"
                : "Payment confirmed ({$wallet} TrxID {$claim->transaction_id})";
            OrderStatusChange::query()->create([
                'organization_id' => $locked->organization_id,
                'order_id' => $locked->id,
                'from_status' => $from,
                'to_status' => OrderStatus::Confirmed,
                'note' => $note,
                'actor_user_id' => $actorId,
                'actor_type' => 'staff',
                'created_at' => $now,
            ]);
            $this->audit->record('web_order.payment_claim_confirmed', $locked, [
                'status' => $from->value, 'payment_status' => $paymentFrom->value, 'paid_total' => $paidBefore->amount(),
            ], [
                'status' => OrderStatus::Confirmed->value, 'payment_status' => $paymentTo->value, 'paid_total' => $paid->amount(),
                'number' => $locked->number, 'claim_id' => $claim->id, 'method' => $claim->method->value, 'purpose' => $claim->purpose,
                'amount' => $amount->amount(), 'reference' => $reference,
            ]);
            // After commit (order SMS and other listeners).
            event(new OrderStatusChanged($locked->organization_id, $locked->id, $from->value, OrderStatus::Confirmed->value, 'staff'));

            return $locked;
        });
    }

    /**
     * @throws BusinessRuleViolation INVALID_STATUS_TRANSITION
     */
    public function reject(Order $order, string $claimId, string $reason, string $actorId): Order
    {
        return DB::transaction(function () use ($order, $claimId, $reason, $actorId) {
            /** @var Order $locked */
            $locked = Order::query()->whereKey($order->id)->lockForUpdate()->firstOrFail();
            $claim = $this->submittedClaim($locked, $claimId);
            $claim->update(['status' => OrderPaymentClaim::REJECTED, 'reject_reason' => mb_substr($reason, 0, 200), 'reviewed_by' => $actorId, 'reviewed_at' => now()]);
            $this->audit->record('web_order.payment_claim_rejected', $locked, ['claim_status' => OrderPaymentClaim::SUBMITTED], [
                'claim_status' => OrderPaymentClaim::REJECTED, 'number' => $locked->number, 'claim_id' => $claim->id,
                'method' => $claim->method->value, 'transaction_id' => $claim->transaction_id, 'reason' => $reason,
            ]);

            return $locked;
        });
    }

    public static function normalizeTransactionId(string $transactionId): string
    {
        return mb_strtoupper((string) preg_replace('/\s+/', '', $transactionId));
    }

    /**
     * @throws BusinessRuleViolation TRANSACTION_ID_USED
     */
    private function assertUnused(string $method, string $transactionId): void
    {
        $used = OrderPaymentClaim::query()
            ->where('method', $method)
            ->where('transaction_id', $transactionId)
            ->where('status', '!=', OrderPaymentClaim::REJECTED)
            ->exists();
        if ($used) {
            throw self::transactionIdUsed();
        }
    }

    private static function transactionIdUsed(): BusinessRuleViolation
    {
        return new BusinessRuleViolation('TRANSACTION_ID_USED', 'This transaction ID was already used for a payment. Check the TrxID in your payment message.');
    }

    /**
     * @throws BusinessRuleViolation INVALID_STATUS_TRANSITION
     */
    private function submittedClaim(Order $locked, string $claimId): OrderPaymentClaim
    {
        /** @var OrderPaymentClaim $claim */
        $claim = OrderPaymentClaim::query()->where('order_id', $locked->id)->whereKey($claimId)->lockForUpdate()->firstOrFail();
        if ($claim->status !== OrderPaymentClaim::SUBMITTED) {
            throw new BusinessRuleViolation('INVALID_STATUS_TRANSITION', "This payment claim was already {$claim->status}.", [
                'from' => $claim->status, 'allowed' => [],
            ]);
        }

        return $claim;
    }
}
