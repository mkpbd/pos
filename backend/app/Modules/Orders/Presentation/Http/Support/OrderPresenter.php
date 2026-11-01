<?php

namespace App\Modules\Orders\Presentation\Http\Support;

use App\Modules\Customers\Application\Contracts\CustomerDirectory;
use App\Modules\OnlinePayments\Application\Contracts\CheckoutPaymentMethods;
use App\Modules\Orders\Application\Actions\CancelOrder;
use App\Modules\Orders\Application\Actions\CancelOwnOrder;
use App\Modules\Orders\Application\Contracts\OrderLineReviews;
use App\Modules\Orders\Application\Services\ReturnPolicy;
use App\Modules\Orders\Domain\OrderPaymentMethod;
use App\Modules\Orders\Domain\OrderStatus;
use App\Modules\Orders\Domain\PaymentStatus;
use App\Modules\Orders\Domain\ShipmentStatus;
use App\Modules\Orders\Infrastructure\Models\CodRemittance;
use App\Modules\Orders\Infrastructure\Models\CodRemittanceLine;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Orders\Infrastructure\Models\OrderLine;
use App\Modules\Orders\Infrastructure\Models\OrderPromotion;
use App\Modules\Orders\Infrastructure\Models\OrderStatusChange;
use App\Modules\Orders\Infrastructure\Models\Shipment;
use App\Modules\Orders\Infrastructure\Models\ShipmentEvent;
use App\Modules\Payments\Application\Contracts\PaymentLedger;
use App\Modules\Payments\Domain\PaymentSource;
use App\Modules\Sales\Domain\TaxMode;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Shared\Domain\ValueObjects\Money;
use App\Modules\Shipping\Application\Contracts\CourierDirectory;
use App\Modules\Users\Application\Contracts\UserDirectory;

/**
 * Shapes web orders for the storefront (confirmation / status page) and for staff.
 */
class OrderPresenter
{
    public function __construct(
        private readonly CheckoutPaymentMethods $paymentMethods,
        private readonly PaymentLedger $payments,
        private readonly UserDirectory $users,
        private readonly CustomerDirectory $customers,
        private readonly OrderLineReviews $reviews,
        private readonly CourierDirectory $couriers,
        private readonly ReturnPolicy $returnPolicy,
        private readonly ReturnPresenter $returns,
    ) {}

    /**
     * What the shopper sees.
     *
     * @return array<string, mixed>
     */
    public function storefront(Order $order): array
    {
        $order->loadMissing(['lines', 'shippingAddress', 'history', 'promotions', 'shipment']);
        $address = $order->shippingAddress;

        return [
            'number' => $order->number,
            'status' => $order->status->value,
            'status_label' => $order->status->label(),
            'payment_status' => $order->payment_status->value,
            'payment_method' => $order->payment_method->value,
            'payment_method_label' => $this->methodLabel($order->payment_method),
            'payment_instructions' => $this->instructions($order),
            'placed_at' => $order->placed_at->toIso8601String(),
            'expires_at' => $order->expires_at?->toIso8601String(),
            'contact' => ['name' => $order->contact_name, 'email' => $order->contact_email, 'phone' => $order->contact_phone],
            'shipping_address' => $address === null ? null : [
                'recipient_name' => $address->recipient_name,
                'phone' => $address->phone,
                'division' => $address->division_name,
                'district' => $address->district_name,
                'area' => $address->area,
                'address_line' => $address->address_line,
                'postcode' => $address->postcode,
            ],
            'shipping_method_name' => $order->shipping_method_name,
            'eta_min_days' => $order->eta_min_days,
            'eta_max_days' => $order->eta_max_days,
            'lines' => $order->lines->map(fn (OrderLine $l) => [
                'product_name' => $l->product_name,
                'variant_name' => $l->variant_name,
                'sku' => $l->sku,
                'image_url' => $l->image_url,
                'quantity' => self::quantity((string) $l->quantity),
                'unit_price' => (string) $l->unit_price,
                // Quantity × unit price (as in the cart), so the lines add up to the subtotal.
                'line_total' => (string) $l->line_subtotal,
                // Product discount + share of the order discount (E8b).
                'discount_amount' => (string) $l->discount_amount,
                'product_url' => $l->product_slug === null ? null : '/product/'.$l->product_slug,
            ])->values()->all(),
            'subtotal' => (string) $order->subtotal,
            'discount_total' => (string) $order->discount_total,
            'tax_total' => (string) $order->tax_total,
            'shipping_total' => (string) $order->shipping_total,
            'shipping_discount' => (string) $order->shipping_discount,
            'promotions' => $order->promotions->map(fn (OrderPromotion $p) => [
                'name' => $p->name,
                'kind' => $p->kind,
                'amount' => (string) $p->amount,
            ])->values()->all(),
            'coupon_code' => $order->coupon_code,
            'cod_fee' => (string) $order->cod_fee,
            'total' => (string) $order->total,
            'currency' => $order->currency,
            'prices_include_tax' => $order->tax_mode === TaxMode::Inclusive,
            'courier_name' => $order->courier_name,
            'tracking_number' => $order->tracking_number,
            // E10a: the courier's parcel tracking link (null without a courier template or number).
            'tracking_url' => $this->trackingUrl($order),
            'history' => $order->history->map(fn (OrderStatusChange $h) => [
                'status' => $h->to_status->value,
                'label' => $h->to_status->label(),
                'at' => $h->created_at->toIso8601String(),
            ])->values()->all(),
        ];
    }

