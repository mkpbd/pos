<?php

namespace App\Modules\Orders\Presentation\Http\Support;

use App\Modules\Customers\Application\Contracts\CustomerDirectory;
use App\Modules\OnlinePayments\Application\Contracts\CheckoutPaymentMethods;
use App\Modules\Orders\Application\Actions\CancelOwnOrder;
use App\Modules\Orders\Application\Contracts\OrderLineReviews;
use App\Modules\Orders\Domain\OrderPaymentMethod;
use App\Modules\Orders\Domain\OrderStatus;
use App\Modules\Orders\Domain\PaymentStatus;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Orders\Infrastructure\Models\OrderLine;
use App\Modules\Orders\Infrastructure\Models\OrderPromotion;
use App\Modules\Orders\Infrastructure\Models\OrderStatusChange;
use App\Modules\Payments\Application\Contracts\PaymentLedger;
use App\Modules\Payments\Domain\PaymentSource;
use App\Modules\Sales\Domain\TaxMode;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
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
    ) {}

    /**
     * What the shopper sees.
     *
     * @return array<string, mixed>
     */
    public function storefront(Order $order): array
    {
        $order->loadMissing(['lines', 'shippingAddress', 'history', 'promotions']);
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
     * @return array<string, mixed>
     */
    public function account(Order $order, string $customerId): array
    {
        $view = $this->storefront($order);
        $lines = $order->lines->values();
        $reviews = $this->reviews->ofCustomer($customerId, array_values(array_unique($lines->pluck('product_id')->all())));
        $delivered = $order->status === OrderStatus::Delivered;

        foreach ($view['lines'] as $i => $line) {
            /** @var OrderLine $source */
            $source = $lines[$i];
            $review = $reviews[$source->product_id] ?? null;
            $view['lines'][$i] = ['product_id' => $source->product_id, 'variant_id' => $source->variant_id] + $line + [
                'review' => $review,
                'reviewable' => $delivered && $review === null,
            ];
        }

        return $view + [
            'can_cancel' => CancelOwnOrder::allowed($order),
            'cancelled_at' => $order->cancelled_at?->toIso8601String(),
            'cancel_reason' => $order->cancel_reason,
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
    public function staff(Order $order, bool $canManage): array
    {
        $view = $this->storefront($order);
        $payments = $this->payments->entriesOf(PaymentSource::ONLINE_ORDER, $order->id);
        $actorIds = array_values(array_filter([
            ...$order->history->pluck('actor_user_id')->all(),
            ...array_column($payments, 'created_by'),
            $order->cancelled_by,
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
            'allowed_actions' => $canManage ? self::allowedActions($order) : [],
        ];
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
        ];
    }

    /**
     * @return list<string>
     */
    public static function allowedActions(Order $order): array
    {
        $unpaid = $order->payment_status === PaymentStatus::Unpaid;
        $cod = $order->payment_method === OrderPaymentMethod::CashOnDelivery;

        return array_keys(array_filter([
            'confirm_payment' => $unpaid && ! $cod && $order->status === OrderStatus::PendingPayment,
            'process' => $order->status === OrderStatus::Confirmed,
            'ship' => $order->status === OrderStatus::Processing,
            'deliver' => $order->status === OrderStatus::Shipped,
            'record_cod_payment' => $unpaid && $cod && in_array($order->status, [OrderStatus::Shipped, OrderStatus::Delivered], true),
            'cancel' => $unpaid && $order->status->canBecome(OrderStatus::Cancelled),
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
