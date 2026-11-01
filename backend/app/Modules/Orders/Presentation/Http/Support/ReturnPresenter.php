<?php

namespace App\Modules\Orders\Presentation\Http\Support;

use App\Modules\Customers\Application\Contracts\CustomerDirectory;
use App\Modules\Orders\Domain\ReturnStatus;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Orders\Infrastructure\Models\OrderLine;
use App\Modules\Orders\Infrastructure\Models\OrderReturn;
use App\Modules\Orders\Infrastructure\Models\OrderReturnHistory;
use App\Modules\Orders\Infrastructure\Models\OrderReturnLine;
use App\Modules\Payments\Application\Contracts\PaymentLedger;
use App\Modules\Payments\Domain\PaymentSource;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Users\Application\Contracts\UserDirectory;
use Illuminate\Support\Collection;

/**
 * Shapes online returns (E10b) for the customer's account pages and for staff.
 */
class ReturnPresenter
{
    public function __construct(
        private readonly UserDirectory $users,
        private readonly CustomerDirectory $customers,
        private readonly PaymentLedger $payments,
    ) {}

    /**
     * What the customer sees of a return (order detail `returns`, the returns list, POST answers).
     *
     * @return array<string, mixed>
     */
    public function customer(OrderReturn $return): array
    {
        $return->loadMissing(['order', 'lines.orderLine']);

        return [
            'number' => $return->number,
            'order_number' => $return->order->number,
            'order' => ['number' => $return->order->number],
            'status' => $return->status->value,
            'status_label' => $return->status->label(),
            'reason_code' => $return->reason_code->value,
            'reason_label' => $return->reason_code->label(),
            'note' => $return->customer_note,
            'rejection_reason' => $return->rejection_reason,
            'lines' => $this->lines($return, false),
            'items_amount' => (string) $return->items_amount,
            'shipping_refund' => (string) $return->shipping_refund,
            'refund_amount' => (string) $return->refund_amount,
            'currency' => $return->currency,
            'refund_method' => $return->refund_method?->value,
            'refund_method_label' => $return->refund_method?->label(),
            'refunded_at' => $return->refunded_at?->toIso8601String(),
            'can_cancel' => $return->status === ReturnStatus::Requested,
            'created_at' => $return->created_at->toIso8601String(),
        ];
    }

    /**
     * A row of the staff returns list. Expects `order` loaded.
     *
     * @param  array<string, array{id: string, name: string, code: ?string}>  $customers
     * @return array<string, mixed>
     */
    public static function row(OrderReturn $return, array $customers = []): array
    {
        $order = $return->order;

        return [
            'id' => $return->id,
            'number' => $return->number,
            'order' => ['id' => $order->id, 'number' => $order->number],
            'customer_name' => $order->customer_id !== null ? ($customers[$order->customer_id]['name'] ?? $order->contact_name) : $order->contact_name,
            'status' => $return->status->value,
            'status_label' => $return->status->label(),
            'reason_code' => $return->reason_code->value,
            'reason_label' => $return->reason_code->label(),
            'requested_by' => $return->requested_by,
            'refund_amount' => (string) $return->refund_amount,
            'currency' => $return->currency,
            'created_at' => $return->created_at->toIso8601String(),
        ];
    }