    /**
     * The customer's own order in the account area (E9): the storefront view plus
     * `can_cancel`, the cancellation reason, and per line `product_id`, `variant_id`, the
     * customer's `review` of the product (`{id, rating, status}` or null) and `reviewable`
     * (delivered and not reviewed yet).
     *
     * E10b: per line `id` (the order line id returns refer to) and `returnable_quantity`;
     * `returnable` (a return can be requested now), `return_deadline` (ISO; null before
     * delivery or with returns off), `return_unavailable_reason` (null | not_delivered |
     * not_paid | returns_disabled | window_closed | nothing_left), `payment_status_label`,
     * `refunded_total` and `returns` (ReturnPresenter::customer of each, oldest first).
     *
     * @return array<string, mixed>
     */
    public function account(Order $order, string $customerId): array
    {
        $view = $this->storefront($order);
        $lines = $order->lines->values();
        $reviews = $this->reviews->ofCustomer($customerId, array_values(array_unique($lines->pluck('product_id')->all())));
        $delivered = $order->status === OrderStatus::Delivered;
        $blocker = $this->returnPolicy->blocker($order);
        $returnable = $this->returnPolicy->returnable($order);
        $returns = $order->returns()->with(['order', 'lines.orderLine'])->get();
        if ($blocker === null && array_filter($returnable, fn (string $q) => Decimal::compare($q, '0') > 0) === []) {
            $blocker = 'nothing_left';
        }

        foreach ($view['lines'] as $i => $line) {
            /** @var OrderLine $source */
            $source = $lines[$i];
            $review = $reviews[$source->product_id] ?? null;
            $view['lines'][$i] = ['id' => $source->id, 'product_id' => $source->product_id, 'variant_id' => $source->variant_id] + $line + [
                'review' => $review,
                'reviewable' => $delivered && $review === null,
                'returnable_quantity' => self::quantity($blocker === null || $blocker === 'nothing_left' ? $returnable[$source->id] ?? '0' : '0'),
            ];
        }

        return $view + [
            'can_cancel' => CancelOwnOrder::allowed($order),
            'cancelled_at' => $order->cancelled_at?->toIso8601String(),
            'cancel_reason' => $order->cancel_reason,
            'payment_status_label' => $order->payment_status->label(),
            'refunded_total' => (string) $order->refunded_total,
            'returnable' => $blocker === null,
            'return_deadline' => $this->returnPolicy->deadline($order)?->toIso8601String(),
            'return_unavailable_reason' => $blocker,
            'returns' => $returns->map(fn ($r) => $this->returns->customer($r))->values()->all(),
        ];
    }

    /**
     * A row of the customer's order history (E9). Expects `lines` and `lines_sum_quantity`.
     *
     * @return array<string, mixed>
     */
    public function accountRow(Order $order): array
    {
        /** @var OrderLine|null $first */
        $first = $order->lines->sortBy('position')->first();

        return [
            'number' => $order->number,
            'placed_at' => $order->placed_at->toIso8601String(),
            'status' => $order->status->value,
            'status_label' => $order->status->label(),
            'payment_status' => $order->payment_status->value,
            'payment_method_label' => $this->methodLabel($order->payment_method),
            'item_count' => self::quantity(Decimal::round((string) ($order->getAttribute('lines_sum_quantity') ?? '0'), 3)),
            'total' => (string) $order->total,
            'currency' => $order->currency,
            'first_item' => $first === null ? null : ['name' => $first->product_name, 'image_url' => $first->image_url],
        ];
    }

