<?php

namespace App\Modules\Orders\Presentation\Http\Support;

use App\Modules\Orders\Application\Queries\OrderPaymentDue;
use App\Modules\Orders\Domain\OrderStatus;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Orders\Infrastructure\Models\OrderPaymentClaim;
use App\Modules\Users\Application\Contracts\UserDirectory;
use Illuminate\Support\Collection;

/**
 * BD1c: what an order still owes by Send Money (`payment_due`) and its payment claims.
 */
class PaymentClaimPresenter
{
    public function __construct(
        private readonly OrderPaymentDue $due,
        private readonly UserDirectory $users,
    ) {}

    /**
     * `payment_due`: `{amount, currency, purpose: full|advance, expires_at, methods: [{code,
     * display_name, account_number, account_type, instructions}], claim: {method,
     * transaction_id, sender_phone, status, reject_reason, submitted_at} | null}` (the latest
     * claim), or null when nothing is due. While a claim waits for staff the due stays shown
     * after the hold ran out (the order is not expired meanwhile).
     *
     * @return array<string, mixed>|null
     */
    public function due(Order $order): ?array
    {
        // Only orders awaiting payment can owe one (no claim query for the others).
        if ($order->status !== OrderStatus::PendingPayment) {
            return null;
        }
        $claims = $this->claims($order);
        $due = $this->due->of($order, ignoreExpiry: $claims->contains(fn (OrderPaymentClaim $c) => $c->status === OrderPaymentClaim::SUBMITTED));
        if ($due === null) {
            return null;
        }
        /** @var OrderPaymentClaim|null $latest */
        $latest = $claims->first();

        return $due + ['claim' => $latest === null ? null : [
            'method' => $latest->method->value,
            'transaction_id' => $latest->transaction_id,
            'sender_phone' => $latest->sender_phone,
            'status' => $latest->status,
            'reject_reason' => $latest->reject_reason,
            'submitted_at' => $latest->submitted_at->toIso8601String(),
        ]];
    }

    /**
     * The staff list, newest first: `[{id, method, purpose, amount, sender_phone, transaction_id,
     * status, reject_reason, submitted_at, reviewed_by: {id, name}|null, reviewed_at}]`.
     *
     * @return list<array<string, mixed>>
     */
    public function staff(Order $order): array
    {
        $claims = $this->claims($order);
        $names = $this->users->names($order->organization_id, array_values(array_filter($claims->pluck('reviewed_by')->all())));

        return $claims->map(fn (OrderPaymentClaim $c) => [
            'id' => $c->id,
            'method' => $c->method->value,
            'purpose' => $c->purpose,
            'amount' => (string) $c->amount,
            'sender_phone' => $c->sender_phone,
            'transaction_id' => $c->transaction_id,
            'status' => $c->status,
            'reject_reason' => $c->reject_reason,
            'submitted_at' => $c->submitted_at->toIso8601String(),
            'reviewed_by' => $c->reviewed_by === null ? null : ['id' => $c->reviewed_by, 'name' => $names[$c->reviewed_by] ?? null],
            'reviewed_at' => $c->reviewed_at?->toIso8601String(),
        ])->values()->all();
    }

    public function hasSubmitted(Order $order): bool
    {
        return $this->claims($order)->contains(fn (OrderPaymentClaim $c) => $c->status === OrderPaymentClaim::SUBMITTED);
    }

    /**
     * @return Collection<int, OrderPaymentClaim>
     */
    private function claims(Order $order): Collection
    {
        if (! $order->relationLoaded('paymentClaims')) {
            $order->setRelation('paymentClaims', $order->paymentClaims()->orderByDesc('submitted_at')->orderByDesc('id')->get());
        }

        return $order->paymentClaims;
    }
}
