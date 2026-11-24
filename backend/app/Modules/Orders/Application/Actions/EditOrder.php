<?php

namespace App\Modules\Orders\Application\Actions;

use App\Modules\Geography\Application\Contracts\GeoDirectory;
use App\Modules\Inventory\Application\Contracts\StockLedger;
use App\Modules\Inventory\Domain\MovementType;
use App\Modules\Inventory\Domain\StockChange;
use App\Modules\Inventory\Domain\StockReference;
use App\Modules\OnlinePayments\Application\Contracts\CheckoutPaymentMethods;
use App\Modules\Orders\Application\Services\OrderEditability;
use App\Modules\Orders\Application\Services\StaffOrderPricing;
use App\Modules\Orders\Domain\OrderPaymentMethod;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Orders\Infrastructure\Models\OrderAddress;
use App\Modules\Orders\Infrastructure\Models\OrderEdit;
use App\Modules\Orders\Infrastructure\Models\OrderLine;
use App\Modules\Orders\Infrastructure\Models\OrderLineStock;
use App\Modules\Orders\Infrastructure\Models\OrderPromotion;
use App\Modules\Orders\Infrastructure\Models\OrderStatusChange;
use App\Modules\Products\Application\Contracts\ProductDirectory;
use App\Modules\Promotions\Application\Contracts\PromotionRedemptions;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Localization\LocaleContext;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Shared\Domain\ValueObjects\Money;
use App\Modules\Shipping\Domain\ShippingFee;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * BD1b: staff change an order before it ships — lines, contact, delivery address and method,
 * coupon and note (the payment method stays). Only unpaid orders awaiting confirmation or
 * payment, confirmed or processing, without a shipment (else 422 ORDER_NOT_EDITABLE).
 *
 * One transaction, the order row locked first: the lines are repriced on the checkout's one
 * pricing path with current prices and promotions (StaffOrderPricing: the order's own stock
 * counts as available, its own promotion uses do not count against limits; limited
 * promotions and the coupon are locked and the order priced again, as at placement) → 409
 * TOTAL_CHANGED when the total differs from `expected_total`. When the lines' variants or
 * quantities change, the stock the order took goes back to its exact batches at its exact
 * cost (movement `online_order_cancel`, reference `online_order_edit`) and the new lines take
 * stock FEFO, never below zero (`online_order`, reference `online_order_edit`). When the
 * promotions change, the old redemptions are released and the new ones recorded. The content
 * snapshots are replaced (deleting `order_lines`, `order_line_stock` and `order_promotions`
 * rows is allowed only inside the edit: `SET LOCAL pos.order_edit`), the header amounts,
 * contact, delivery method, coupon and note are replaced (Order::revising), the address is
 * replaced and `revision` + 1. An `order_edits` row keeps before/after, the status history
 * gets a row (`from = to`, "Order changed (revision N)") and the change is audited
 * (`web_order.edited`). The status does not change: no OrderStatusChanged, no text message.
 */
class EditOrder
{
    public function __construct(
        private readonly StaffOrderPricing $pricing,
        private readonly StockLedger $stock,
        private readonly PromotionRedemptions $redemptions,
        private readonly CheckoutPaymentMethods $payments,
        private readonly GeoDirectory $geo,
        private readonly ProductDirectory $products,
        private readonly AuditTrail $audit,
        private readonly LocaleContext $locale,
    ) {}

    /**
     * @param  array<string, mixed>  $data  validated body: contact, lines, address, shipping_method_id, coupon_code?, notes?, expected_total, reason?
     *
     * @throws BusinessRuleViolation|ValidationException
     */
    public function __invoke(Order $order, array $data, string $actorId): Order
    {
        // Snapshots (product, delivery method and promotion names) in the base language, as at placement.
        return $this->locale->runAs(LocaleContext::BASE, fn () => DB::transaction(fn () => $this->edit($order, $data, $actorId)));
    }