    /**
     * customer | staff | system (rows from before E9 without the column: derived).
     */
    private static function actorType(OrderStatusChange $h): string
    {
        return $h->actor_type ?? ($h->actor_user_id !== null ? 'staff' : ($h->from_status === null ? 'customer' : 'system'));
    }

    /**
     * The full order for staff: everything the shopper sees plus customer, client details,
     * notes, cancellation, history with actors, ledger payments and the allowed actions.
     *
     * @return array<string, mixed>
     */
    public function staff(Order $order, bool $canManage, bool $canRefund = false): array
    {
        $view = $this->storefront($order);
        $returns = $order->returns()->get();
        $payments = $this->payments->entriesOf(PaymentSource::ONLINE_ORDER, $order->id);
        foreach ($returns as $return) {
            array_push($payments, ...$this->payments->entriesOf(PaymentSource::ONLINE_ORDER_REFUND, $return->id));
        }
        // E11: the refund of a paid order that was cancelled.
        array_push($payments, ...$this->payments->entriesOf(PaymentSource::ONLINE_ORDER_REFUND, $order->id));
        $returnable = $this->returnPolicy->returnable($order);
        foreach ($view['lines'] as $i => $line) {
            $source = $order->lines->values()[$i];
            $view['lines'][$i] = ['id' => $source->id] + $line + ['returnable_quantity' => self::quantity($returnable[$source->id] ?? '0')];
        }
        $deadline = $this->returnPolicy->deadline($order);
        $shipment = $order->shipment;
        $shipment?->loadMissing('events');
        $actorIds = array_values(array_filter([
            ...$order->history->pluck('actor_user_id')->all(),
            ...array_column($payments, 'created_by'),
            $order->cancelled_by,
            ...($shipment?->events->pluck('created_by')->all() ?? []),
        ]));
        $names = $this->users->names($order->organization_id, $actorIds);
        $customer = $order->customer_id === null ? null : ($this->customers->summaries($order->organization_id, [$order->customer_id])[$order->customer_id] ?? null);

        $view['history'] = $order->history->map(fn (OrderStatusChange $h) => [
            'from_status' => $h->from_status?->value,
            'status' => $h->to_status->value,
            'label' => $h->to_status->label(),
            'note' => $h->note,
            'at' => $h->created_at->toIso8601String(),
            'actor_type' => self::actorType($h),
            'actor' => $h->actor_user_id === null ? null : ['id' => $h->actor_user_id, 'name' => $names[$h->actor_user_id] ?? null],
        ])->values()->all();

        return ['id' => $order->id] + $view + [
            'payment_status_label' => $order->payment_status->label(),
            'paid_total' => (string) $order->paid_total,
            // E10b: refunds booked on returns, the return window and the order's returns.
            'refunded_total' => (string) $order->refunded_total,
            'return_deadline' => $deadline?->toIso8601String(),
            'return_window_open' => $this->returnPolicy->blocker($order) === null,
            'returns' => ReturnPresenter::summaries($returns),
            'customer' => $customer === null ? null : ['id' => $customer['id'], 'name' => $customer['name'], 'code' => $customer['code']],
            'customer_account_id' => $order->customer_account_id,
            'ip' => $order->ip,
            'user_agent' => $order->user_agent,
            'notes' => $order->notes,
            'cancelled_at' => $order->cancelled_at?->toIso8601String(),
            'cancelled_by' => $order->cancelled_by === null ? null : ['id' => $order->cancelled_by, 'name' => $names[$order->cancelled_by] ?? null],
            'cancel_reason' => $order->cancel_reason,
            'confirmed_at' => $order->confirmed_at?->toIso8601String(),
            'shipped_at' => $order->shipped_at?->toIso8601String(),
            'delivered_at' => $order->delivered_at?->toIso8601String(),
            'payments' => array_map(fn (array $p) => [
                'method' => $p['method'],
                'method_label' => $p['method_label'],
                'direction' => $p['direction'],
                'amount' => $p['amount'],
                'reference' => $p['reference'],
                'recorded_at' => $p['created_at'],
                'recorded_by' => $p['created_by'] === null ? null : ['id' => $p['created_by'], 'name' => $names[$p['created_by']] ?? null],
            ], $payments),
            // E10a: the courier parcel (null before shipping and for orders shipped before E10a).
            'shipment' => $shipment === null ? null : [
                'id' => $shipment->id,
                'courier' => $shipment->courier_id === null ? null : ['id' => $shipment->courier_id, 'name' => $shipment->courier_name],
                'courier_name' => $shipment->courier_name,
                'tracking_number' => $shipment->tracking_number,
                'tracking_url' => $view['tracking_url'],
                'status' => $shipment->status->value,
                'status_label' => $shipment->status->label(),
                'cod_amount' => (string) $shipment->cod_amount,
                'shipped_at' => $shipment->shipped_at->toIso8601String(),
                'delivered_at' => $shipment->delivered_at?->toIso8601String(),
                'returned_at' => $shipment->returned_at?->toIso8601String(),
                'events' => $shipment->events->map(fn (ShipmentEvent $e) => [
                    'id' => $e->id,
                    'status' => $e->status->value,
                    'status_label' => $e->status->label(),
                    'note' => $e->note,
                    'occurred_at' => $e->occurred_at->toIso8601String(),
                    'recorded_at' => $e->created_at->toIso8601String(),
                    'recorded_by' => $e->created_by === null ? null : ['id' => $e->created_by, 'name' => $names[$e->created_by] ?? null],
                ])->values()->all(),
            ],
            'cod_remittance' => $this->remittanceOf($order),
            // E11: what cancelling would refund (paid orders that can still be cancelled), else null.
            'cancel_refund_amount' => CancelOrder::cancellableWithRefund($order)
                ? Money::of((string) $order->paid_total, $order->currency)->minus(Money::of((string) $order->refunded_total, $order->currency))->amount()
                : null,
            'allowed_actions' => [
                ...($canManage ? self::allowedActions($order, $canRefund) : []),
                // E11: cancelling a paid order with a refund needs web_orders.refund only.
                ...(! $canManage && $canRefund && CancelOrder::cancellableWithRefund($order) ? ['cancel'] : []),
                // E10b: a return can be created (after the window only with override_window).
                ...($canRefund && $this->returnPolicy->blocker($order, ignoreWindow: true) === null && $this->returnPolicy->anythingLeft($order) ? ['create_return'] : []),
            ],
        ];
    }

