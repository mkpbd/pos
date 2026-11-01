<?php

namespace App\Modules\Orders\Tests\Feature;

use App\Modules\CustomerAccounts\Tests\Concerns\ActsAsShopper;
use App\Modules\Expenses\Infrastructure\Models\Expense;
use App\Modules\Expenses\Infrastructure\Models\ExpenseCategory;
use App\Modules\Inventory\Infrastructure\Models\StockLevel;
use App\Modules\Inventory\Infrastructure\Models\StockMovement;
use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Orders\Infrastructure\Models\CodRemittance;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Orders\Infrastructure\Models\Shipment;
use App\Modules\Orders\Infrastructure\Models\ShipmentEvent;
use App\Modules\Orders\Tests\Concerns\BuildsCheckout;
use App\Modules\Payments\Infrastructure\Models\Payment;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use LogicException;
use Tests\TestCase;

/**
 * E10a fulfilment: couriers, shipments and their events, the orders board, bulk processing,
 * print data and couriers' COD remittances.
 */
class FulfilmentTest extends TestCase
{
    use ActsAsShopper, BuildsCheckout, BuildsOnlineCatalog, InteractsWithTenancy, RefreshDatabase;

    /** @var array<string, string> courier ids by name */
    private array $couriers = [];

    protected function setUp(): void
    {
        parent::setUp();
        Notification::fake();
        $this->buildShop();
        $this->staff();
        $this->couriers['Pathao'] = $this->postJson('/api/v1/shipping/couriers', [
            'name' => 'Pathao', 'tracking_url_template' => 'https://merchant.pathao.com/tracking?consignment_id={tracking}',
        ])->assertCreated()->json('data.id');
        $this->couriers['Steadfast'] = $this->postJson('/api/v1/shipping/couriers', ['name' => 'Steadfast', 'sort_order' => 1])->assertCreated()->json('data.id');
    }