    /**
     * @param  array<string, mixed>  $data
     */
    private function edit(Order $order, array $data, string $actorId): Order
    {
        /** @var Order $locked */
        $locked = Order::query()->whereKey($order->id)->lockForUpdate()->firstOrFail();
        OrderEditability::assertEditable($locked);
        $locked->load(['lines.stock', 'shippingAddress', 'promotions']);
        $before = self::snapshot($locked);

        $lines = array_map(fn (array $l) => ['variant_id' => strtolower((string) $l['variant_id']), 'quantity' => (string) $l['quantity']], array_values($data['lines']));
        $this->pricing->assertWholeQuantities($lines);
        $coupon = array_key_exists('coupon_code', $data) ? StaffOrderPricing::coupon($data['coupon_code']) : $locked->coupon_code;
        $input = [
            'contact' => $data['contact'],
            'address' => ['district_id' => (int) $data['address']['district_id']],
            'shipping_method_id' => $data['shipping_method_id'],
            'payment_method' => $locked->payment_method->value,
        ];
        $quote = $this->priceUnderPromotionLocks(fn () => $this->pricing->price($locked, $lines, $input, $locked->customer_id, $coupon));
        $preview = $quote['preview'];
        if ($preview['issues'] !== [] || count($quote['lines']) !== count($lines)) {
            throw new BusinessRuleViolation('ITEMS_UNAVAILABLE', 'Some products are not available in the quantity you chose right now.', [
                'issues' => $preview['issues'],
                'preview' => $this->pricing->present($preview),
            ]);
        }
        $address = $this->address($data['address']);
        if ($quote['method'] === null) {
            throw new BusinessRuleViolation('SHIPPING_UNAVAILABLE', 'We do not deliver to this district with the chosen delivery method. Choose another delivery method or address.', [
                'district_id' => $address['district_id'],
                'shipping_method_id' => $data['shipping_method_id'],
                'available_methods' => array_column($preview['shipping_methods'], 'id'),
            ]);
        }
        $method = $quote['method'];
        $currency = $locked->currency;
        $codFee = $locked->payment_method === OrderPaymentMethod::CashOnDelivery
            ? Money::of(ShippingFee::cashOnDelivery($method['cod_allowed'], $method['cod_fee'], true), $currency)
            : Money::zero($currency);
        $total = Money::of($quote['goods_total'], $currency)->plus(Money::of($preview['shipping_total'], $currency))->plus($codFee);
        // Cash on delivery must still be possible with the chosen delivery method and the new total.
        if ($locked->payment_method === OrderPaymentMethod::CashOnDelivery) {
            $this->payments->usable($locked->payment_method->value, $total->amount(), $method['cod_allowed']);
        }
        if (Decimal::compare(Decimal::round((string) $data['expected_total'], 2), $total->amount()) !== 0) {
            throw new BusinessRuleViolation('TOTAL_CHANGED', "The order total changed to {$total->amount()} {$currency}. Please check the order and confirm again.", [
                'expected_total' => Decimal::round((string) $data['expected_total'], 2),
                'total' => $total->amount(),
                'preview' => $this->pricing->present($preview),
            ], 409);
        }

        $costs = $this->replaceLines($locked, $quote['lines']);
        $this->replacePromotions($locked, $quote['redemptions'], $quote['coupon_code'], $data['contact']);

        $revision = $locked->revision + 1;
        $contact = $data['contact'];
        Order::revising(fn () => $locked->update([
            'shipping_method_id' => $method['id'],
            'shipping_method_name' => $method['name'],
            'eta_min_days' => $method['eta_min_days'],
            'eta_max_days' => $method['eta_max_days'],
            'subtotal' => $preview['subtotal'],
            'discount_total' => $preview['discount_total'],
            'tax_total' => $preview['tax_total'],
            'shipping_total' => $preview['shipping_total'],
            'shipping_discount' => $quote['shipping_discount'],
            'coupon_code' => $quote['coupon_code'],
            'cod_fee' => $codFee->amount(),
            'total' => $total->amount(),
            'cost_total' => $costs,
            'contact_name' => $contact['name'],
            'contact_email' => $contact['email'] ?? null,
            'contact_phone' => $contact['phone'],
            'notes' => array_key_exists('notes', $data) ? $data['notes'] : $locked->notes,
            'revision' => $revision,
        ]));
        $shipping = $locked->shippingAddress ?? new OrderAddress(['organization_id' => $locked->organization_id, 'order_id' => $locked->id, 'kind' => 'shipping', 'created_at' => now()]);
        $shipping->fill($address + ['email' => $contact['email'] ?? null])->save();

        $locked->unsetRelations();
        $after = self::snapshot($locked);
        $now = now();
        $reason = isset($data['reason']) && is_string($data['reason']) && trim($data['reason']) !== '' ? trim($data['reason']) : null;
        OrderEdit::query()->create([
            'organization_id' => $locked->organization_id,
            'order_id' => $locked->id,
            'revision' => $revision,
            'reason' => $reason,
            'before' => $before,
            'after' => $after,
            'actor_user_id' => $actorId,
            'created_at' => $now,
        ]);
        OrderStatusChange::query()->create([
            'organization_id' => $locked->organization_id,
            'order_id' => $locked->id,
            'from_status' => $locked->status,
            'to_status' => $locked->status,
            'note' => "Order changed (revision {$revision})",
            'actor_user_id' => $actorId,
            'actor_type' => 'staff',
            'created_at' => $now,
        ]);
        $this->audit->record('web_order.edited', $locked,
            ['revision' => $revision - 1, 'total' => $before['totals']['total'], 'lines' => self::lineSummary($before['lines'])],
            ['revision' => $revision, 'number' => $locked->number, 'total' => $after['totals']['total'], 'lines' => self::lineSummary($after['lines']), 'reason' => $reason],
        );

        return $locked;
    }

