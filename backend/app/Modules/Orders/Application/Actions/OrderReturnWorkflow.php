<?php

namespace App\Modules\Orders\Application\Actions;

use App\Modules\Inventory\Application\Contracts\StockLedger;
use App\Modules\Inventory\Domain\MovementType;
use App\Modules\Inventory\Domain\StockChange;
use App\Modules\Inventory\Domain\StockReference;
use App\Modules\Orders\Application\Events\OrderReturnRequested;
use App\Modules\Orders\Application\Events\OrderReturnUpdated;
use App\Modules\Orders\Application\Services\RefundPayout;
use App\Modules\Orders\Application\Services\ReturnPolicy;
use App\Modules\Orders\Domain\PaymentStatus;
use App\Modules\Orders\Domain\RefundMethod;
use App\Modules\Orders\Domain\ReturnReason;
use App\Modules\Orders\Domain\ReturnStatus;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Orders\Infrastructure\Models\OrderLine;
use App\Modules\Orders\Infrastructure\Models\OrderLineStock;
use App\Modules\Orders\Infrastructure\Models\OrderReturn;
use App\Modules\Orders\Infrastructure\Models\OrderReturnHistory;
use App\Modules\Orders\Infrastructure\Models\OrderReturnLine;
use App\Modules\Orders\Infrastructure\Models\OrderReturnLineStock;
use App\Modules\Payments\Domain\PaymentSource;
use App\Modules\Sales\Domain\ReturnShare;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\SequenceGenerator;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Shared\Domain\ValueObjects\Money;
use Closure;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use LogicException;

/**
 * Online returns and refunds of web orders (E10b), mirroring the POS returns of Phase 6.
 *
 *   request  (customer or staff) → requested: lines valued at their share of what the order
 *            line charged (discount and tax included; the return taking the last unit of a
 *            line takes the exact remainder — `Sales\Domain\ReturnShare`). Quantities held by
 *            active returns limit what is left (QUANTITY_EXCEEDS_RETURNABLE); only delivered,
 *            paid orders within the return window (RETURN_NOT_ALLOWED; staff may override the
 *            window with a note).
 *   approve  → approved: staff may lower quantities (re-valued) and add a shipping refund
 *            (at most the delivery fee not yet refunded). `reject` → rejected (reason).
 *   cancel   (the customer, own return, while requested) → cancelled.
 *   receive  → received: per line restock (back to the exact `order_line_stock` batches at
 *            their cost as `online_return`, never more than an allocation held) or write-off.
 *   refund   → refunded: the refund amount leaves through the payments ledger
 *            (`online_order_refund`): bank transfer and mobile banking without a drawer
 *            (`recordSystem`), cash from the refunding user's open register session in the
 *            order's branch. The order's `refunded_total` grows and its payment status
 *            becomes `partially_refunded` or `refunded` (refunds = paid total); the order
 *            status stays `delivered`.
 *
 * Every step locks the order row, then the return row (one lock order everywhere), checks
 * the transition (INVALID_STATUS_TRANSITION), appends the return history and is audited
 * (`web_order_return.*`). Endpoints are idempotent (Idempotency-Key).
 */
