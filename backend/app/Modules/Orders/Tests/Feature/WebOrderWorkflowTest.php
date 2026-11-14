<?php

namespace App\Modules\Orders\Tests\Feature;

use App\Modules\Audit\Infrastructure\Models\AuditLog;
use App\Modules\CustomerAccounts\Tests\Concerns\ActsAsShopper;
use App\Modules\Inventory\Infrastructure\Models\StockLevel;
use App\Modules\Inventory\Infrastructure\Models\StockMovement;
use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Orders\Infrastructure\Models\OrderLineStock;
use App\Modules\Orders\Tests\Concerns\BuildsCheckout;
use App\Modules\Payments\Infrastructure\Models\Payment;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

class WebOrderWorkflowTest extends TestCase
{
    use ActsAsShopper, BuildsCheckout, BuildsOnlineCatalog, InteractsWithTenancy, RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Notification::fake();
        $this->buildShop();
    }

    /**
     * Places a guest order and returns its id.
     *
     * @param  array<string, string|int>  $items  sku => quantity
     */
    private function order(array $items, string $payment = 'cod'): string
    {
        $this->clearBrowser();
        foreach ($items as $sku => $quantity) {
            $this->addToCart($sku, $quantity);
        }
        $total = $this->previewCheckout(['address' => ['district_id' => self::DHAKA], 'shipping_method_id' => $this->methods['inside'], 'payment_method' => $payment])->json('data.total');
        $number = $this->placeOrder($this->checkoutBody($total, ['payment_method' => $payment]))->assertCreated()->json('data.order.number');

        return Order::query()->withoutGlobalScopes()->where('number', $number)->value('id');
    }

    /**
     * @param  array<string, mixed>  $body
     */
    private function act(string $orderId, string $action, array $body = [], ?string $key = null): TestResponse
    {
        return $this->postJson("/api/v1/web-orders/{$orderId}/{$action}", $body, ['Idempotency-Key' => $key ?? (string) Str::uuid()]);
    }

    private function staff(): void
    {
        $this->clearBrowser();
        $this->actingAsUser($this->tenant['admin']);
    }

    /**
     * @return array<string, string> batch number (or "none") => quantity at the fulfilment store
     */
    private function pillLevels(): array
    {
        return StockLevel::query()->withoutGlobalScopes()
            ->leftJoin('batches', 'batches.id', '=', 'stock_levels.batch_id')
            ->where('stock_levels.variant_id', $this->v['PILLS'])
            ->orderBy('batches.batch_number')
            ->pluck('stock_levels.quantity', 'batches.batch_number')
            ->map(fn ($q) => (string) $q)->all();
    }

    public function test_cod_order_lifecycle_with_cash_on_delivery_payment(): void
    {
        $id = $this->order(['SHIRT' => 1]);
        $this->staff();

        $list = $this->getJson('/api/v1/web-orders')->assertOk();
        $this->assertSame(['id', 'number', 'placed_at', 'status', 'status_label', 'payment_status', 'payment_method', 'contact_name', 'contact_phone', 'total', 'currency', 'item_count', 'district', 'courier_name', 'tracking_number', 'shipment_status', 'delivered_at', 'source', 'campaign'], array_keys($list->json('data.0')));
        $this->assertSame(['WEB-000001', '510.00', '1'], [$list->json('data.0.number'), $list->json('data.0.total'), $list->json('data.0.item_count')]);
        $this->getJson('/api/v1/web-orders?status=pending_payment')->assertJsonPath('meta.pagination.total', 0);
        $this->getJson('/api/v1/web-orders?search=01712345678')->assertJsonPath('meta.pagination.total', 1);
        $this->getJson('/api/v1/web-orders?search=WEB-000001&payment_status=unpaid&from='.now('Asia/Dhaka')->toDateString())->assertJsonPath('meta.pagination.total', 1);

        $detail = $this->getJson("/api/v1/web-orders/{$id}")->assertOk()->json('data');
        $this->assertSame(['process', 'cancel'], $detail['allowed_actions']);
        $this->assertNull($detail['customer']);
        $this->assertSame([], $detail['payments']);
        $this->assertSame('Ring the bell', $detail['notes']);

        // Wrong steps are refused.
        $this->act($id, 'deliver')->assertStatus(422)->assertJsonPath('error.code', 'INVALID_STATUS_TRANSITION');
        $this->act($id, 'record-cod-payment')->assertStatus(422)->assertJsonPath('error.code', 'INVALID_STATUS_TRANSITION');
        $this->act($id, 'confirm-payment', ['reference' => 'X'])->assertStatus(422)->assertJsonPath('error.code', 'INVALID_STATUS_TRANSITION');

        $this->act($id, 'process')->assertOk()->assertJsonPath('data.status', 'processing')->assertJsonPath('data.allowed_actions', ['ship', 'cancel']);
        $this->act($id, 'ship', ['tracking_number' => 'T1'])->assertStatus(422)->assertJsonPath('error.code', 'VALIDATION_FAILED');
        // E10a: a courier id, not free text.
        $this->act($id, 'ship', ['courier_name' => 'Pathao', 'tracking_number' => 'PTH-1'])->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['courier_id']]]);
        $courier = $this->postJson('/api/v1/shipping/couriers', ['name' => 'Pathao'])->assertCreated()->json('data.id');
        $this->act($id, 'ship', ['courier_id' => $courier, 'tracking_number' => 'PTH-1'])->assertOk()
            ->assertJsonPath('data.status', 'shipped')->assertJsonPath('data.courier_name', 'Pathao')->assertJsonPath('data.tracking_number', 'PTH-1')
            ->assertJsonPath('data.allowed_actions', ['deliver', 'add_shipment_event', 'record_cod_payment']);
        $this->act($id, 'cancel', ['reason' => 'Too late'])->assertStatus(422)->assertJsonPath('error.code', 'INVALID_STATUS_TRANSITION');

        $paid = $this->act($id, 'record-cod-payment', ['reference' => 'Pathao remit 7'])->assertOk()->json('data');
        $this->assertSame(['paid', '510.00'], [$paid['payment_status'], $paid['paid_total']]);
        $this->assertSame('cash_on_delivery', $paid['payments'][0]['method']);
        $this->assertSame('510.00', $paid['payments'][0]['amount']);
        $this->assertSame($this->tenant['admin']->id, $paid['payments'][0]['recorded_by']['id']);
        $this->act($id, 'record-cod-payment')->assertStatus(422)->assertJsonPath('error.code', 'ORDER_ALREADY_PAID');

        $done = $this->act($id, 'deliver')->assertOk()->json('data');
        $this->assertSame('delivered', $done['status']);
        // E10b: a delivered, paid order can be returned (the admin holds web_orders.refund).
        $this->assertSame(['create_return'], $done['allowed_actions']);
        $this->assertSame(['confirmed', 'processing', 'shipped', 'delivered'], array_column($done['history'], 'status'));
        $this->assertNull($done['history'][0]['actor']);
        $this->assertSame($this->tenant['admin']->id, $done['history'][1]['actor']['id']);

        $ledger = Payment::query()->withoutGlobalScopes()->where('source_type', 'online_order')->get();
        $this->assertCount(1, $ledger);
        $this->assertNull($ledger[0]->cash_register_session_id);
        $this->assertSame('WEB-000001', $ledger[0]->source_number);
        $this->assertSame(['web_order.processing', 'web_order.shipped', 'web_order.cod_payment_recorded', 'web_order.delivered'],
            AuditLog::query()->withoutGlobalScopes()->where('action', 'like', 'web_order.%')->orderBy('created_at')->orderBy('id')->pluck('action')->all());
    }

    public function test_bank_transfer_payment_confirmation_is_idempotent(): void
    {
        $id = $this->order(['JUICE' => 1], 'bank_transfer');
        $this->staff();
        $this->getJson("/api/v1/web-orders/{$id}")->assertJsonPath('data.allowed_actions', ['confirm_payment', 'cancel'])
            ->assertJsonPath('data.payment_instructions', 'Pay to Test Bank, account 123.');

        $this->act($id, 'confirm-payment', [])->assertStatus(422)->assertJsonPath('error.code', 'VALIDATION_FAILED');
        $key = (string) Str::uuid();
        $confirmed = $this->act($id, 'confirm-payment', ['reference' => 'TXN-42'], $key)->assertOk()->json('data');
        $this->assertSame(['confirmed', 'paid', null, null], [$confirmed['status'], $confirmed['payment_status'], $confirmed['expires_at'], $confirmed['payment_instructions']]);
        $this->assertSame(['bank_transfer', '198.00', 'TXN-42'], [$confirmed['payments'][0]['method'], $confirmed['payments'][0]['amount'], $confirmed['payments'][0]['reference']]);

        // The same request again replays; a new request hits the paid order.
        $this->act($id, 'confirm-payment', ['reference' => 'TXN-42'], $key)->assertOk()->assertHeader('Idempotent-Replayed', 'true');
        $this->act($id, 'confirm-payment', ['reference' => 'TXN-43'])->assertStatus(422)->assertJsonPath('error.code', 'ORDER_ALREADY_PAID');
        $this->assertSame(1, Payment::query()->withoutGlobalScopes()->where('source_type', 'online_order')->count());

        // Paid orders are cancelled only with a refund (E11).
        $this->act($id, 'cancel', ['reason' => 'Changed mind'])->assertStatus(422)->assertJsonPath('error.code', 'REFUND_REQUIRED');
    }

    public function test_cancel_restocks_the_exact_batches_once(): void
    {
        $id = $this->order(['PILLS' => 3, 'SHIRT' => 1]);
        $this->assertSame(['EARLY' => '0.000', 'LATE' => '4.000'], $this->pillLevels());
        $allocations = OrderLineStock::query()->withoutGlobalScopes()->orderBy('quantity')->get();
        $this->assertSame(['1.000', '1.000', '2.000'], $allocations->pluck('quantity')->map(fn ($q) => (string) $q)->all());

        $this->staff();
        $this->act($id, 'cancel', [])->assertStatus(422)->assertJsonPath('error.code', 'VALIDATION_FAILED');
        $cancelled = $this->act($id, 'cancel', ['reason' => 'Customer called'])->assertOk()->json('data');
        $this->assertSame(['cancelled', 'Customer called', []], [$cancelled['status'], $cancelled['cancel_reason'], $cancelled['allowed_actions']]);
        $this->assertSame($this->tenant['admin']->id, $cancelled['cancelled_by']['id']);
        $this->assertSame(['EARLY' => '2.000', 'LATE' => '5.000'], $this->pillLevels());
        $this->assertSame(3, StockMovement::query()->withoutGlobalScopes()->where('type', 'online_order_cancel')->count());

        $this->act($id, 'cancel', ['reason' => 'Again'])->assertStatus(422)->assertJsonPath('error.code', 'INVALID_STATUS_TRANSITION');
        $this->assertSame(3, StockMovement::query()->withoutGlobalScopes()->where('type', 'online_order_cancel')->count());
        $this->assertSame(['EARLY' => '2.000', 'LATE' => '5.000'], $this->pillLevels());
    }

    public function test_expired_bank_transfer_orders_are_cancelled_and_restocked(): void
    {
        $expired = $this->order(['SHIRT' => 2], 'bank_transfer');
        $fresh = $this->order(['SHIRT' => 1], 'bank_transfer');
        $cod = $this->order(['SHIRT' => 1]);
        $this->assertSame('1.000', (string) StockLevel::query()->withoutGlobalScopes()->where('variant_id', $this->v['SHIRT'])->value('quantity'));

        $this->travel(47)->hours();
        $this->artisan('orders:expire-pending')->assertSuccessful();
        $this->assertSame(0, Order::query()->withoutGlobalScopes()->where('status', 'cancelled')->count());

        $this->travel(2)->hours();
        $this->artisan('orders:expire-pending')->expectsOutputToContain('Cancelled 2 expired order(s).')->assertSuccessful();
        $this->artisan('orders:expire-pending')->expectsOutputToContain('Cancelled 0 expired order(s).');

        foreach ([$expired, $fresh] as $id) {
            $order = Order::query()->withoutGlobalScopes()->findOrFail($id);
            $this->assertSame(['cancelled', 'payment_expired', null], [$order->status->value, $order->cancel_reason, $order->cancelled_by]);
        }
        $this->assertSame('confirmed', Order::query()->withoutGlobalScopes()->findOrFail($cod)->status->value);
        $this->assertSame('4.000', (string) StockLevel::query()->withoutGlobalScopes()->where('variant_id', $this->v['SHIRT'])->value('quantity'));
        $this->assertSame(2, StockMovement::query()->withoutGlobalScopes()->where('type', 'online_order_cancel')->count());

        $this->staff();
        $history = $this->getJson("/api/v1/web-orders/{$expired}")->json('data.history');
        $this->assertSame(['pending_payment', 'cancelled'], array_column($history, 'status'));
        $this->assertNull($history[1]['actor']);
    }

    public function test_permissions(): void
    {
        $id = $this->order(['SHIRT' => 1]);
        $cashier = $this->createUserWithRole($this->tenant['organization'], SystemRole::Cashier, [$this->tenant['store']->branch_id]);
        $manager = $this->createUserWithRole($this->tenant['organization'], SystemRole::OnlineStoreManager);
        $this->clearBrowser();

        $this->actingAsUser($cashier);
        $this->getJson('/api/v1/web-orders')->assertForbidden();
        $this->getJson("/api/v1/web-orders/{$id}")->assertForbidden();
        $this->act($id, 'process')->assertForbidden();
        $this->getJson('/api/v1/shipping/zones')->assertForbidden();
        $this->postJson('/api/v1/shipping/zones', ['name' => 'X'])->assertForbidden();
        $this->getJson('/api/v1/payment-gateways')->assertForbidden();
        $this->getJson('/api/v1/geography/districts')->assertOk()->assertJsonCount(64, 'data');

        // The Online Store Manager runs orders and shipping, but not payment methods (ADR-016).
        $this->actingAsUser($manager);
        $this->getJson("/api/v1/web-orders/{$id}")->assertOk()->assertJsonPath('data.allowed_actions', ['process', 'cancel']);
        $this->act($id, 'process')->assertOk();
        $this->getJson('/api/v1/shipping/zones')->assertOk()->assertJsonCount(2, 'data');
        $this->getJson('/api/v1/payment-gateways')->assertForbidden();

        // Staff actions need an Idempotency-Key.
        $this->postJson("/api/v1/web-orders/{$id}/ship", ['courier_id' => (string) Str::uuid()])->assertStatus(428);
    }

    public function test_orders_and_shipping_are_isolated_between_organizations(): void
    {
        $id = $this->order(['SHIRT' => 1]);
        $token = null;
        $this->clearBrowser();
        $this->addToCart('SHIRT', 1);
        $placed = $this->placeOrder($this->checkoutBody('510.00'))->assertCreated();
        $token = $placed->json('data.access_token');

        $other = $this->openStore('Other Shop', 'other.example.test');
        $this->getJson('/api/v1/web-orders')->assertOk()->assertJsonPath('meta.pagination.total', 0);
        $this->getJson("/api/v1/web-orders/{$id}")->assertNotFound();
        $this->postJson("/api/v1/web-orders/{$id}/process", [], ['Idempotency-Key' => (string) Str::uuid()])->assertNotFound();
        $this->getJson('/api/v1/shipping/zones')->assertOk()->assertJsonCount(0, 'data');
        $this->patchJson("/api/v1/shipping/zones/{$this->zones['inside']}", ['name' => 'Mine'])->assertNotFound();
        $this->patchJson("/api/v1/shipping/methods/{$this->methods['inside']}", ['fee' => '1'])->assertNotFound();
        // Districts are per organization: the other store may use Dhaka too.
        $this->postJson('/api/v1/shipping/zones', ['name' => 'Dhaka', 'district_ids' => [self::DHAKA]])->assertCreated();

        // The guest token opens the order only on its own store.
        $this->asVisitor();
        $this->browse('GET', $this->storeUrl('orders/WEB-000002?token='.$token, 'other.example.test'))->assertNotFound();
        $this->browse('GET', $this->storeUrl('orders/WEB-000002?token='.$token))->assertOk();
        // The other store's methods are its own.
        $this->browse('GET', $this->storeUrl('shipping-methods?district_id='.self::DHAKA, 'other.example.test'))->assertOk()->assertJsonPath('data', []);
        $this->assertNotNull($other);
    }

    public function test_shipping_zones_and_methods(): void
    {
        $this->staff();
        $zones = $this->getJson('/api/v1/shipping/zones')->assertOk()->json('data');
        $this->assertSame(['Inside Dhaka', 'Outside Dhaka'], array_column($zones, 'name'));
        $this->assertSame([['id' => self::DHAKA, 'name' => 'Dhaka']], $zones[0]['districts']);
        $this->assertSame(['id', 'zone_id', 'name', 'description', 'fee', 'free_over', 'cod_allowed', 'cod_fee', 'eta_min_days', 'eta_max_days', 'is_active', 'sort_order', 'translations'], array_keys($zones[0]['methods'][0]));
        $this->assertSame(['60.00', '2000.00', '0.00'], [$zones[0]['methods'][0]['fee'], $zones[0]['methods'][0]['free_over'], $zones[0]['methods'][0]['cod_fee']]);

        // One zone per district.
        $this->postJson('/api/v1/shipping/zones', ['name' => 'Metro', 'district_ids' => [self::DHAKA]])->assertStatus(422)
            ->assertJsonPath('error.code', 'DISTRICT_IN_OTHER_ZONE')
            ->assertJsonPath('error.details.district_ids', [self::DHAKA])
            ->assertJsonPath('error.details.districts.0.zone_name', 'Inside Dhaka');
        $this->patchJson("/api/v1/shipping/zones/{$this->zones['outside']}", ['district_ids' => [$this->otherDistrict, self::DHAKA]])->assertStatus(422)
            ->assertJsonPath('error.code', 'DISTRICT_IN_OTHER_ZONE');
        // Moving a district: free it first.
        $this->patchJson("/api/v1/shipping/zones/{$this->zones['inside']}", ['district_ids' => []])->assertOk()->assertJsonPath('data.districts', []);
        $this->patchJson("/api/v1/shipping/zones/{$this->zones['outside']}", ['district_ids' => [$this->otherDistrict, self::DHAKA], 'name' => 'Everywhere'])->assertOk()
            ->assertJsonPath('data.name', 'Everywhere')->assertJsonCount(2, 'data.districts');

        // Methods: validation, full update, delete.
        $this->postJson("/api/v1/shipping/zones/{$this->zones['outside']}/methods", ['name' => 'Bad', 'fee' => '-1', 'eta_min_days' => 3, 'eta_max_days' => 31])->assertStatus(422)
            ->assertJsonStructure(['error' => ['details' => ['fee', 'eta_max_days']]]);
        $this->postJson("/api/v1/shipping/zones/{$this->zones['outside']}/methods", ['name' => 'Bad', 'fee' => '1', 'eta_min_days' => 5, 'eta_max_days' => 3])->assertStatus(422)
            ->assertJsonStructure(['error' => ['details' => ['eta_max_days']]]);
        $express = $this->postJson("/api/v1/shipping/zones/{$this->zones['outside']}/methods", [
            'name' => 'Express', 'description' => null, 'fee' => '200.5', 'free_over' => null, 'cod_allowed' => false, 'cod_fee' => '0.00',
            'eta_min_days' => 0, 'eta_max_days' => 1, 'is_active' => true, 'sort_order' => 5,
        ])->assertCreated()->assertJsonPath('data.fee', '200.50')->json('data');
        $this->patchJson("/api/v1/shipping/methods/{$express['id']}", ['is_active' => false] + $express)->assertOk()->assertJsonPath('data.is_active', false);
        $this->browse('GET', $this->storeUrl('shipping-methods?district_id='.self::DHAKA))->assertJsonCount(1, 'data');
        $this->actingAsUser($this->tenant['admin']);
        $this->deleteJson("/api/v1/shipping/methods/{$express['id']}")->assertNoContent();

        // Inactive zone: no delivery there.
        $this->patchJson("/api/v1/shipping/zones/{$this->zones['outside']}", ['is_active' => false])->assertOk();
        $this->browse('GET', $this->storeUrl('shipping-methods?district_id='.self::DHAKA))->assertJsonPath('data', []);
        $this->actingAsUser($this->tenant['admin']);
        $this->deleteJson("/api/v1/shipping/zones/{$this->zones['outside']}")->assertNoContent();
        $this->getJson('/api/v1/shipping/zones')->assertJsonCount(1, 'data');
    }

    public function test_preview_picks_the_only_delivery_method(): void
    {
        $this->clearBrowser();
        $this->addToCart('SHIRT', 1);
        $this->previewCheckout(['address' => ['division_id' => self::DHAKA_DIVISION, 'district_id' => self::DHAKA]])->assertOk()
            ->assertJsonPath('data.shipping_method_id', $this->methods['inside'])
            ->assertJsonPath('data.shipping_total', '60.00');
        // Placement still needs the shopper's choice.
        $this->placeOrder($this->checkoutBody('510.00', ['shipping_method_id' => $this->methods['outside']]))->assertStatus(422)->assertJsonPath('error.code', 'SHIPPING_UNAVAILABLE');
    }

    public function test_payment_methods_configuration(): void
    {
        $this->staff();
        $methods = $this->getJson('/api/v1/payment-gateways')->assertOk()->json('data');
        $this->assertSame(['cod', 'bank_transfer'], array_column($methods, 'code'));
        $this->assertSame(['code', 'display_name', 'is_enabled', 'instructions', 'settings', 'sort_order', 'translations'], array_keys($methods[0]));
        $this->assertSame(['max_order_total' => null], $methods[0]['settings']);
        $this->assertSame(['hold_hours' => 48], $methods[1]['settings']);

        $this->putJson('/api/v1/payment-gateways/bank_transfer', ['settings' => ['hold_hours' => 200]])->assertStatus(422);
        $this->putJson('/api/v1/payment-gateways/paypal', ['is_enabled' => true])->assertNotFound();
        $this->putJson('/api/v1/payment-gateways/bank_transfer', [
            'is_enabled' => true, 'display_name' => 'Bank deposit', 'instructions' => null, 'settings' => ['hold_hours' => 2], 'sort_order' => 0,
        ])->assertOk()->assertJsonPath('data.display_name', 'Bank deposit')->assertJsonPath('data.settings', ['hold_hours' => 2]);
        $this->putJson('/api/v1/payment-gateways/cod', ['sort_order' => 3, 'settings' => ['max_order_total' => null]])->assertOk();

        // Display order follows sort_order.
        $this->clearBrowser();
        $this->browse('GET', $this->storeUrl('checkout/options'))->assertJsonPath('data.payment_methods.0.code', 'bank_transfer')
            ->assertJsonPath('data.payment_methods.0.display_name', 'Bank deposit');
    }
}