    /**
     * Rewrites the line snapshots when anything about them changed. The stock moves only when
     * the variants or quantities changed; otherwise the new lines keep the old allocations.
     * Returns the order's cost total.
     *
     * @param  list<array<string, mixed>>  $quoted  CheckoutQuoter lines
     */
    private function replaceLines(Order $order, array $quoted): string
    {
        $old = $order->lines->values();
        $sameStock = count($quoted) === $old->count();
        $sameLines = $sameStock;
        foreach ($quoted as $i => $line) {
            $current = $old[$i] ?? null;
            if ($current === null || $current->variant_id !== $line['variant_id'] || Decimal::compare((string) $current->quantity, $line['quantity']) !== 0) {
                $sameStock = $sameLines = false;
                break;
            }
            foreach (['unit_price', 'line_subtotal', 'discount_amount', 'net_amount', 'tax_amount', 'line_total'] as $amount) {
                if (Decimal::compare((string) $current->{$amount}, (string) $line[$amount]) !== 0) {
                    $sameLines = false;
                }
            }
            if (Decimal::compare((string) $current->tax_rate, (string) $line['tax_rate']) !== 0) {
                $sameLines = false;
            }
        }
        if ($sameLines) {
            return (string) $order->cost_total;
        }

        $currency = $order->currency;
        $allocations = [];
        $costs = [];
        if ($sameStock) {
            foreach ($old as $i => $line) {
                $allocations[$i] = $line->stock->map(fn (OrderLineStock $s) => [
                    'batch_id' => $s->batch_id, 'quantity' => (string) $s->quantity, 'unit_cost' => (string) $s->unit_cost, 'movement_id' => $s->movement_id,
                ])->all();
                $costs[$i] = ['unit_cost' => (string) $line->unit_cost, 'cost_total' => Money::of((string) $line->cost_total, $currency)];
            }
        } else {
            $reference = new StockReference('online_order_edit', $order->id, $order->number);
            $returns = [];
            foreach ($old as $line) {
                foreach ($line->stock as $allocation) {
                    $returns[] = new StockChange($order->store_id, $line->variant_id, $allocation->batch_id, MovementType::OnlineOrderCancel, (string) $allocation->quantity, (string) $allocation->unit_cost);
                }
            }
            if ($returns !== []) {
                $this->stock->post($returns, $reference);
            }
            $changes = [];
            foreach ($quoted as $i => $line) {
                $changes[] = new StockChange($order->store_id, $line['variant_id'], null, MovementType::OnlineOrder, $line['quantity'], allocateBatches: true);
            }
            $posted = $this->stock->post($changes, $reference);
            $variants = $this->products->variants($order->organization_id, array_column($quoted, 'variant_id'));
            foreach ($quoted as $i => $line) {
                $unitCost = $posted[$i] !== null ? $posted[$i]['unit_cost'] : Decimal::round((string) ($variants[$line['variant_id']]['purchase_price'] ?? '0'), 4);
                $costs[$i] = ['unit_cost' => $unitCost, 'cost_total' => Money::ofProduct($line['quantity'], $unitCost, $currency)];
                $allocations[$i] = $posted[$i]['allocations'] ?? [];
            }
        }

        $this->deletingContent(function () use ($order, $old) {
            OrderLineStock::query()->whereIn('order_line_id', $old->pluck('id')->all())->delete();
            OrderLine::query()->where('order_id', $order->id)->delete();
        });

        $now = now();
        foreach ($quoted as $i => $line) {
            $orderLine = OrderLine::query()->create([
                'organization_id' => $order->organization_id,
                'order_id' => $order->id,
                'position' => $i,
                'product_id' => $line['product_id'],
                'variant_id' => $line['variant_id'],
                'product_name' => $line['product_name'],
                'variant_name' => $line['variant_name'],
                'product_slug' => $line['product_slug'],
                'sku' => $line['sku'],
                'option_values' => $line['option_values'] === [] ? null : $line['option_values'],
                'image_url' => $line['image_url'],
                'quantity' => $line['quantity'],
                'unit_price' => $line['unit_price'],
                'compare_at_price' => $line['compare_at_price'],
                'line_subtotal' => $line['line_subtotal'],
                'discount_amount' => $line['discount_amount'],
                'net_amount' => $line['net_amount'],
                'tax_rate' => $line['tax_rate'],
                'tax_amount' => $line['tax_amount'],
                'line_total' => $line['line_total'],
                'unit_cost' => $costs[$i]['unit_cost'],
                'cost_total' => $costs[$i]['cost_total']->amount(),
                'created_at' => $now,
            ]);
            foreach ($allocations[$i] as $allocation) {
                OrderLineStock::query()->create([
                    'organization_id' => $order->organization_id,
                    'order_line_id' => $orderLine->id,
                    'batch_id' => $allocation['batch_id'],
                    'quantity' => $allocation['quantity'],
                    'unit_cost' => $allocation['unit_cost'],
                    'movement_id' => $allocation['movement_id'],
                ]);
            }
        }

        return array_reduce($costs, fn (Money $sum, array $c) => $sum->plus($c['cost_total']), Money::zero($currency))->amount();
    }