class OrderReturnWorkflow
{
    public function __construct(
        private readonly ReturnPolicy $policy,
        private readonly StockLedger $stock,
        private readonly RefundPayout $payout,
        private readonly SequenceGenerator $sequences,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  array{reason_code: string, note?: ?string, lines: list<array{order_line_id: string, quantity: string|int|float}>, override_window?: bool}  $data
     * @param  string  $by  customer | staff
     *
     * @throws BusinessRuleViolation RETURN_NOT_ALLOWED (details.reason), QUANTITY_EXCEEDS_RETURNABLE (details.lines)
     * @throws ValidationException lines.*, note
     */
    public function request(Order $order, array $data, string $by, ?string $actorId): OrderReturn
    {
        $override = $by === 'staff' && (bool) ($data['override_window'] ?? false);
        $note = self::text($data['note'] ?? null);

        $return = DB::transaction(function () use ($order, $data, $by, $actorId, $override, $note) {
            /** @var Order $locked */
            $locked = Order::query()->whereKey($order->id)->lockForUpdate()->firstOrFail();
            $blocker = $this->policy->blocker($locked, $override);
            if ($blocker !== null) {
                throw new BusinessRuleViolation('RETURN_NOT_ALLOWED', self::blockerMessage($locked, $blocker), ['reason' => $blocker]);
            }
            $windowClosed = $override && $this->policy->blocker($locked) !== null;
            if ($windowClosed && $note === null) {
                throw ValidationException::withMessages(['note' => ['Explain why the return is accepted after the return window.']]);
            }

            $orderLines = $locked->lines()->get()->keyBy('id');
            $returnable = $this->policy->returnable($locked);
            $held = $this->policy->held($locked);
            $lines = $this->requestedLines($data['lines'], $orderLines->all(), $returnable);

            $now = now();
            $valued = [];
            foreach ($lines as $line) {
                $valued[] = ['line' => $line['line'], 'quantity' => $line['quantity']] + $this->share($line['line'], $held, $line['quantity'], $locked->currency);
            }
            $items = $this->sum($valued, 'amount', $locked->currency);

            $return = OrderReturn::query()->create([
                'organization_id' => $locked->organization_id,
                'order_id' => $locked->id,
                'number' => $this->sequences->next($locked->organization_id, 'order_return', 'RTN-WEB-'),
                'status' => ReturnStatus::Requested,
                'reason_code' => ReturnReason::from($data['reason_code']),
                'customer_note' => $by === 'customer' ? $note : null,
                'staff_note' => $by === 'staff' ? $note : null,
                'requested_by' => $by,
                'override_window' => $windowClosed,
                'currency' => $locked->currency,
                'items_amount' => $items,
                'shipping_refund' => '0.00',
                'refund_amount' => $items,
                'requested_by_user_id' => $by === 'staff' ? $actorId : null,
            ]);
            foreach ($valued as $line) {
                OrderReturnLine::query()->create([
                    'organization_id' => $locked->organization_id,
                    'return_id' => $return->id,
                    'order_line_id' => $line['line']->id,
                    'requested_quantity' => $line['quantity'],
                    'quantity' => $line['quantity'],
                    'amount' => $line['amount'],
                    'tax_amount' => $line['tax_amount'],
                    'cost_total' => $line['cost_total'],
                    'restocked_quantity' => '0',
                    'created_at' => $now,
                ]);
            }
            $this->history($return, null, ReturnStatus::Requested, $note, $by === 'staff' ? $actorId : null, $by);
            $this->audit->record('web_order_return.requested', $return, new: [
                'number' => $return->number,
                'order' => $locked->number,
                'by' => $by,
                'reason' => $return->reason_code->value,
                'items_amount' => $items,
                'override_window' => $windowClosed,
                'note' => $note,
                'lines' => array_map(fn (array $l) => ['sku' => $l['line']->sku, 'quantity' => $l['quantity'], 'amount' => $l['amount']], $valued),
            ]);

            return $return;
        });

        if ($by === 'customer') {
            event(new OrderReturnRequested($return->organization_id, $return->id));
        }

        return $return;
    }

    /**
     * requested → approved. `$lines` (optional) lowers quantities per order line (0 drops the
     * line); `$shippingRefund` adds part or all of the delivery fee to the refund.
     *
     * @param  list<array{order_line_id: string, quantity: string|int|float}>|null  $lines
     *
     * @throws ValidationException lines.*, shipping_refund
     */
    public function approve(OrderReturn $return, ?array $lines, ?string $shippingRefund, ?string $note, string $actorId): OrderReturn
    {
        $approved = $this->locked($return, function (Order $order, OrderReturn $r) use ($lines, $shippingRefund, $note, $actorId) {
            $r->status->assertCanBecome(ReturnStatus::Approved, $r->number);
            $returnLines = $r->lines()->get()->keyBy('order_line_id');
            $quantities = [];
            foreach ($returnLines as $orderLineId => $line) {
                $quantities[$orderLineId] = (string) $line->quantity;
            }

            $errors = [];
            $seen = [];
            foreach (array_values($lines ?? []) as $i => $change) {
                $id = (string) $change['order_line_id'];
                $line = $returnLines[$id] ?? null;
                if ($line === null || isset($seen[$id])) {
                    $errors["lines.{$i}.order_line_id"] = [$line === null ? 'This line is not part of the return.' : 'This line is listed twice.'];

                    continue;
                }
                $seen[$id] = true;
                $quantity = Decimal::round((string) $change['quantity'], 3);
                if (Decimal::isNegative($quantity) || Decimal::compare($quantity, (string) $line->requested_quantity) > 0) {
                    $errors["lines.{$i}.quantity"] = ['Between 0 and the requested '.self::quantity((string) $line->requested_quantity).'.'];

                    continue;
                }
                $quantities[$id] = $quantity;
            }
            if ($errors === [] && array_filter($quantities, fn (string $q) => Decimal::compare($q, '0') > 0) === []) {
                $errors['lines'] = ['Approve at least one item, or reject the return.'];
            }

            $shipping = Money::of($shippingRefund ?? '0', $r->currency);
            $shippingLeft = Money::of((string) $order->shipping_total, $r->currency)->minus(Money::of($this->policy->shippingRefunded($order, $r->id), $r->currency));
            if ($shipping->isNegative() || $shipping->greaterThan($shippingLeft)) {
                $errors['shipping_refund'] = ["At most {$shippingLeft->amount()} of the delivery fee can be refunded."];
            }
            if ($errors !== []) {
                throw ValidationException::withMessages($errors);
            }

            // Re-value every line against the other active returns (the remainder rule).
            $held = $this->policy->held($order, $r->id);
            $orderLines = $order->lines()->get()->keyBy('id');
            $valued = [];
            foreach ($returnLines as $orderLineId => $line) {
                $quantity = $quantities[$orderLineId];
                $values = Decimal::compare($quantity, '0') > 0
                    ? $this->share($orderLines[$orderLineId], $held, $quantity, $r->currency)
                    : ['amount' => '0.00', 'tax_amount' => '0.00', 'cost_total' => '0.00'];
                $line->update(['quantity' => $quantity] + $values);
                $valued[] = $values;
            }
            $items = $this->sum($valued, 'amount', $r->currency);
            $from = $r->status;
            $r->update([
                'status' => ReturnStatus::Approved,
                'items_amount' => $items,
                'shipping_refund' => $shipping->amount(),
                'refund_amount' => Money::of($items, $r->currency)->plus($shipping)->amount(),
                'staff_note' => $note ?? $r->staff_note,
                'approved_at' => now(),
                'approved_by' => $actorId,
            ]);
            $this->history($r, $from, ReturnStatus::Approved, $note, $actorId, 'staff');
            $this->audit->record('web_order_return.approved', $r, ['status' => $from->value], [
                'status' => ReturnStatus::Approved->value,
                'number' => $r->number,
                'order' => $order->number,
                'quantities' => $quantities,
                'items_amount' => $items,
                'shipping_refund' => $shipping->amount(),
                'refund_amount' => $r->refund_amount,
                'note' => $note,
            ]);
        });
        event(new OrderReturnUpdated($approved->organization_id, $approved->id, 'approved'));

        return $approved;
    }

    public function reject(OrderReturn $return, string $reason, string $actorId): OrderReturn
    {
        $rejected = $this->locked($return, function (Order $order, OrderReturn $r) use ($reason, $actorId) {
            $from = $r->status;
            $from->assertCanBecome(ReturnStatus::Rejected, $r->number);
            $r->update(['status' => ReturnStatus::Rejected, 'rejection_reason' => $reason, 'rejected_at' => now(), 'rejected_by' => $actorId]);
            $this->history($r, $from, ReturnStatus::Rejected, $reason, $actorId, 'staff');
            $this->audit->record('web_order_return.rejected', $r, ['status' => $from->value], [
                'status' => ReturnStatus::Rejected->value, 'number' => $r->number, 'order' => $order->number, 'reason' => $reason,
            ]);
        });
        event(new OrderReturnUpdated($rejected->organization_id, $rejected->id, 'rejected'));

        return $rejected;
    }

    /**
     * The customer withdraws their own request (`requested` only, else RETURN_NOT_CANCELLABLE).
     *
     * @throws BusinessRuleViolation RETURN_NOT_CANCELLABLE (details.status)
     */
    public function cancelByCustomer(OrderReturn $return): OrderReturn
    {
        return $this->locked($return, function (Order $order, OrderReturn $r) {
            $from = $r->status;
            if ($from !== ReturnStatus::Requested) {
                throw new BusinessRuleViolation('RETURN_NOT_CANCELLABLE', "{$r->number} is {$from->label()} and can no longer be cancelled.", ['status' => $from->value]);
            }
            $r->update(['status' => ReturnStatus::Cancelled, 'cancelled_at' => now()]);
            $this->history($r, $from, ReturnStatus::Cancelled, null, null, 'customer');
            $this->audit->record('web_order_return.cancelled', $r, ['status' => $from->value], [
                'status' => ReturnStatus::Cancelled->value, 'number' => $r->number, 'order' => $order->number, 'by' => 'customer',
            ]);
        });
    }

    /**
     * approved → received. `$restock`: order line id → true (back to stock) | false (written
     * off); lines not listed are restocked.
     *
     * @param  array<string, bool>  $restock
     *
     * @throws ValidationException lines.*
     */
    public function receive(OrderReturn $return, array $restock, string $actorId): OrderReturn
    {
        return $this->locked($return, function (Order $order, OrderReturn $r) use ($restock, $actorId) {
            $from = $r->status;
            $from->assertCanBecome(ReturnStatus::Received, $r->number);
            $lines = $r->lines()->with('orderLine')->get();
            $unknown = array_diff(array_keys($restock), $lines->pluck('order_line_id')->all());
            if ($unknown !== []) {
                throw ValidationException::withMessages(['lines' => ['Only lines of the return can be received.']]);
            }

            $changes = [];
            $records = [];
            foreach ($lines as $line) {
                $back = Decimal::compare((string) $line->quantity, '0') > 0 && ($restock[$line->order_line_id] ?? true);
                if (! $back) {
                    continue;
                }
                $allocations = OrderLineStock::query()->where('order_line_id', $line->order_line_id)->orderByDesc('id')->get();
                $already = OrderReturnLineStock::query()->whereIn('order_line_stock_id', $allocations->pluck('id'))
                    ->groupBy('order_line_stock_id')->selectRaw('order_line_stock_id, SUM(quantity) as quantity')->pluck('quantity', 'order_line_stock_id');

                $left = (string) $line->quantity;
                foreach ($allocations as $allocation) {
                    if (Decimal::compare($left, '0') <= 0) {
                        break;
                    }
                    $free = Decimal::sub((string) $allocation->quantity, Decimal::round((string) ($already[$allocation->id] ?? '0'), 3), 3);
                    if (Decimal::compare($free, '0') <= 0) {
                        continue;
                    }
                    $take = Decimal::compare($free, $left) < 0 ? $free : $left;
                    $changes[] = new StockChange($order->store_id, $line->orderLine->variant_id, $allocation->batch_id, MovementType::OnlineReturn, $take, (string) $allocation->unit_cost);
                    $records[] = ['line' => $line, 'allocation' => $allocation, 'quantity' => $take];
                    $left = Decimal::sub($left, $take, 3);
                }
                if ($allocations->isNotEmpty() && Decimal::compare($left, '0') > 0) {
                    throw new LogicException("Return line {$line->id} exceeds the stock its order line took.");
                }
            }

            $results = $this->stock->post($changes, new StockReference('online_return', $r->id, $r->number));
            $restocked = [];
            foreach ($records as $i => $record) {
                OrderReturnLineStock::query()->create([
                    'organization_id' => $r->organization_id,
                    'return_line_id' => $record['line']->id,
                    'order_line_stock_id' => $record['allocation']->id,
                    'batch_id' => $record['allocation']->batch_id,
                    'quantity' => $record['quantity'],
                    'unit_cost' => $record['allocation']->unit_cost,
                    'movement_id' => $results[$i]['movement_id'] ?? null,
                ]);
                $restocked[$record['line']->id] = Decimal::add($restocked[$record['line']->id] ?? '0', $record['quantity'], 3);
            }

            $decisions = [];
            foreach ($lines as $line) {
                $back = Decimal::compare((string) $line->quantity, '0') > 0 && ($restock[$line->order_line_id] ?? true);
                $line->update(['restock' => $back, 'restocked_quantity' => $restocked[$line->id] ?? '0']);
                $decisions[$line->orderLine->sku] = ['restock' => $back, 'restocked_quantity' => $restocked[$line->id] ?? '0.000'];
            }

            $r->update(['status' => ReturnStatus::Received, 'received_at' => now(), 'received_by' => $actorId]);
            $this->history($r, $from, ReturnStatus::Received, null, $actorId, 'staff');
            $this->audit->record('web_order_return.received', $r, ['status' => $from->value], [
                'status' => ReturnStatus::Received->value, 'number' => $r->number, 'order' => $order->number, 'lines' => $decisions,
            ]);
        });
    }

    /**
     * received → refunded: the refund amount goes out through the payments ledger.
     *
     * @throws BusinessRuleViolation CASH_SESSION_REQUIRED, INSUFFICIENT_CASH (cash refunds)
     */
    public function refund(OrderReturn $return, RefundMethod $method, ?string $reference, TenantUser $actor): OrderReturn
    {
        $actorId = (string) $actor->getAuthIdentifier();
        $refunded = $this->locked($return, function (Order $order, OrderReturn $r) use ($method, $reference, $actor, $actorId) {
            $from = $r->status;
            $from->assertCanBecome(ReturnStatus::Refunded, $r->number);
            $amount = Money::of((string) $r->refund_amount, $r->currency);
            $refundedTotal = Money::of((string) $order->refunded_total, $r->currency)->plus($amount);
            $paid = Money::of((string) $order->paid_total, $r->currency);
            if ($refundedTotal->greaterThan($paid)) {
                throw new BusinessRuleViolation('REFUND_EXCEEDS_PAID', "{$order->number} was paid {$paid->amount()}; refunds cannot exceed it.", [
                    'paid_total' => $paid->amount(), 'refunded_total' => (string) $order->refunded_total, 'amount' => $amount->amount(),
                ]);
            }

            $this->payout->payOut($order, $amount, $method, $reference, $actor, new PaymentSource(PaymentSource::ONLINE_ORDER_REFUND, $r->id, $r->number), "Refund {$r->number} of web order {$order->number}");

            $r->update([
                'status' => ReturnStatus::Refunded,
                'refund_method' => $method,
                'refund_reference' => $reference,
                'refunded_at' => now(),
                'refunded_by' => $actorId,
            ]);
            $paymentFrom = $order->payment_status;
            $paymentTo = $refundedTotal->equals($paid) ? PaymentStatus::Refunded : PaymentStatus::PartiallyRefunded;
            $order->update(['refunded_total' => $refundedTotal->amount(), 'payment_status' => $paymentTo]);

            $this->history($r, $from, ReturnStatus::Refunded, $reference, $actorId, 'staff');
            $this->audit->record('web_order_return.refunded', $r, ['status' => $from->value], [
                'status' => ReturnStatus::Refunded->value, 'number' => $r->number, 'order' => $order->number,
                'amount' => $amount->amount(), 'method' => $method->value, 'reference' => $reference,
            ]);
            $this->audit->record('web_order.refunded', $order, ['payment_status' => $paymentFrom->value, 'refunded_total' => Decimal::round(Decimal::sub($refundedTotal->amount(), $amount->amount(), 2), 2)], [
                'payment_status' => $paymentTo->value, 'refunded_total' => $refundedTotal->amount(), 'return' => $r->number, 'amount' => $amount->amount(),
            ]);
        });
        event(new OrderReturnUpdated($refunded->organization_id, $refunded->id, 'refunded'));

        return $refunded;
    }

    /**
     * @param  Closure(Order, OrderReturn): mixed  $step
     */
    private function locked(OrderReturn $return, Closure $step): OrderReturn
    {
        return DB::transaction(function () use ($return, $step) {
            /** @var Order $order */
            $order = Order::query()->whereKey($return->order_id)->lockForUpdate()->firstOrFail();
            /** @var OrderReturn $locked */
            $locked = OrderReturn::query()->whereKey($return->id)->lockForUpdate()->firstOrFail();
            $step($order, $locked);

            return $locked;
        });
    }

    /**
     * Validates the requested lines against the order and what is left to return.
     *
     * @param  list<array{order_line_id: string, quantity: string|int|float}>  $requested
     * @param  array<string, OrderLine>  $orderLines
     * @param  array<string, string>  $returnable
     * @return list<array{line: OrderLine, quantity: string}>
     */
    private function requestedLines(array $requested, array $orderLines, array $returnable): array
    {
        $errors = [];
        $exceeding = [];
        $seen = [];
        $lines = [];
        foreach (array_values($requested) as $i => $entry) {
            $id = (string) $entry['order_line_id'];
            $line = $orderLines[$id] ?? null;
            if ($line === null) {
                $errors["lines.{$i}.order_line_id"] = ['This item is not part of the order.'];

                continue;
            }
            if (isset($seen[$id])) {
                $errors["lines.{$i}.order_line_id"] = ["{$line->product_name} is listed twice."];

                continue;
            }
            $seen[$id] = true;
            $quantity = Decimal::round((string) $entry['quantity'], 3);
            if (Decimal::compare($quantity, '0') <= 0) {
                $errors["lines.{$i}.quantity"] = ['The quantity must be greater than zero.'];

                continue;
            }
            if (Decimal::isWhole((string) $line->quantity) && ! Decimal::isWhole($quantity)) {
                $errors["lines.{$i}.quantity"] = ['This item is returned in whole units.'];

                continue;
            }
            if (Decimal::compare($quantity, $returnable[$id] ?? '0') > 0) {
                $exceeding[] = ['order_line_id' => $id, 'product_name' => $line->product_name, 'requested' => self::quantity($quantity), 'returnable' => self::quantity($returnable[$id] ?? '0')];

                continue;
            }
            $lines[] = ['line' => $line, 'quantity' => $quantity];
        }

        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }
        if ($exceeding !== []) {
            throw new BusinessRuleViolation(
                'QUANTITY_EXCEEDS_RETURNABLE',
                count($exceeding) === 1
                    ? "Only {$exceeding[0]['returnable']} of {$exceeding[0]['product_name']} can still be returned."
                    : 'Some items cannot be returned in these quantities.',
                ['lines' => $exceeding],
            );
        }
        if ($lines === []) {
            throw ValidationException::withMessages(['lines' => ['Choose at least one item to return.']]);
        }

        return $lines;
    }

