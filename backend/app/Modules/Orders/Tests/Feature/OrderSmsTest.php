<?php

namespace App\Modules\Orders\Tests\Feature;

use App\Modules\CustomerAccounts\Tests\Concerns\ActsAsShopper;
use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Orders\Application\Events\OrderStatusChanged;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Orders\Tests\Concerns\BuildsCheckout;
use App\Modules\Orders\Tests\Fakes\FakePhoneVerification;
use App\Modules\Orders\Tests\Fakes\FakeSmsSender;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Sms\Application\Contracts\PhoneVerification;
use App\Modules\Sms\Application\Contracts\SmsSender;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * BD1a §5: OrderStatusChanged after every status change (not placement) and the order text
 * messages handed to SmsSender::orderEvent (faked through its contract — templates, readiness
 * and de-duplication are the Sms module's): which events, to whom, in which language, with
 * which values and links; the workflow stands when SMS fails.
 */
class OrderSmsTest extends TestCase
{
    use ActsAsShopper, BuildsCheckout, BuildsOnlineCatalog, InteractsWithTenancy, RefreshDatabase;

    private FakeSmsSender $sms;

    private string $courier;

    protected function setUp(): void
    {
        parent::setUp();
        Notification::fake();
        $this->sms = new FakeSmsSender;
        $this->app->instance(SmsSender::class, $this->sms);
        $this->app->instance(PhoneVerification::class, new FakePhoneVerification);
        $this->buildShop();
        $this->actingAsUser($this->tenant['admin']);
        $this->courier = $this->postJson('/api/v1/shipping/couriers', [
            'name' => 'Pathao', 'tracking_url_template' => 'https://merchant.pathao.com/tracking?consignment_id={tracking}',
        ])->assertCreated()->json('data.id');
        $this->asVisitor();
    }

    /**
     * A guest order (cash on delivery: confirmed; bank transfer: awaiting payment).
     *
     * @return array{id: string, number: string, token: ?string}
     */
    private function order(string $payment = 'cod', string $lang = 'en', string $quantity = '2'): array
    {
        $this->clearBrowser();
        $this->addToCart('SHIRT', $quantity);
        $total = $this->previewCheckout(['address' => ['district_id' => self::DHAKA], 'shipping_method_id' => $this->methods['inside'], 'payment_method' => $payment])->json('data.total');
        $placed = $this->browse('POST', $this->storeUrl('checkout?lang='.$lang), $this->checkoutBody($total, ['payment_method' => $payment]), ['Idempotency-Key' => (string) Str::uuid()])
            ->assertCreated();
        $number = $placed->json('data.order.number');

        return ['id' => (string) Order::query()->withoutGlobalScopes()->where('number', $number)->value('id'), 'number' => $number, 'token' => $placed->json('data.access_token')];
    }

    /**
     * @param  array<string, mixed>  $body
     */
    private function act(string $orderId, string $action, array $body = []): TestResponse
    {
        $this->clearBrowser();
        $this->actingAsUser($this->tenant['admin']);

        return $this->postJson("/api/v1/web-orders/{$orderId}/{$action}", $body, ['Idempotency-Key' => (string) Str::uuid()]);
    }

    /**
     * Route controllers (and the catalog read models they hold) live as long as the test app.
     */
    private function forgetControllers(): void
    {
        foreach ($this->app['router']->getRoutes() as $route) {
            $route->controller = null;
        }
    }

    public function test_each_order_event_sends_one_message_with_its_values(): void
    {
        $order = $this->order(quantity: '3');
        $this->assertSame(['order_placed'], $this->sms->eventNames());
        $placed = $this->sms->events[0];
        $this->assertSame([$this->tenant['organization']->id, '01712345678', 'en', $order['id']], [$placed['org'], $placed['phone'], $placed['locale'], $placed['order_id']]);
        $this->assertSame('Rina Akter', $placed['vars']['name']);
        $this->assertSame($order['number'], $placed['vars']['order']);
        $this->assertSame('1,410.00', $placed['vars']['total']);
        // A guest's own order page with the one-time token (only now — the token exists only here).
        $this->assertSame('http://'.self::HOST.'/order/'.$order['number'].'?token='.$order['token'], $placed['vars']['link']);

        $this->act($order['id'], 'process')->assertOk();
        $this->assertSame(['order_placed'], $this->sms->eventNames());

        $this->act($order['id'], 'ship', ['courier_id' => $this->courier, 'tracking_number' => 'TRK 1/A'])->assertOk();
        $shipped = $this->sms->events[1];
        $this->assertSame('order_shipped', $shipped['event']);
        $this->assertSame(['Pathao', 'TRK 1/A', 'https://merchant.pathao.com/tracking?consignment_id=TRK%201%2FA'], [$shipped['vars']['courier'], $shipped['vars']['tracking'], $shipped['vars']['tracking_link']]);
        // Later messages link the "track my order" page of the store's primary domain.
        $this->assertSame('http://'.self::HOST.'/track-order?number='.$order['number'], $shipped['vars']['link']);

        $this->act($order['id'], 'deliver')->assertOk();
        $this->assertSame(['order_placed', 'order_shipped', 'order_delivered'], $this->sms->eventNames());
        $this->assertSame('1,410.00', $this->sms->events[2]['vars']['total']);
    }

    public function test_payment_confirmation_and_cancellations_in_the_orders_language(): void
    {
        $bank = $this->order('bank_transfer', 'bn');
        $this->assertSame('bn', $this->sms->events[0]['locale']);
        $this->act($bank['id'], 'confirm-payment', ['reference' => 'TXN-1'])->assertOk();
        $this->assertSame(['order_placed', 'order_confirmed'], $this->sms->eventNames());
        $this->assertSame('bn', $this->sms->events[1]['locale']);

        // Staff cancel (a COD order confirmed at placement: no "confirmed" message for it).
        $cod = $this->order();
        $this->act($cod['id'], 'cancel', ['reason' => 'Out of stock'])->assertOk();
        $this->assertSame(['order_placed', 'order_confirmed', 'order_placed', 'order_cancelled'], $this->sms->eventNames());
        $this->assertSame($cod['id'], $this->sms->events[3]['order_id']);

        // The expiry job cancels unpaid bank transfers.
        $this->order('bank_transfer');
        $this->travel(49)->hours();
        $this->artisan('orders:expire-pending')->assertSuccessful();
        $this->assertSame('order_cancelled', $this->sms->events[5]['event']);

        // A failed step announces nothing.
        $count = count($this->sms->events);
        $this->act($cod['id'], 'cancel', ['reason' => 'Again'])->assertStatus(422);
        $this->assertCount($count, $this->sms->events);
    }

    public function test_status_changes_are_dispatched_after_commit(): void
    {
        Event::fake([OrderStatusChanged::class]);
        $bank = $this->order('bank_transfer');
        Event::assertNotDispatched(OrderStatusChanged::class);

        $this->act($bank['id'], 'confirm-payment', ['reference' => 'TXN-1'])->assertOk();
        $this->act($bank['id'], 'process')->assertOk();
        $this->act($bank['id'], 'cancel', ['reason' => 'Customer asked', 'refund' => ['method' => 'bank_transfer', 'reference' => 'R1']])->assertOk();

        Event::assertDispatched(OrderStatusChanged::class, fn (OrderStatusChanged $e) => [$e->orderId, $e->from, $e->to, $e->actorType] === [$bank['id'], 'pending_payment', 'confirmed', 'staff']);
        Event::assertDispatched(OrderStatusChanged::class, fn (OrderStatusChanged $e) => [$e->from, $e->to] === ['confirmed', 'processing']
            && $e->organizationId === $this->tenant['organization']->id);
        Event::assertDispatched(OrderStatusChanged::class, fn (OrderStatusChanged $e) => [$e->from, $e->to, $e->actorType] === ['processing', 'cancelled', 'staff']);
        Event::assertDispatchedTimes(OrderStatusChanged::class, 3);
    }

    public function test_the_workflow_stands_when_sms_fails(): void
    {
        $this->sms->throws = true;
        $order = $this->order();
        $this->act($order['id'], 'process')->assertOk();
        $this->act($order['id'], 'ship', ['courier_id' => $this->courier])->assertOk();
        $this->act($order['id'], 'deliver')->assertOk()->assertJsonPath('data.status', 'delivered');
        $this->assertSame([], $this->sms->events);
    }

    public function test_account_orders_link_the_tracking_page_and_stay_in_their_store(): void
    {
        $this->registerShopper(self::HOST);
        $this->addToCart('SHIRT', 1);
        $this->placeOrder($this->checkoutBody('510.00'))->assertCreated();
        $this->assertSame('http://'.self::HOST.'/track-order?number=WEB-000001', $this->sms->events[0]['vars']['link']);

        // Another store's order goes out under that store.
        $a = $this->tenant['organization']->id;
        $this->clearBrowser();
        $this->buildShop('Tiny Shop', 'tiny.test');
        $this->forgetControllers();
        $this->addToCart('SHIRT', 1, 'tiny.test');
        $this->placeOrder($this->checkoutBody('510.00'), null, 'tiny.test')->assertCreated();
        $this->assertSame([$a, $this->tenant['organization']->id], array_column($this->sms->events, 'org'));
        $this->assertNotSame($a, $this->tenant['organization']->id);
        $this->assertStringStartsWith('http://tiny.test/order/WEB-000001?token=', $this->sms->events[1]['vars']['link']);
    }
}
