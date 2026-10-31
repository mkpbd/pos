<?php

namespace App\Modules\Orders\Application\Actions;

use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Cart\Application\Actions\ShoppingCart;
use App\Modules\Cart\Domain\CartOwner;
use App\Modules\Customers\Application\Actions\CustomerAddressBook;
use App\Modules\Geography\Application\Contracts\GeoDirectory;
use App\Modules\Inventory\Application\Contracts\StockLedger;
use App\Modules\Inventory\Domain\MovementType;
use App\Modules\Inventory\Domain\StockChange;
use App\Modules\Inventory\Domain\StockReference;
use App\Modules\OnlinePayments\Application\Contracts\CheckoutPaymentMethods;
use App\Modules\Orders\Application\Events\OrderPlaced;
use App\Modules\Orders\Application\Services\CheckoutQuoter;
use App\Modules\Orders\Domain\OrderPaymentMethod;
use App\Modules\Orders\Domain\OrderStatus;
use App\Modules\Orders\Domain\PaymentStatus;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Orders\Infrastructure\Models\OrderAddress;
use App\Modules\Orders\Infrastructure\Models\OrderLine;
use App\Modules\Orders\Infrastructure\Models\OrderLineStock;
use App\Modules\Orders\Infrastructure\Models\OrderStatusChange;
use App\Modules\Products\Application\Contracts\ProductDirectory;
use App\Modules\Shared\Application\Contracts\SequenceGenerator;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Shared\Domain\ValueObjects\Money;
use App\Modules\Shipping\Domain\ShippingFee;
use App\Modules\Storefront\Application\Queries\StorefrontConfig;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Throwable;

/**
 * Brief checks 13–14: placing a web order (ADR-003/004/005).
 *
 * In one transaction: lock the cart → reprice it (CheckoutQuoter) → check address, delivery
 * method, payment method and the total the shopper confirmed → number the order
 * (WEB-000001) → take the stock from the fulfilment store through the ledger
 * (`online_order`, FEFO batches, never below zero) → write the order with its line, batch,
 * address and history snapshots → mark the cart converted. Any failure rolls everything
 * back. Idempotency (one order per Idempotency-Key) is enforced by the endpoint.
 *
 * COD orders start `confirmed`; bank transfer orders start `pending_payment` and expire after
 * the method's hold hours. Guests get a one-time access token (stored hashed).
 */