    /**
     * Places a guest order and returns its id.
     *
     * @param  array<string, string|int>  $items  sku => quantity
     */
    private function order(array $items, string $payment = 'cod', bool $outside = false): string
    {
        $this->clearBrowser();
        foreach ($items as $sku => $quantity) {
            $this->addToCart($sku, $quantity);
        }
        $method = $this->methods[$outside ? 'outside' : 'inside'];
        $district = $outside ? $this->otherDistrict : self::DHAKA;
        $total = $this->previewCheckout(['address' => ['district_id' => $district], 'shipping_method_id' => $method, 'payment_method' => $payment])->json('data.total');
        $number = $this->placeOrder($this->checkoutBody($total, [
            'payment_method' => $payment,
            'shipping_method_id' => $method,
            'address' => $this->inlineAddress($outside ? $this->otherDistrict : null, $outside ? $this->otherDivision : null),
        ]))->assertCreated()->json('data.order.number');
        $this->staff();

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
     * Moves a COD order to shipped (with the courier) or delivered.
     */
    private function shipped(string $id, string $courier = 'Pathao', bool $deliver = false, string $tracking = 'TRK 1/A'): void
    {
        $this->act($id, 'process')->assertOk();
        $this->act($id, 'ship', ['courier_id' => $this->couriers[$courier], 'tracking_number' => $tracking])->assertOk();
        if ($deliver) {
            $this->act($id, 'shipment/events', ['status' => 'delivered'])->assertOk();
        }
    }

    private function number(string $id): string
    {
        return Order::query()->withoutGlobalScopes()->whereKey($id)->value('number');
    }

    public function test_couriers_crud_validation_and_in_use(): void
    {
        $list = $this->getJson('/api/v1/shipping/couriers')->assertOk()->json('data');
        $this->assertSame(['Pathao', 'Steadfast'], array_column($list, 'name'));
        $this->assertSame(['id', 'name', 'phone', 'tracking_url_template', 'is_active', 'sort_order'], array_keys($list[0]));

        $this->postJson('/api/v1/shipping/couriers', ['name' => 'pathao'])->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['name']]]);
        $this->postJson('/api/v1/shipping/couriers', ['name' => 'X', 'tracking_url_template' => 'https://x.test/track'])->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['tracking_url_template']]]);
        $this->postJson('/api/v1/shipping/couriers', ['name' => 'X', 'tracking_url_template' => 'javascript:alert({tracking})'])->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['tracking_url_template']]]);
        $this->postJson('/api/v1/shipping/couriers', ['name' => str_repeat('a', 81)])->assertStatus(422);

        $redx = $this->postJson('/api/v1/shipping/couriers', ['name' => ' RedX ', 'phone' => '0123', 'tracking_url_template' => 'http://redx.test/t/{tracking}', 'sort_order' => 2])
            ->assertCreated()->assertJsonPath('data.name', 'RedX')->assertJsonPath('data.is_active', true)->json('data');
        $this->patchJson("/api/v1/shipping/couriers/{$redx['id']}", ['tracking_url_template' => null, 'is_active' => false])->assertOk()
            ->assertJsonPath('data.tracking_url_template', null)->assertJsonPath('data.is_active', false)->assertJsonPath('data.phone', '0123');
        $this->getJson('/api/v1/shipping/couriers?active=1')->assertJsonCount(2, 'data');
        $this->patchJson("/api/v1/shipping/couriers/{$redx['id']}", ['name' => 'STEADFAST'])->assertStatus(422);

        // An inactive courier takes no parcels; a used courier cannot be deleted.
        $id = $this->order(['RICE' => 1]);
        $this->act($id, 'process')->assertOk();
        $this->act($id, 'ship', ['courier_id' => $redx['id']])->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['courier_id']]]);
        $this->act($id, 'ship', ['courier_id' => (string) Str::uuid()])->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['courier_id']]]);
        $this->act($id, 'ship', ['courier_id' => $this->couriers['Pathao']])->assertOk();
        $this->deleteJson("/api/v1/shipping/couriers/{$this->couriers['Pathao']}")->assertStatus(422)->assertJsonPath('error.code', 'IN_USE');
        $this->deleteJson("/api/v1/shipping/couriers/{$redx['id']}")->assertNoContent();
        $this->getJson('/api/v1/shipping/couriers')->assertJsonCount(2, 'data');
    }

    public function test_courier_permissions_and_isolation(): void
    {
        $cashier = $this->createUserWithRole($this->tenant['organization'], SystemRole::Cashier, [$this->tenant['store']->branch_id]);
        $manager = $this->createUserWithRole($this->tenant['organization'], SystemRole::OnlineStoreManager);
        $accountant = $this->createUserWithRole($this->tenant['organization'], SystemRole::Accountant);

        $this->actingAsUser($cashier);
        $this->getJson('/api/v1/shipping/couriers')->assertForbidden();
        $this->postJson('/api/v1/shipping/couriers', ['name' => 'X'])->assertForbidden();
        $this->getJson('/api/v1/cod-remittances')->assertForbidden();

        $this->actingAsUser($accountant);
        $this->getJson('/api/v1/shipping/couriers')->assertOk()->assertJsonCount(2, 'data');
        $this->postJson('/api/v1/shipping/couriers', ['name' => 'X'])->assertForbidden();
        $this->getJson('/api/v1/cod-remittances')->assertOk();
        $this->getJson('/api/v1/web-orders')->assertOk();
        $this->postJson('/api/v1/web-orders/bulk/process', ['order_ids' => [(string) Str::uuid()]], ['Idempotency-Key' => (string) Str::uuid()])->assertForbidden();

        $this->actingAsUser($manager);
        $this->patchJson("/api/v1/shipping/couriers/{$this->couriers['Steadfast']}", ['phone' => '01'])->assertOk();
        $this->getJson('/api/v1/cod-remittances')->assertOk();

        $this->openStore('Other Shop', 'other.example.test');
        $this->getJson('/api/v1/shipping/couriers')->assertOk()->assertJsonCount(0, 'data');
        $this->patchJson("/api/v1/shipping/couriers/{$this->couriers['Pathao']}", ['phone' => '1'])->assertNotFound();
        $this->deleteJson("/api/v1/shipping/couriers/{$this->couriers['Pathao']}")->assertNotFound();
        // Names are unique per organization only.
        $this->postJson('/api/v1/shipping/couriers', ['name' => 'Pathao'])->assertCreated();
    }

    public function test_shipment_events_tracking_link_and_delivery(): void
    {
        $id = $this->order(['RICE' => 2]);
        $this->act($id, 'shipment/events', ['status' => 'in_transit'])->assertStatus(422)->assertJsonPath('error.code', 'SHIPMENT_NOT_FOUND');
        $this->act($id, 'process')->assertOk();
        $order = $this->act($id, 'ship', ['courier_id' => $this->couriers['Pathao'], 'tracking_number' => ' TRK 1/A ', 'note' => 'Picked up'])->assertOk()->json('data');

        $this->assertSame(['Pathao', 'TRK 1/A', 'https://merchant.pathao.com/tracking?consignment_id=TRK%201%2FA'], [$order['courier_name'], $order['tracking_number'], $order['tracking_url']]);
        $shipment = $order['shipment'];
        $this->assertSame(['handed_over', 'Handed to courier', $order['total'], ['id' => $this->couriers['Pathao'], 'name' => 'Pathao']], [$shipment['status'], $shipment['status_label'], $shipment['cod_amount'], $shipment['courier']]);
        $this->assertSame(['handed_over'], array_column($shipment['events'], 'status'));
        $this->assertSame('Picked up', $shipment['events'][0]['note']);
        $this->assertSame($this->tenant['admin']->id, $shipment['events'][0]['recorded_by']['id']);
        $this->assertSame(['deliver', 'add_shipment_event', 'record_cod_payment'], $order['allowed_actions']);

        $this->act($id, 'shipment/events', ['status' => 'handed_over'])->assertStatus(422)->assertJsonPath('error.code', 'VALIDATION_FAILED');
        $this->act($id, 'shipment/events', ['status' => 'in_transit', 'occurred_at' => now()->addHour()->toIso8601String()])->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['occurred_at']]]);
        $this->act($id, 'shipment/events', ['status' => 'in_transit', 'occurred_at' => now()->subDay()->toIso8601String()])->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['occurred_at']]]);
        $key = (string) Str::uuid();
        $this->act($id, 'shipment/events', ['status' => 'in_transit', 'note' => 'At hub'], $key)->assertOk()->assertJsonPath('data.shipment.status', 'in_transit');
        $this->act($id, 'shipment/events', ['status' => 'in_transit', 'note' => 'At hub'], $key)->assertOk()->assertHeader('Idempotent-Replayed', 'true');
        $this->act($id, 'shipment/events', ['status' => 'in_transit', 'note' => 'Out for delivery'])->assertOk();

        $done = $this->act($id, 'shipment/events', ['status' => 'delivered', 'note' => 'Signed by Rina'])->assertOk()->json('data');
        $this->assertSame(['delivered', 'delivered'], [$done['status'], $done['shipment']['status']]);
        $this->assertSame(['handed_over', 'in_transit', 'in_transit', 'delivered'], array_column($done['shipment']['events'], 'status'));
        $this->assertSame('Signed by Rina', end($done['history'])['note']);
        $this->assertNotNull($done['delivered_at']);
        $this->assertSame(['record_cod_payment'], $done['allowed_actions']);
        $this->act($id, 'shipment/events', ['status' => 'returned'])->assertStatus(422)->assertJsonPath('error.code', 'INVALID_STATUS_TRANSITION');
        $this->act($id, 'deliver')->assertStatus(422)->assertJsonPath('error.code', 'INVALID_STATUS_TRANSITION');
        $this->assertSame(4, ShipmentEvent::query()->withoutGlobalScopes()->count());

        // The legacy /deliver endpoint adds a delivered event too.
        $other = $this->order(['RICE' => 1], 'bank_transfer');
        $this->act($other, 'confirm-payment', ['reference' => 'TXN'])->assertOk();
        $this->shipped($other, 'Steadfast');
        $this->assertSame('0.00', (string) Shipment::query()->withoutGlobalScopes()->where('order_id', $other)->value('cod_amount'));
        $view = $this->act($other, 'deliver')->assertOk()->json('data');
        $this->assertSame(['delivered', ['handed_over', 'delivered']], [$view['shipment']['status'], array_column($view['shipment']['events'], 'status')]);
        // Steadfast has no template: no link.
        $this->assertNull($view['tracking_url']);

        // Append-only events.
        $this->expectException(LogicException::class);
        ShipmentEvent::query()->withoutGlobalScopes()->first()->update(['note' => 'x']);
    }

    public function test_storefront_order_views_show_the_tracking_link(): void
    {
        $this->clearBrowser();
        $this->addToCart('RICE', 1);
        $total = $this->previewCheckout(['address' => ['district_id' => self::DHAKA], 'shipping_method_id' => $this->methods['inside'], 'payment_method' => 'cod'])->json('data.total');
        $placed = $this->placeOrder($this->checkoutBody($total))->assertCreated()->json('data');
        $view = $this->browse('GET', $this->storeUrl("orders/{$placed['order']['number']}?token={$placed['access_token']}"))->assertOk()->json('data');
        $this->assertSame([null, null], [$view['courier_name'], $view['tracking_url']]);

        $this->staff();
        $this->shipped(Order::query()->withoutGlobalScopes()->where('number', $placed['order']['number'])->value('id'), 'Pathao', false, 'P-77');
        $this->clearBrowser();
        $view = $this->browse('GET', $this->storeUrl("orders/{$placed['order']['number']}?token={$placed['access_token']}"))->assertOk()->json('data');
        $this->assertSame(['Pathao', 'P-77', 'https://merchant.pathao.com/tracking?consignment_id=P-77'], [$view['courier_name'], $view['tracking_number'], $view['tracking_url']]);
        $this->assertArrayNotHasKey('shipment', $view);
    }

    public function test_returned_parcel_allows_cancel_with_exact_restock(): void
    {
        $id = $this->order(['SHIRT' => 2]);
        $level = fn () => (string) StockLevel::query()->withoutGlobalScopes()->where('variant_id', $this->v['SHIRT'])->value('quantity');
        $this->assertSame('3.000', $level());
        $this->shipped($id);

        // Shipped and not returned: no cancel.
        $this->act($id, 'cancel', ['reason' => 'Refused'])->assertStatus(422)->assertJsonPath('error.code', 'INVALID_STATUS_TRANSITION');

        $returned = $this->act($id, 'shipment/events', ['status' => 'returned', 'note' => 'Customer refused'])->assertOk()->json('data');
        $this->assertSame(['shipped', 'returned'], [$returned['status'], $returned['shipment']['status']]);
        $this->assertNotNull($returned['shipment']['returned_at']);
        $this->assertSame(['cancel'], $returned['allowed_actions']);
        $this->act($id, 'deliver')->assertStatus(422)->assertJsonPath('error.code', 'INVALID_STATUS_TRANSITION');
        $this->act($id, 'shipment/events', ['status' => 'delivered'])->assertStatus(422)->assertJsonPath('error.code', 'INVALID_STATUS_TRANSITION');
        // A returned parcel collected no cash: no COD payment can be booked for it, so cancelling stays possible.
        $this->act($id, 'record-cod-payment')->assertStatus(422)->assertJsonPath('error.code', 'INVALID_STATUS_TRANSITION')
            ->assertJsonPath('error.details.shipment_status', 'returned');
        $this->assertSame('unpaid', Order::query()->withoutGlobalScopes()->whereKey($id)->first()->payment_status->value);
        $this->act($id, 'cancel', ['reason' => 'Refused'])->assertOk()->assertJsonPath('data.status', 'cancelled');
    }

    public function test_returned_unpaid_order_is_cancelled_and_restocked_once(): void
    {
        $id = $this->order(['SHIRT' => 2]);
        $level = fn () => (string) StockLevel::query()->withoutGlobalScopes()->where('variant_id', $this->v['SHIRT'])->value('quantity');
        $this->shipped($id);
        $this->act($id, 'shipment/events', ['status' => 'returned'])->assertOk();

        $key = (string) Str::uuid();
        $cancelled = $this->act($id, 'cancel', ['reason' => 'Returned to sender'], $key)->assertOk()->json('data');
        $this->assertSame(['cancelled', 'returned', []], [$cancelled['status'], $cancelled['shipment']['status'], $cancelled['allowed_actions']]);
        $this->assertSame('shipped', end($cancelled['history'])['from_status']);
        $this->assertSame('5.000', $level());
        $this->act($id, 'cancel', ['reason' => 'Returned to sender'], $key)->assertOk()->assertHeader('Idempotent-Replayed', 'true');
        $this->act($id, 'cancel', ['reason' => 'Again'])->assertStatus(422)->assertJsonPath('error.code', 'INVALID_STATUS_TRANSITION');
        $this->assertSame('5.000', $level());
        $this->assertSame(1, StockMovement::query()->withoutGlobalScopes()->where('type', 'online_order_cancel')->count());
    }

    public function test_orders_board_filters_and_status_counts(): void
    {
        $a = $this->order(['RICE' => 1]);                       // confirmed
        $b = $this->order(['RICE' => 1]);
        $this->shipped($b, 'Pathao', true);                     // delivered COD, unpaid (Pathao)
        $c = $this->order(['RICE' => 1], 'cod', true);
        $this->shipped($c, 'Steadfast', true);                  // delivered COD, unpaid (Steadfast), outside Dhaka
        $d = $this->order(['RICE' => 1], 'bank_transfer');      // pending payment
        $e = $this->order(['RICE' => 1]);
        $this->shipped($e, 'Pathao');                           // shipped

        $board = $this->getJson('/api/v1/web-orders')->assertOk();
        $this->assertSame(['all' => 5, 'pending_payment' => 1, 'confirmed' => 1, 'processing' => 0, 'shipped' => 1, 'delivered' => 2, 'cancelled' => 0, 'failed' => 0, 'cod_unremitted' => 2], $board->json('meta.status_counts'));
        $row = collect($board->json('data'))->firstWhere('id', $b);
        $this->assertSame(['Dhaka', 'Pathao', 'TRK 1/A', 'delivered'], [$row['district'], $row['courier_name'], $row['tracking_number'], $row['shipment_status']]);

        $ids = fn (string $query) => collect($this->getJson('/api/v1/web-orders?'.$query)->assertOk()->json('data'))->pluck('id')->sort()->values()->all();
        $sorted = fn (array $v) => collect($v)->sort()->values()->all();
        $this->assertSame($sorted([$b, $e]), $ids('courier_id='.$this->couriers['Pathao']));
        $this->assertSame([$d], $ids('payment_method=bank_transfer'));
        $this->assertSame([$c], $ids('district_id='.$this->otherDistrict));
        $this->assertSame($sorted([$b, $c]), $ids('cod_unremitted=1'));
        $this->assertSame([$b], $ids('cod_unremitted=1&courier_id='.$this->couriers['Pathao']));
        $this->assertSame([], $ids('date_from='.now('Asia/Dhaka')->addDay()->toDateString()));
        $this->assertSame(5, count($ids('date_from='.now('Asia/Dhaka')->toDateString().'&date_to='.now('Asia/Dhaka')->toDateString())));

        // Counts follow the non-status filters; the status filter only narrows the rows.
        $pathao = $this->getJson('/api/v1/web-orders?status=delivered&courier_id='.$this->couriers['Pathao'])->assertOk();
        $this->assertSame([$b], array_column($pathao->json('data'), 'id'));
        $this->assertSame(['all' => 2, 'shipped' => 1, 'delivered' => 1, 'cod_unremitted' => 1], array_intersect_key($pathao->json('meta.status_counts'), array_flip(['all', 'shipped', 'delivered', 'cod_unremitted'])));
        $cod = $this->getJson('/api/v1/web-orders?cod_unremitted=1')->json('meta.status_counts');
        $this->assertSame([2, 2, 0], [$cod['all'], $cod['cod_unremitted'], $cod['confirmed']]);

        $this->getJson('/api/v1/web-orders?courier_id=nope')->assertStatus(422);
        $this->getJson('/api/v1/web-orders?payment_method=paypal')->assertStatus(422);
        $this->assertNotNull($a);
    }

    public function test_bulk_process_reports_each_order(): void
    {
        $a = $this->order(['RICE' => 1]);
        $b = $this->order(['RICE' => 1]);
        $pending = $this->order(['RICE' => 1], 'bank_transfer');
        $unknown = (string) Str::uuid();

        $this->postJson('/api/v1/web-orders/bulk/process', ['order_ids' => []], ['Idempotency-Key' => (string) Str::uuid()])->assertStatus(422);
        $this->postJson('/api/v1/web-orders/bulk/process', ['order_ids' => array_fill(0, 101, $unknown)], ['Idempotency-Key' => (string) Str::uuid()])->assertStatus(422);
        $this->postJson('/api/v1/web-orders/bulk/process', ['order_ids' => [$a]])->assertStatus(428);

        $key = (string) Str::uuid();
        $result = $this->postJson('/api/v1/web-orders/bulk/process', ['order_ids' => [$a, $pending, $unknown, $b]], ['Idempotency-Key' => $key])->assertOk()->json('data');
        $this->assertSame([2, 2], [$result['succeeded'], $result['failed']]);
        $this->assertSame([
            ['id' => $a, 'number' => $this->number($a), 'ok' => true],
            ['id' => $pending, 'number' => $this->number($pending), 'ok' => false, 'error_code' => 'INVALID_STATUS_TRANSITION'],
            ['id' => $unknown, 'number' => null, 'ok' => false, 'error_code' => 'NOT_FOUND'],
            ['id' => $b, 'number' => $this->number($b), 'ok' => true],
        ], array_map(fn (array $r) => array_diff_key($r, ['message' => true]), $result['results']));
        $this->assertSame(['processing', 'pending_payment', 'processing'], array_map(fn ($id) => Order::query()->withoutGlobalScopes()->find($id)->status->value, [$a, $pending, $b]));

        $this->postJson('/api/v1/web-orders/bulk/process', ['order_ids' => [$a, $pending, $unknown, $b]], ['Idempotency-Key' => $key])->assertOk()->assertHeader('Idempotent-Replayed', 'true');
        $again = $this->postJson('/api/v1/web-orders/bulk/process', ['order_ids' => [$a]], ['Idempotency-Key' => (string) Str::uuid()])->assertOk()->json('data');
        $this->assertSame([0, 1, 'INVALID_STATUS_TRANSITION'], [$again['succeeded'], $again['failed'], $again['results'][0]['error_code']]);

        // Another organization's order is just not found.
        $this->openStore('Other Shop', 'other.example.test');
        $other = $this->postJson('/api/v1/web-orders/bulk/process', ['order_ids' => [$b]], ['Idempotency-Key' => (string) Str::uuid()])->assertOk()->json('data');
        $this->assertSame([null, 'NOT_FOUND'], [$other['results'][0]['number'], $other['results'][0]['error_code']]);
    }

    public function test_print_packing_slips_and_invoices(): void
    {
        $this->inTenant($this->tenant['organization'], fn () => DB::table('organizations')->where('id', $this->tenant['organization']->id)->update([
            'legal_name' => 'Berry Kids Ltd.', 'tax_number' => 'BIN-123456', 'phone' => '+880 2 555', 'address' => 'House 1, Dhaka',
        ]));
        $a = $this->order(['JUICE' => 2, 'RICE' => 1]);
        $b = $this->order(['RICE' => 3]);
        $this->shipped($b);

        $this->getJson("/api/v1/web-orders/print?ids[]={$a}&kind=label")->assertStatus(422);
        $this->getJson('/api/v1/web-orders/print?kind=invoice')->assertStatus(422);

        $slip = $this->getJson("/api/v1/web-orders/print?ids[]={$b}&ids[]={$a}&kind=packing_slip")->assertOk()->json('data');
        $this->assertSame('packing_slip', $slip['kind']);
        $this->assertSame(['name' => 'Berry Kids', 'legal_name' => 'Berry Kids Ltd.', 'address' => 'House 1, Dhaka', 'phone' => '+880 2 555', 'email' => $slip['organization']['email'], 'tax_number' => 'BIN-123456', 'logo_url' => null], $slip['organization']);
        $this->assertSame([$b, $a], array_column($slip['orders'], 'id'));
        $first = $slip['orders'][0];
        $this->assertSame(['Pathao', 'TRK 1/A', 'Rina Akter', 'House 1, Road 2', 'Ring the bell', '3'], [$first['courier_name'], $first['tracking_number'], $first['contact']['name'], $first['shipping_address']['address_line'], $first['notes'], $first['item_count']]);
        $this->assertSame(['product_name', 'variant_name', 'sku', 'quantity'], array_keys($slip['orders'][1]['lines'][0]));
        $this->assertArrayNotHasKey('total', $slip['orders'][1]);
        $this->assertArrayNotHasKey('subtotal', $slip['orders'][1]);

        $invoice = $this->getJson("/api/v1/web-orders/print?ids[]={$a}&kind=invoice")->assertOk()->json('data.orders.0');
        $this->assertSame(['JUICE', '2', '120.00', '240.00', '0.00', '15.00', '36.00', '276.00'], array_values(array_intersect_key($invoice['lines'][0], array_flip(['sku', 'quantity', 'unit_price', 'line_subtotal', 'discount_amount', 'tax_rate', 'tax_amount', 'line_total']))));
        foreach (['currency', 'subtotal', 'discount_total', 'tax_total', 'shipping_total', 'shipping_discount', 'cod_fee', 'promotions', 'coupon_code', 'total', 'paid_total', 'balance_due'] as $key) {
            $this->assertArrayHasKey($key, $invoice);
        }
        $this->assertSame($invoice['total'], $invoice['balance_due']);

        // Printing records nothing; other organizations' orders are not found.
        $this->assertSame(0, DB::table('audit_logs')->where('action', 'like', '%print%')->count());
        $this->openStore('Other Shop', 'other.example.test');
        $this->getJson("/api/v1/web-orders/print?ids[]={$a}&kind=invoice")->assertNotFound();
        $cashier = $this->createUserWithRole($this->tenant['organization'], SystemRole::Cashier, [$this->tenant['store']->branch_id]);
        $this->actingAsUser($cashier);
        $this->getJson("/api/v1/web-orders/print?ids[]={$a}&kind=invoice")->assertForbidden();
    }

    public function test_cod_remittance_validation_payment_and_courier_fee(): void
    {
        $b = $this->order(['RICE' => 1]);
        $this->shipped($b, 'Pathao', true);
        $c = $this->order(['RICE' => 2]);
        $this->shipped($c, 'Pathao', true);
        $steadfast = $this->order(['RICE' => 1]);
        $this->shipped($steadfast, 'Steadfast', true);
        $inTransit = $this->order(['RICE' => 1]);
        $this->shipped($inTransit, 'Pathao');
        $bank = $this->order(['RICE' => 1], 'bank_transfer');
        $paid = $this->order(['RICE' => 1]);
        $this->shipped($paid, 'Pathao', true);
        $this->act($paid, 'record-cod-payment', ['reference' => 'rider'])->assertOk();
        $unknown = (string) Str::uuid();

        $body = fn (array $ids, array $extra = []) => $extra + [
            'courier_id' => $this->couriers['Pathao'],
            'reference' => 'PTH-STMT-9',
            'received_at' => now('Asia/Dhaka')->toDateString(),
            'method' => 'bank_transfer',
            'fee_amount' => '25.50',
            'order_ids' => $ids,
            'note' => 'Weekly statement',
        ];
        $post = fn (array $data, ?string $key = null) => $this->postJson('/api/v1/cod-remittances', $data, ['Idempotency-Key' => $key ?? (string) Str::uuid()]);

        $post($body([$b], ['method' => 'cheque']))->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['method']]]);
        $post($body([$b], ['received_at' => now('Asia/Dhaka')->addDays(2)->toDateString()]))->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['received_at']]]);
        $post($body([$b], ['fee_amount' => '-1']))->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['fee_amount']]]);
        $post($body([$b], ['courier_id' => (string) Str::uuid()]))->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['courier_id']]]);
        $this->postJson('/api/v1/cod-remittances', $body([$b]))->assertStatus(428);

        // All or nothing, with a reason per offending order.
        $invalid = $post($body([$b, $steadfast, $inTransit, $bank, $paid, $unknown]))->assertStatus(422)->assertJsonPath('error.code', 'REMITTANCE_INVALID')->json('error.details.orders');
        $this->assertSame([
            ['id' => $steadfast, 'number' => $this->number($steadfast), 'reason' => 'other_courier'],
            ['id' => $inTransit, 'number' => $this->number($inTransit), 'reason' => 'not_delivered'],
            ['id' => $bank, 'number' => $this->number($bank), 'reason' => 'not_cod'],
            ['id' => $paid, 'number' => $this->number($paid), 'reason' => 'already_paid'],
            ['id' => $unknown, 'number' => null, 'reason' => 'not_found'],
        ], $invalid);
        $this->assertSame('unpaid', Order::query()->withoutGlobalScopes()->find($b)->payment_status->value);
        $this->assertSame(0, CodRemittance::query()->withoutGlobalScopes()->count());

        // Fee above the collected amount.
        $totals = Order::query()->withoutGlobalScopes()->whereKey([$b, $c])->pluck('total', 'id')->map(fn ($t) => (string) $t);
        $gross = bcadd($totals[$b], $totals[$c], 2);
        $post($body([$b, $c], ['fee_amount' => bcadd($gross, '0.01', 2)]))->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['fee_amount']]]);

        $key = (string) Str::uuid();
        $remittance = $post($body([$c, $b]), $key)->assertCreated()->json('data');
        $this->assertSame(['REM-000001', 'Pathao', 'PTH-STMT-9', 'bank_transfer', $gross, '25.50', bcsub($gross, '25.50', 2), 2], [
            $remittance['number'], $remittance['courier']['name'], $remittance['reference'], $remittance['method'], $remittance['gross_amount'], $remittance['fee_amount'], $remittance['net_amount'], $remittance['order_count'],
        ]);
        $this->assertSame(collect([$b, $c])->sortBy(fn ($id) => $this->number($id))->values()->all(), array_column($remittance['lines'], 'order_id'));
        $this->assertSame('Weekly statement', $remittance['note']);
        $this->assertNotNull($remittance['expense']['number']);

        // Replay: same answer, nothing booked twice.
        $this->assertSame($remittance['id'], $post($body([$c, $b]), $key)->assertCreated()->assertHeader('Idempotent-Replayed', 'true')->json('data.id'));
        $post($body([$b]))->assertStatus(422)->assertJsonPath('error.details.orders.0.reason', 'already_paid');

        // Orders paid through the shared COD path; ledger and expense.
        foreach ([$b, $c] as $id) {
            $order = $this->getJson("/api/v1/web-orders/{$id}")->assertOk()->json('data');
            $this->assertSame(['paid', $order['total']], [$order['payment_status'], $order['paid_total']]);
            $this->assertSame([['cash_on_delivery', $order['total'], 'REM-000001']], array_map(fn ($p) => [$p['method'], $p['amount'], $p['reference']], $order['payments']));
            $this->assertSame(['id' => $remittance['id'], 'number' => 'REM-000001', 'received_at' => $remittance['received_at']], $order['cod_remittance']);
        }
        $ledger = Payment::query()->withoutGlobalScopes()->where('reference', 'REM-000001')->orderBy('source_type')->get();
        $rows = fn (iterable $r) => collect($r)->sortBy(fn (array $x) => implode('|', $x))->values()->all();
        $this->assertSame(
            $rows([['expense', 'out', 'cash_on_delivery', '25.50'], ['online_order', 'in', 'cash_on_delivery', $totals[$b]], ['online_order', 'in', 'cash_on_delivery', $totals[$c]]]),
            $rows($ledger->map(fn (Payment $p) => [$p->source_type, $p->direction->value, $p->method->value, (string) $p->amount])),
        );
        $this->assertSame(['expense', 'out', '25.50'], [$ledger[0]->source_type, $ledger[0]->direction->value, (string) $ledger[0]->amount]);
        $this->assertNull($ledger[0]->cash_register_session_id);
        $expense = Expense::query()->withoutGlobalScopes()->findOrFail($remittance['expense']['id']);
        $this->assertSame(['25.50', 'REM-000001', 'Pathao', 'cash_on_delivery', $remittance['received_at']], [(string) $expense->amount, $expense->reference, $expense->party, $expense->method->value, $expense->occurred_on->toDateString()]);
        $this->assertSame('Courier fees', ExpenseCategory::query()->withoutGlobalScopes()->findOrFail($expense->expense_category_id)->name);

        // A fee of zero books no expense; the category is reused when it exists.
        $d = $this->order(['RICE' => 1]);
        $this->shipped($d, 'Steadfast', true);
        $free = $post($body([$d, $steadfast], ['courier_id' => $this->couriers['Steadfast'], 'fee_amount' => '0', 'method' => 'cash', 'reference' => null]))->assertCreated()->json('data');
        $this->assertSame(['REM-000002', null, '0.00', 'cash'], [$free['number'], $free['expense'], $free['fee_amount'], $free['method']]);
        $this->assertSame(1, ExpenseCategory::query()->withoutGlobalScopes()->where('name', 'Courier fees')->count());

        // List and detail.
        $list = $this->getJson('/api/v1/cod-remittances')->assertOk();
        $this->assertSame(['REM-000002', 'REM-000001'], array_column($list->json('data'), 'number'));
        $this->assertSame(['id', 'number', 'courier', 'reference', 'received_at', 'method', 'method_label', 'currency', 'gross_amount', 'fee_amount', 'net_amount', 'order_count', 'created_at', 'created_by'], array_keys($list->json('data.0')));
        $this->assertSame(['REM-000001'], array_column($this->getJson('/api/v1/cod-remittances?courier_id='.$this->couriers['Pathao'])->json('data'), 'number'));
        $this->getJson('/api/v1/cod-remittances?date_from='.now('Asia/Dhaka')->addDay()->toDateString())->assertJsonPath('meta.pagination.total', 0);
        $this->getJson("/api/v1/cod-remittances/{$remittance['id']}")->assertOk()->assertJsonPath('data.number', 'REM-000001')->assertJsonCount(2, 'data.lines');
        $this->assertSame([], array_column($this->getJson('/api/v1/web-orders?cod_unremitted=1')->json('data'), 'id'));

        // Remittances are append-only; the courier is now in use.
        $this->deleteJson("/api/v1/shipping/couriers/{$this->couriers['Steadfast']}")->assertStatus(422)->assertJsonPath('error.code', 'IN_USE');
        $this->assertSame(1, CodRemittance::query()->withoutGlobalScopes()->where('number', 'REM-000001')->count());

        // Other organizations: no access, and their remittance sees our orders as not found.
        $this->openStore('Other Shop', 'other.example.test');
        $this->getJson("/api/v1/cod-remittances/{$remittance['id']}")->assertNotFound();
        $this->getJson('/api/v1/cod-remittances')->assertJsonPath('meta.pagination.total', 0);
        $mine = $this->postJson('/api/v1/shipping/couriers', ['name' => 'Pathao'])->json('data.id');
        $post($body([$b], ['courier_id' => $mine]))->assertStatus(422)->assertJsonPath('error.details.orders.0.reason', 'not_found');
        $post($body([$b]))->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['courier_id']]]);
    }

    public function test_remittance_permissions(): void
    {
        $b = $this->order(['RICE' => 1]);
        $this->shipped($b, 'Pathao', true);
        $manager = $this->createUserWithRole($this->tenant['organization'], SystemRole::OnlineStoreManager);
        $accountant = $this->createUserWithRole($this->tenant['organization'], SystemRole::Accountant);
        $cashier = $this->createUserWithRole($this->tenant['organization'], SystemRole::Cashier, [$this->tenant['store']->branch_id]);
        $data = [
            'courier_id' => $this->couriers['Pathao'], 'received_at' => now('Asia/Dhaka')->toDateString(), 'method' => 'mobile_banking',
            'fee_amount' => '10', 'order_ids' => [$b],
        ];

        $this->actingAsUser($cashier);
        $this->postJson('/api/v1/cod-remittances', $data, ['Idempotency-Key' => (string) Str::uuid()])->assertForbidden();

        $this->actingAsUser($accountant);
        $id = $this->postJson('/api/v1/cod-remittances', $data, ['Idempotency-Key' => (string) Str::uuid()])->assertCreated()->json('data.id');
        $this->assertSame($accountant->id, $this->getJson("/api/v1/cod-remittances/{$id}")->json('data.created_by.id'));
        $this->act($b, 'process')->assertForbidden();

        $this->actingAsUser($manager);
        $this->getJson("/api/v1/cod-remittances/{$id}")->assertOk()->assertJsonPath('data.expense.number', 'EXP-000001');
    }
}