    /**
     * The full return for staff.
     *
     * @return array<string, mixed>
     */
    public function staff(OrderReturn $return, bool $canRefund): array
    {
        $return->loadMissing(['order', 'lines.orderLine', 'history']);
        $order = $return->order;
        $payments = $this->payments->entriesOf(PaymentSource::ONLINE_ORDER_REFUND, $return->id);
        $actorIds = array_values(array_filter([
            $return->requested_by_user_id, $return->approved_by, $return->rejected_by, $return->received_by, $return->refunded_by,
            ...$return->history->pluck('actor_user_id')->all(),
            ...array_column($payments, 'created_by'),
        ]));
        $names = $this->users->names($return->organization_id, $actorIds);
        $actor = fn (?string $id) => $id === null ? null : ['id' => $id, 'name' => $names[$id] ?? null];
        $customer = $order->customer_id === null ? null : ($this->customers->summaries($return->organization_id, [$order->customer_id])[$order->customer_id] ?? null);

        return array_replace(self::row($return, $customer === null ? [] : [$order->customer_id => $customer]), [
            'order' => [
                'id' => $order->id,
                'number' => $order->number,
                'status' => $order->status->value,
                'payment_status' => $order->payment_status->value,
                'payment_status_label' => $order->payment_status->label(),
                'payment_method' => $order->payment_method->value,
                'delivered_at' => $order->delivered_at?->toIso8601String(),
                'shipping_total' => (string) $order->shipping_total,
                'total' => (string) $order->total,
                'paid_total' => (string) $order->paid_total,
                'refunded_total' => (string) $order->refunded_total,
            ],
            'customer' => $customer === null ? null : ['id' => $customer['id'], 'name' => $customer['name'], 'code' => $customer['code']],
            'contact' => ['name' => $order->contact_name, 'email' => $order->contact_email, 'phone' => $order->contact_phone],
            'customer_note' => $return->customer_note,
            'staff_note' => $return->staff_note,
            'rejection_reason' => $return->rejection_reason,
            'override_window' => $return->override_window,
            'lines' => $this->lines($return, true),
            'items_amount' => (string) $return->items_amount,
            'shipping_refund' => (string) $return->shipping_refund,
            'refund_method' => $return->refund_method?->value,
            'refund_method_label' => $return->refund_method?->label(),
            'refund_reference' => $return->refund_reference,
            'requested_by_user' => $actor($return->requested_by_user_id),
            'approved_at' => $return->approved_at?->toIso8601String(),
            'approved_by' => $actor($return->approved_by),
            'rejected_at' => $return->rejected_at?->toIso8601String(),
            'rejected_by' => $actor($return->rejected_by),
            'received_at' => $return->received_at?->toIso8601String(),
            'received_by' => $actor($return->received_by),
            'refunded_at' => $return->refunded_at?->toIso8601String(),
            'refunded_by' => $actor($return->refunded_by),
            'cancelled_at' => $return->cancelled_at?->toIso8601String(),
            'history' => $return->history->map(fn (OrderReturnHistory $h) => [
                'from_status' => $h->from_status?->value,
                'status' => $h->to_status->value,
                'label' => $h->to_status->label(),
                'note' => $h->note,
                'at' => $h->created_at->toIso8601String(),
                'actor_type' => $h->actor_type,
                'actor' => $actor($h->actor_user_id),
            ])->values()->all(),
            'payments' => array_map(fn (array $p) => [
                'method' => $p['method'],
                'method_label' => $p['method_label'],
                'direction' => $p['direction'],
                'amount' => $p['amount'],
                'reference' => $p['reference'],
                'recorded_at' => $p['created_at'],
                'recorded_by' => $actor($p['created_by']),
            ], $payments),
            'allowed_actions' => $canRefund ? self::allowedActions($return) : [],
        ]);
    }

    /**
     * Summary of an order's returns on the order pages.
     *
     * @param  Collection<int, OrderReturn>  $returns
     * @return list<array<string, mixed>>
     */
    public static function summaries(Collection $returns): array
    {
        return $returns->map(fn (OrderReturn $r) => [
            'id' => $r->id,
            'number' => $r->number,
            'status' => $r->status->value,
            'status_label' => $r->status->label(),
            'refund_amount' => (string) $r->refund_amount,
            'created_at' => $r->created_at->toIso8601String(),
        ])->values()->all();
    }

    /**
     * @return list<string>
     */
    public static function allowedActions(OrderReturn $return): array
    {
        return match ($return->status) {
            ReturnStatus::Requested => ['approve', 'reject'],
            ReturnStatus::Approved => ['receive'],
            ReturnStatus::Received => ['refund'],
            default => [],
        };
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function lines(OrderReturn $return, bool $staff): array
    {
        return $return->lines->sortBy(fn (OrderReturnLine $l) => $l->orderLine->position)->map(function (OrderReturnLine $l) use ($staff) {
            /** @var OrderLine $source */
            $source = $l->orderLine;
            $line = [
                'order_line_id' => $l->order_line_id,
                'product_name' => $source->product_name,
                'variant_name' => $source->variant_name,
                'sku' => $source->sku,
                'image_url' => $source->image_url,
                'quantity' => self::quantity((string) $l->quantity),
                'requested_quantity' => self::quantity((string) $l->requested_quantity),
                'amount' => (string) $l->amount,
            ];

            return $staff ? ['id' => $l->id, 'product_id' => $source->product_id, 'variant_id' => $source->variant_id] + $line + [
                'ordered_quantity' => self::quantity((string) $source->quantity),
                'unit_price' => (string) $source->unit_price,
                'tax_amount' => (string) $l->tax_amount,
                'restock' => $l->restock,
                'restocked_quantity' => self::quantity((string) $l->restocked_quantity),
            ] : $line;
        })->values()->all();
    }

    private static function quantity(string $quantity): string
    {
        $value = Decimal::round($quantity, 3);

        return str_contains($value, '.') ? rtrim(rtrim($value, '0'), '.') : $value;
    }
}