    /**
     * When the order's promotions changed: the old redemptions are released, the snapshot
     * replaced and the new ones recorded (the coupon's use counted again).
     *
     * @param  list<array{promotion_id: string, coupon_id: ?string, name: string, kind: string, amount: string}>  $redemptions
     * @param  array{name: string, phone: string, email?: ?string}  $contact
     */
    private function replacePromotions(Order $order, array $redemptions, ?string $couponCode, array $contact): void
    {
        $key = fn (?string $promotionId, string $kind, string $amount) => implode('|', [$promotionId ?? '', $kind, Decimal::round($amount, 2)]);
        $current = $order->promotions->map(fn (OrderPromotion $p) => $key($p->promotion_id, $p->kind, (string) $p->amount))->sort()->values()->all();
        $next = array_map(fn (array $r) => $key($r['promotion_id'], $r['kind'], (string) $r['amount']), $redemptions);
        sort($next);
        if ($current === $next && mb_strtolower((string) $order->coupon_code) === mb_strtolower((string) $couponCode)) {
            return;
        }

        $this->redemptions->release($order->id);
        $this->deletingContent(fn () => OrderPromotion::query()->where('order_id', $order->id)->delete());
        $now = now();
        foreach ($redemptions as $redemption) {
            OrderPromotion::query()->create([
                'organization_id' => $order->organization_id,
                'order_id' => $order->id,
                'promotion_id' => $redemption['promotion_id'],
                'name' => $redemption['name'],
                'kind' => $redemption['kind'],
                'amount' => $redemption['amount'],
                'created_at' => $now,
            ]);
        }
        if ($redemptions !== []) {
            $this->redemptions->record($order->id, $order->number, $order->customer_id, $order->customer_account_id, $contact['email'] ?? null, $redemptions, $contact['phone']);
        }
    }

    /**
     * Deletes content snapshot rows: the append-only triggers allow DELETE only while
     * `pos.order_edit` is on in this transaction.
     */
    private function deletingContent(\Closure $delete): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            $delete();