    /**
     * An order as printed (E10a): `packing_slip` (no prices) or `invoice` (prices, discounts,
     * tax, totals). Read-only.
     *
     * @return array<string, mixed>
     */
    public function printable(Order $order, string $kind): array
    {
        $view = $this->storefront($order);
        $invoice = $kind === 'invoice';
        $lines = $order->lines->values();

        $printed = [
            'id' => $order->id,
            'number' => $order->number,
            'placed_at' => $view['placed_at'],
            'status' => $view['status'],
            'status_label' => $view['status_label'],
            'contact' => $view['contact'],
            'shipping_address' => $view['shipping_address'],
            'payment_method' => $view['payment_method'],
            'payment_method_label' => $view['payment_method_label'],
            'payment_status' => $view['payment_status'],
            'payment_status_label' => $order->payment_status->label(),
            'shipping_method_name' => $view['shipping_method_name'],
            'courier_name' => $view['courier_name'],
            'tracking_number' => $view['tracking_number'],
            'tracking_url' => $view['tracking_url'],
            'notes' => $order->notes,
            'item_count' => self::quantity((string) $lines->reduce(fn (string $sum, OrderLine $l) => Decimal::add($sum, (string) $l->quantity, 3), '0')),
            'lines' => $lines->map(function (OrderLine $l) use ($invoice) {
                $line = [
                    'product_name' => $l->product_name,
                    'variant_name' => $l->variant_name,
                    'sku' => $l->sku,
                    'quantity' => self::quantity((string) $l->quantity),
                ];

                return $invoice ? $line + [
                    'unit_price' => (string) $l->unit_price,
                    'line_subtotal' => (string) $l->line_subtotal,
                    'discount_amount' => (string) $l->discount_amount,
                    'tax_rate' => Decimal::round((string) $l->tax_rate, 2),
                    'tax_amount' => (string) $l->tax_amount,
                    'line_total' => (string) $l->line_total,
                ] : $line;
            })->all(),
        ];

        if (! $invoice) {
            return $printed;
        }

        return $printed + [
            'currency' => $view['currency'],
            'prices_include_tax' => $view['prices_include_tax'],
            'subtotal' => $view['subtotal'],
            'discount_total' => $view['discount_total'],
            'tax_total' => $view['tax_total'],
            'shipping_total' => $view['shipping_total'],
            'shipping_discount' => $view['shipping_discount'],
            'cod_fee' => $view['cod_fee'],
            'promotions' => $view['promotions'],
            'coupon_code' => $view['coupon_code'],
            'total' => $view['total'],
            'paid_total' => (string) $order->paid_total,
            'balance_due' => Decimal::sub((string) $order->total, (string) $order->paid_total, 2),
        ];
    }