    /**
     * @param  array<string, array{quantity: string, line_total: string, tax_amount: string, cost_total: string}>  $held
     * @return array{amount: string, tax_amount: string, cost_total: string}
     */
    private function share(OrderLine $line, array $held, string $quantity, string $currency): array
    {
        $share = ReturnShare::of(
            ['quantity' => (string) $line->quantity, 'line_total' => (string) $line->line_total, 'tax_amount' => (string) $line->tax_amount, 'cost_total' => (string) $line->cost_total],
            $held[$line->id] ?? ['quantity' => '0', 'line_total' => '0', 'tax_amount' => '0', 'cost_total' => '0'],
            $quantity,
            $currency,
        );

        return ['amount' => $share['line_total'], 'tax_amount' => $share['tax_amount'], 'cost_total' => $share['cost_total']];
    }

    /**
     * @param  list<array<string, mixed>>  $rows
     */
    private function sum(array $rows, string $field, string $currency): string
    {
        return array_reduce($rows, fn (Money $s, array $r) => $s->plus(Money::of((string) $r[$field], $currency)), Money::zero($currency))->amount();
    }

    private function history(OrderReturn $r, ?ReturnStatus $from, ReturnStatus $to, ?string $note, ?string $actorId, string $actorType): void
    {
        OrderReturnHistory::query()->create([
            'organization_id' => $r->organization_id,
            'return_id' => $r->id,
            'from_status' => $from,
            'to_status' => $to,
            'note' => $note === null ? null : mb_substr($note, 0, 255),
            'actor_user_id' => $actorId,
            'actor_type' => $actorType,
            'created_at' => now(),
        ]);
    }

    private static function blockerMessage(Order $order, string $blocker): string
    {
        return match ($blocker) {
            ReturnPolicy::NOT_DELIVERED => "{$order->number} has not been delivered yet; returns start after delivery.",
            ReturnPolicy::NOT_PAID => "{$order->number} has not been paid; nothing can be refunded.",
            ReturnPolicy::RETURNS_DISABLED => 'This store does not accept returns online; please contact us.',
            default => "The return window of {$order->number} has closed.",
        };
    }

    private static function text(mixed $value): ?string
    {
        return is_string($value) && trim($value) !== '' ? trim($value) : null;
    }

    /**
     * "2" for whole quantities, "1.5" otherwise.
     */
    private static function quantity(string $quantity): string
    {
        $value = Decimal::round($quantity, 3);

        return str_contains($value, '.') ? rtrim(rtrim($value, '0'), '.') : $value;
    }
}