            return;
        }
        DB::statement("SELECT set_config('pos.order_edit', 'on', true)");
        try {
            $delete();
        } finally {
            DB::statement("SELECT set_config('pos.order_edit', 'off', true)");
        }
    }

    /**
     * Repricing under the promotion locks, as at placement: price, lock the limited promotions
     * and the coupon the order would use, price again (at most three rounds).
     *
     * @param  callable(): array<string, mixed>  $price
     * @return array<string, mixed>
     */
    private function priceUnderPromotionLocks(callable $price): array
    {
        $quote = $price();
        $lockedPromotions = [];
        $lockedCoupons = [];
        for ($round = 0; $round < 3; $round++) {
            $promotionIds = array_values(array_diff(array_unique(array_column($quote['redemptions'], 'promotion_id')), $lockedPromotions));
            $couponIds = array_values(array_diff(array_unique(array_filter(array_column($quote['redemptions'], 'coupon_id'))), $lockedCoupons));
            if ($promotionIds === [] && $couponIds === []) {
                break;
            }
            $locked = $this->redemptions->lock($promotionIds, $couponIds[0] ?? null);
            array_push($lockedPromotions, ...$promotionIds);
            array_push($lockedCoupons, ...$couponIds);
            if (! $locked) {
                break;
            }
            $quote = $price();
        }

        return $quote;
    }

    /**
     * @param  array<string, mixed>  $address  validated inline address
     * @return array{recipient_name: string, phone: string, division_id: int, division_name: string, district_id: int, district_name: string, area: ?string, address_line: string, postcode: ?string}
     *
     * @throws ValidationException
     */
    private function address(array $address): array
    {
        $divisionId = (int) $address['division_id'];
        $districtId = (int) $address['district_id'];
        if (! $this->geo->districtInDivision($districtId, $divisionId)) {
            throw ValidationException::withMessages(['address.district_id' => ['The district is not in the selected division.']]);
        }
        $names = $this->geo->names([$divisionId], [$districtId]);

        return [
            'recipient_name' => $address['recipient_name'],
            'phone' => $address['phone'],
            'division_id' => $divisionId,
            'division_name' => $names['divisions'][$divisionId] ?? '',
            'district_id' => $districtId,
            'district_name' => $names['districts'][$districtId] ?? '',
            'area' => $address['area'] ?? null,
            'address_line' => $address['address_line'],
            'postcode' => $address['postcode'] ?? null,
        ];
    }

    /**
     * What an edit records before and after: lines, totals, contact, address, delivery method,
     * coupon and note.
     *
     * @return array<string, mixed>
     */
    public static function snapshot(Order $order): array
    {
        $address = $order->shippingAddress;

        return [
            'lines' => $order->lines->map(fn (OrderLine $l) => [
                'variant_id' => $l->variant_id,
                'name' => $l->product_name,
                'variant' => $l->variant_name,
                'sku' => $l->sku,
                'quantity' => Decimal::round((string) $l->quantity, 3),
                'unit_price' => (string) $l->unit_price,
                'line_total' => (string) $l->line_total,
            ])->values()->all(),
            'totals' => [
                'subtotal' => (string) $order->subtotal,
                'discount_total' => (string) $order->discount_total,
                'tax_total' => (string) $order->tax_total,
                'shipping_total' => (string) $order->shipping_total,
                'shipping_discount' => (string) $order->shipping_discount,
                'cod_fee' => (string) $order->cod_fee,
                'total' => (string) $order->total,
            ],
            'contact' => ['name' => $order->contact_name, 'phone' => $order->contact_phone, 'email' => $order->contact_email],
            'address' => $address === null ? null : [
                'recipient_name' => $address->recipient_name,
                'phone' => $address->phone,
                'division_id' => $address->division_id,
                'division' => $address->division_name,
                'district_id' => $address->district_id,
                'district' => $address->district_name,
                'area' => $address->area,
                'address_line' => $address->address_line,
                'postcode' => $address->postcode,
            ],
            'shipping_method' => ['id' => $order->shipping_method_id, 'name' => $order->shipping_method_name],
            'coupon_code' => $order->coupon_code,
            'notes' => $order->notes,
        ];
    }

    /**
     * "SKU × quantity" per line, for the audit record.
     *
     * @param  list<array<string, mixed>>  $lines
     * @return list<string>
     */
    private static function lineSummary(array $lines): array
    {
        return array_map(fn (array $l) => $l['sku'].' × '.$l['quantity'], $lines);
    }
}