    /**
     * The tracking link of the order's shipment: the courier's template with the url-encoded
     * tracking number; null without a shipment, template or number.
     */
    public function trackingUrl(Order $order): ?string
    {
        $shipment = $order->shipment;
        if ($shipment === null || $shipment->courier_id === null || $shipment->tracking_number === null) {
            return null;
        }
        $courier = $this->couriers->find($shipment->courier_id);

        return $this->couriers->trackingUrl($courier['tracking_url_template'] ?? null, $shipment->tracking_number);
    }

    /**
     * @return array{id: string, number: string, received_at: string}|null
     */
    private function remittanceOf(Order $order): ?array
    {
        $remittanceId = CodRemittanceLine::query()->where('order_id', $order->id)->value('remittance_id');
        /** @var CodRemittance|null $remittance */
        $remittance = $remittanceId === null ? null : CodRemittance::query()->find($remittanceId);

        return $remittance === null ? null : ['id' => $remittance->id, 'number' => $remittance->number, 'received_at' => $remittance->received_at->toDateString()];
    }

    /**
     * @return array<string, mixed>
     */
    public static function row(Order $order, string $itemCount): array
    {
        return [
            'id' => $order->id,
            'number' => $order->number,
            'placed_at' => $order->placed_at->toIso8601String(),
            'status' => $order->status->value,
            'status_label' => $order->status->label(),
            'payment_status' => $order->payment_status->value,
            'payment_method' => $order->payment_method->value,
            'contact_name' => $order->contact_name,
            'contact_phone' => $order->contact_phone,
            'total' => (string) $order->total,
            'currency' => $order->currency,
            'item_count' => self::quantity($itemCount),
            // E10a board columns (expects `shippingAddress` and `shipment` loaded).
            'district' => $order->shippingAddress?->district_name,
            'courier_name' => $order->courier_name,
            'tracking_number' => $order->tracking_number,
            'shipment_status' => $order->shipment?->status->value,
            'delivered_at' => $order->delivered_at?->toIso8601String(),
        ];
    }

    /**
     * @return list<string>
     */
    public static function allowedActions(Order $order, bool $canRefund = false): array
    {
        $unpaid = $order->payment_status === PaymentStatus::Unpaid;
        $cod = $order->payment_method === OrderPaymentMethod::CashOnDelivery;
        $shipped = $order->status === OrderStatus::Shipped;
        /** @var Shipment|null $shipment */
        $shipment = $order->shipment;
        $returned = $shipped && $shipment?->status === ShipmentStatus::Returned;

        return array_keys(array_filter([
            'confirm_payment' => $unpaid && ! $cod && $order->status === OrderStatus::PendingPayment,
            'process' => $order->status === OrderStatus::Confirmed,
            'ship' => $order->status === OrderStatus::Processing,
            'deliver' => $shipped && ! $returned,
            // E10a: courier updates (in transit, delivered, returned) on the order's shipment.
            'add_shipment_event' => $shipped && $shipment !== null && ! $shipment->status->isFinal(),
            'record_cod_payment' => $unpaid && $cod && ! $returned && in_array($order->status, [OrderStatus::Shipped, OrderStatus::Delivered], true),
            // E10a: a parcel returned to the sender lets the unpaid shipped order be cancelled.
            'cancel' => ($unpaid && ($order->status->canBecome(OrderStatus::Cancelled) || $returned))
                // E11: paid orders that are not delivered are cancelled with a refund (web_orders.refund).
                || ($canRefund && CancelOrder::cancellableWithRefund($order)),
        ]));
    }

    private function instructions(Order $order): ?string
    {
        if ($order->payment_method !== OrderPaymentMethod::BankTransfer || $order->status !== OrderStatus::PendingPayment) {
            return null;
        }
        foreach ($this->paymentMethods->all() as $method) {
            if ($method['code'] === $order->payment_method->value) {
                return $method['instructions'];
            }
        }

        return null;
    }

    private function methodLabel(OrderPaymentMethod $method): string
    {
        foreach ($this->paymentMethods->all() as $config) {
            if ($config['code'] === $method->value) {
                return $config['display_name'];
            }
        }

        return $method->label();
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
