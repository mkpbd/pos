<?php

namespace App\Modules\Orders\Application\Actions;

use App\Modules\Orders\Application\Services\StaffOrderPricing;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Storefront\Application\Queries\StorefrontConfig;
use Illuminate\Validation\ValidationException;

/**
 * BD1b: an order staff took by phone, Facebook, WhatsApp… for an existing customer (the
 * order shows in their online account when they have one) or as a guest order. Placed by
 * PlaceOrder::staff() — the checkout's transaction, pricing (with the coupon), promotion
 * locks, stock, numbering, payment and notifications (confirmation e-mail when an e-mail is
 * given, order SMS, new-order notification); cash on delivery starts `confirmed`, bank
 * transfer `pending_payment`. Audited `web_order.created`.
 */
class PlaceStaffOrder
{
    public function __construct(
        private readonly StaffOrderPricing $pricing,
        private readonly PlaceOrder $place,
        private readonly StorefrontConfig $storefront,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  array<string, mixed>  $data  validated body (contact, lines, address, shipping_method_id, payment_method, channel, coupon_code?, customer_id?, notes?, locale?, expected_total)
     *
     * @throws BusinessRuleViolation|ValidationException
     */
    public function __invoke(array $data, string $actorId): Order
    {
        $customer = $this->pricing->customer($data['customer_id'] ?? null);
        $lines = array_map(fn (array $l) => ['variant_id' => strtolower((string) $l['variant_id']), 'quantity' => (string) $l['quantity']], array_values($data['lines']));
        $this->pricing->assertWholeQuantities($lines);
        $locale = $this->pricing->locale($data['locale'] ?? null);
        $siteUrl = $this->storefront->primaryUrl() ?? rtrim((string) config('app.url'), '/');

        try {
            $placed = $this->place->staff($lines, $customer, [
                'contact' => $data['contact'],
                'address' => $data['address'],
                'shipping_method_id' => $data['shipping_method_id'],
                'payment_method' => $data['payment_method'],
                'coupon_code' => StaffOrderPricing::coupon($data['coupon_code'] ?? null),
                'notes' => $data['notes'] ?? null,
                'expected_total' => $data['expected_total'],
                'channel' => $data['channel'],
                'locale' => $locale,
            ], $actorId, $siteUrl);
        } catch (BusinessRuleViolation $e) {
            // TOTAL_CHANGED / ITEMS_UNAVAILABLE: the preview as the staff quote shows it.
            throw $this->pricing->withStaffPreview($e);
        }
        $order = $placed['order'];

        $this->audit->record('web_order.created', $order, [], [
            'number' => $order->number,
            'source' => Order::SOURCE_STAFF,
            'channel' => $order->channel,
            'status' => $order->status->value,
            'payment_method' => $order->payment_method->value,
            'total' => (string) $order->total,
            'customer_id' => $order->customer_id,
        ]);

        return $order;
    }
}