class PlaceOrder
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly StorefrontConfig $storefront,
        private readonly BranchDirectory $branches,
        private readonly ShoppingCart $carts,
        private readonly CheckoutQuoter $quoter,
        private readonly CheckoutPaymentMethods $payments,
        private readonly CustomerAddressBook $addresses,
        private readonly GeoDirectory $geo,
        private readonly ProductDirectory $products,
        private readonly StockLedger $stock,
        private readonly SequenceGenerator $sequences,
    ) {}

    /**
     * @param  array{customer_id: string, account_id: string}|null  $customer  the signed-in shopper, null for guests
     * @param  array<string, mixed>  $data  validated checkout body
     * @param  array{ip: ?string, user_agent: ?string, site_url: string}  $client
     * @return array{order: Order, access_token: ?string}
     *
     * @throws BusinessRuleViolation|ValidationException
     */
    public function __invoke(CartOwner $owner, ?array $customer, array $data, array $client): array
    {
        $organizationId = $this->tenant->requireOrganization();
        $settings = $this->storefront->settings();
        if ($customer === null && ! $settings->guest_checkout_enabled) {
            throw new BusinessRuleViolation('GUEST_CHECKOUT_DISABLED', 'Please sign in or create an account to place your order.');
        }
        $store = $this->fulfilmentStore($organizationId, $settings->fulfilment_store_id);

        [$order, $token] = DB::transaction(function () use ($owner, $customer, $data, $client, $organizationId, $store) {
            $cart = $this->carts->lockForCheckout($owner);
            if ($cart === null || ! $cart->items()->exists()) {
                throw new BusinessRuleViolation('CART_EMPTY', 'Your cart is empty.');
            }

            $quote = $this->quoter->quote($cart, $data, $customer['customer_id'] ?? null);
            $preview = $quote['preview'];
            if ($preview['issues'] !== [] || $quote['lines'] === []) {
                throw new BusinessRuleViolation('CART_HAS_ISSUES', 'Some products in your cart are no longer available in the quantity you chose. Please review your cart.', [
                    'cart' => $quote['cart'],
                ]);
            }

            $address = $this->address($customer, $data, $quote['saved_address']);
            if ($quote['method'] === null) {
                throw new BusinessRuleViolation('SHIPPING_UNAVAILABLE', 'We do not deliver to this district with the chosen delivery method. Choose another delivery method or address.', [
                    'district_id' => $address['district_id'],
                    'shipping_method_id' => $data['shipping_method_id'] ?? null,
                    'available_methods' => array_column($preview['shipping_methods'], 'id'),
                ]);
            }
            $method = $quote['method'];
            $paymentMethod = OrderPaymentMethod::from($data['payment_method']);
            $currency = $preview['currency'];
            $codFee = $paymentMethod === OrderPaymentMethod::CashOnDelivery
                ? Money::of(ShippingFee::cashOnDelivery($method['cod_allowed'], $method['cod_fee'], true), $currency)
                : Money::zero($currency);
            $total = Money::of($quote['goods_total'], $currency)->plus(Money::of($preview['shipping_total'], $currency))->plus($codFee);
            $payment = $this->payments->usable($paymentMethod->value, $total->amount(), $method['cod_allowed']);

            if (Decimal::compare(Decimal::round((string) $data['expected_total'], 2), $total->amount()) !== 0) {
                throw new BusinessRuleViolation('TOTAL_CHANGED', "The order total changed to {$total->amount()} {$currency}. Please check your order and confirm again.", [
                    'expected_total' => Decimal::round((string) $data['expected_total'], 2),
                    'total' => $total->amount(),
                    'preview' => $preview,
                ], 409);
            }

            $orderId = (string) Str::uuid7();
            $number = $this->sequences->next($organizationId, 'web_order', 'WEB-');
            $now = now();

            $changes = [];
            foreach ($quote['lines'] as $i => $line) {
                $changes[$i] = new StockChange($store['id'], $line['variant_id'], null, MovementType::OnlineOrder, $line['quantity'], allocateBatches: true);
            }
            $posted = $this->stock->post(array_values($changes), new StockReference('online_order', $orderId, $number));
            $variants = $this->products->variants($organizationId, array_column($quote['lines'], 'variant_id'));

            $costs = [];
            foreach ($quote['lines'] as $i => $line) {
                $unitCost = $posted[$i] !== null ? $posted[$i]['unit_cost'] : Decimal::round((string) ($variants[$line['variant_id']]['purchase_price'] ?? '0'), 4);
                $costs[$i] = ['unit_cost' => $unitCost, 'cost_total' => Money::ofProduct($line['quantity'], $unitCost, $currency)];
            }

            $initiation = $this->payments->initiate($paymentMethod->value, ['id' => $orderId, 'number' => $number, 'total' => $total->amount(), 'currency' => $currency]);
            $status = $initiation->awaitsPayment ? OrderStatus::PendingPayment : OrderStatus::Confirmed;
            $holdHours = (int) ($payment['settings']['hold_hours'] ?? 48);
            $token = $customer === null ? rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=') : null;

            $order = Order::query()->create([
                'id' => $orderId,
                'organization_id' => $organizationId,
                'number' => $number,
                'customer_id' => $customer['customer_id'] ?? null,
                'customer_account_id' => $customer['account_id'] ?? null,
                'branch_id' => $store['branch_id'],
                'store_id' => $store['id'],
                'status' => $status,
                'payment_status' => PaymentStatus::Unpaid,
                'payment_method' => $paymentMethod,
                'shipping_method_id' => $method['id'],
                'shipping_method_name' => $method['name'],
                'eta_min_days' => $method['eta_min_days'],
                'eta_max_days' => $method['eta_max_days'],
                'currency' => $currency,
                'tax_mode' => $quote['tax_mode'],
                'subtotal' => $preview['subtotal'],
                'tax_total' => $preview['tax_total'],
                'shipping_total' => $preview['shipping_total'],
                'cod_fee' => $codFee->amount(),
                'total' => $total->amount(),
                'paid_total' => '0.00',
                'cost_total' => array_reduce($costs, fn (Money $sum, array $c) => $sum->plus($c['cost_total']), Money::zero($currency))->amount(),
                'contact_name' => $data['contact']['name'],
                'contact_email' => $data['contact']['email'],
                'contact_phone' => $data['contact']['phone'],
                'notes' => $data['notes'] ?? null,
                'access_token_hash' => $token === null ? null : hash('sha256', $token),
                'placed_at' => $now,
                'expires_at' => $status === OrderStatus::PendingPayment ? $now->copy()->addHours($holdHours) : null,
                'confirmed_at' => $status === OrderStatus::Confirmed ? $now : null,
                'ip' => $client['ip'],
                'user_agent' => $client['user_agent'] === null ? null : mb_substr($client['user_agent'], 0, 255),
            ]);

            foreach ($quote['lines'] as $i => $line) {
                $orderLine = OrderLine::query()->create([
                    'organization_id' => $organizationId,
                    'order_id' => $orderId,
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
                    'net_amount' => $line['net_amount'],
                    'tax_rate' => $line['tax_rate'],
                    'tax_amount' => $line['tax_amount'],
                    'line_total' => $line['line_total'],
                    'unit_cost' => $costs[$i]['unit_cost'],
                    'cost_total' => $costs[$i]['cost_total']->amount(),
                    'created_at' => $now,
                ]);
                foreach ($posted[$i]['allocations'] ?? [] as $allocation) {
                    OrderLineStock::query()->create([
                        'organization_id' => $organizationId,
                        'order_line_id' => $orderLine->id,
                        'batch_id' => $allocation['batch_id'],
                        'quantity' => $allocation['quantity'],
                        'unit_cost' => $allocation['unit_cost'],
                        'movement_id' => $allocation['movement_id'],
                    ]);
                }
            }

            OrderAddress::query()->create($address + [
                'organization_id' => $organizationId,
                'order_id' => $orderId,
                'kind' => 'shipping',
                'email' => $data['contact']['email'],
                'created_at' => $now,
            ]);
            OrderStatusChange::query()->create([
                'organization_id' => $organizationId,
                'order_id' => $orderId,
                'from_status' => null,
                'to_status' => $status,
                'note' => 'Order placed',
                'actor_user_id' => null,
                'created_at' => $now,
            ]);

            $this->carts->markConverted($cart, $orderId);

            return [$order, $token];
        });

        if ($customer !== null && ($data['save_address'] ?? false) && isset($data['address'])) {
            $this->saveAddress($customer['customer_id'], $data['address']);
        }

        try {
            event(new OrderPlaced($organizationId, $order->id, $client['site_url'], $token));
        } catch (Throwable $e) {
            // The order stands; a notification problem must not turn it into an error.
            report($e);
        }

        return ['order' => $order, 'access_token' => $token];
    }

    /**
     * @return array{id: string, branch_id: string}
     */
    private function fulfilmentStore(string $organizationId, ?string $storeId): array
    {
        $store = $storeId === null ? null : $this->branches->store($storeId, $organizationId);
        if ($store === null || ! $store['is_active'] || ! $store['branch_is_active']) {
            throw new BusinessRuleViolation('CHECKOUT_UNAVAILABLE', 'Online ordering is not available right now. Please try again later.', ['reason' => 'no_fulfilment_store']);
        }

        return $store;
    }

    /**
     * The delivery address snapshot: a saved address of the customer, or the inline one.
     *
     * @param  array{customer_id: string, account_id: string}|null  $customer
     * @param  array<string, mixed>  $data
     * @param  array<string, mixed>|null  $saved
     * @return array{recipient_name: string, phone: string, division_id: int, division_name: string, district_id: int, district_name: string, area: ?string, address_line: string, postcode: ?string}
     *
     * @throws ValidationException
     */
    private function address(?array $customer, array $data, ?array $saved): array
    {
        if ($customer !== null && isset($data['shipping_address_id'])) {
            if ($saved === null) {
                throw ValidationException::withMessages(['shipping_address_id' => ['Choose one of your saved addresses.']]);
            }

            return [
                'recipient_name' => $saved['recipient_name'],
                'phone' => $saved['phone'],
                'division_id' => $saved['division']['id'],
                'division_name' => $saved['division']['name'],
                'district_id' => $saved['district']['id'],
                'district_name' => $saved['district']['name'],
                'area' => $saved['area'],
                'address_line' => $saved['address_line'],
                'postcode' => $saved['postcode'],
            ];
        }

        $address = $data['address'];
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
     * Adds the inline address to the customer's address book, best effort: a full address
     * book (or an address without an area, which the book requires) does not fail the order.
     *
     * @param  array<string, mixed>  $address
     */
    private function saveAddress(string $customerId, array $address): void
    {
        if (blank($address['area'] ?? null)) {
            return;
        }
        try {
            $this->addresses->create($customerId, [
                'recipient_name' => $address['recipient_name'],
                'phone' => $address['phone'],
                'division_id' => (int) $address['division_id'],
                'district_id' => (int) $address['district_id'],
                'area' => $address['area'],
                'address_line' => $address['address_line'],
                'postcode' => $address['postcode'] ?? null,
            ]);
        } catch (BusinessRuleViolation|ValidationException) {
            // ADDRESS_LIMIT_REACHED or similar: the order is placed regardless.
        }
    }
}
