<?php

namespace App\Modules\Orders\Tests\Feature;

use App\Modules\CustomerAccounts\Tests\Concerns\ActsAsShopper;
use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Orders\Tests\Concerns\BuildsCheckout;
use App\Modules\Orders\Tests\Fakes\FakePhoneVerification;
use App\Modules\Orders\Tests\Fakes\FakeSmsSender;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Sms\Application\Contracts\PhoneVerification;
use App\Modules\Sms\Application\Contracts\SmsSender;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * BD1a §6: "track my order" without an account — order number + contact or delivery mobile
 * number; a lean answer (no name, address, lines or e-mail); the same 404 for anything else;
 * per store; 10 lookups a minute per IP.
 */
class TrackOrderTest extends TestCase
{
    use ActsAsShopper, BuildsCheckout, BuildsOnlineCatalog, InteractsWithTenancy, RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Notification::fake();
        $this->app->instance(SmsSender::class, new FakeSmsSender);
        $this->app->instance(PhoneVerification::class, new FakePhoneVerification);
        $this->buildShop();
    }

    private function track(string $number, string $phone, string $host = self::HOST): TestResponse
    {
        return $this->browse('GET', $this->storeUrl('orders/track?'.http_build_query(['number' => $number, 'phone' => $phone]), $host));
    }

    private function placeGuestOrder(string $contactPhone = '01712345678', string $addressPhone = '+880 1712-345678', string $host = self::HOST): string
    {
        $this->clearBrowser();
        $this->addToCart('SHIRT', 2, $host);
        $address = ['phone' => $addressPhone] + $this->inlineAddress();

        return $this->placeOrder($this->checkoutBody('960.00', ['contact' => ['name' => 'Rina Akter', 'phone' => $contactPhone], 'address' => $address]), null, $host)
            ->assertCreated()->json('data.order.number');
    }

    public function test_an_order_is_found_by_its_number_and_mobile_number(): void
    {
        $number = $this->placeGuestOrder('01712345678', '01812345678');

        $data = $this->track(strtolower($number), '+880 1712-345678')->assertOk()->assertHeader('Cache-Control', 'no-store, private')->json('data');
        $this->assertSame(['number', 'status', 'payment_method', 'payment_status', 'placed_at', 'total', 'currency', 'item_count', 'history', 'shipment'], array_keys($data));
        $this->assertSame([$number, 'confirmed', 'cod', 'unpaid', '960.00', 2, null], [
            $data['number'], $data['status'], $data['payment_method'], $data['payment_status'], $data['total'], $data['item_count'], $data['shipment'],
        ]);
        $this->assertSame(['confirmed'], array_column($data['history'], 'status'));
        $this->assertStringNotContainsString('Rina', json_encode($data));
        $this->assertStringNotContainsString('Dhanmondi', json_encode($data));

        // The delivery number works too.
        $this->track($number, '01812345678')->assertOk();

        // The courier parcel once shipped.
        $this->actingAsUser($this->tenant['admin']);
        $courier = $this->postJson('/api/v1/shipping/couriers', ['name' => 'Pathao', 'tracking_url_template' => 'https://track.example.test/{tracking}'])->assertCreated()->json('data.id');
        $id = Order::query()->withoutGlobalScopes()->where('number', $number)->value('id');
        $this->postJson("/api/v1/web-orders/{$id}/process", [], ['Idempotency-Key' => (string) Str::uuid()])->assertOk();
        $this->postJson("/api/v1/web-orders/{$id}/ship", ['courier_id' => $courier, 'tracking_number' => 'P123'], ['Idempotency-Key' => (string) Str::uuid()])->assertOk();
        $this->asVisitor();

        $shipped = $this->track($number, '01712345678')->assertOk()->json('data');
        $this->assertSame('shipped', $shipped['status']);
        $this->assertSame(['confirmed', 'processing', 'shipped'], array_column($shipped['history'], 'status'));
        $this->assertSame(['courier_name' => 'Pathao', 'tracking_number' => 'P123', 'tracking_url' => 'https://track.example.test/P123', 'status' => 'handed_over'], $shipped['shipment']);
    }

    public function test_anything_else_is_the_same_not_found(): void
    {
        $number = $this->placeGuestOrder();

        foreach ([[$number, '01912345678'], ['WEB-999999', '01712345678']] as [$n, $phone]) {
            $this->track($n, $phone)->assertStatus(404)->assertJsonPath('error.code', 'ORDER_NOT_FOUND');
        }
        $this->browse('GET', $this->storeUrl('orders/track?number='.$number))->assertStatus(422)->assertJsonValidationErrors(['phone'], 'error.details');
        $this->track($number, 'not a phone')->assertStatus(404)->assertJsonPath('error.code', 'ORDER_NOT_FOUND');

        // Another store with the same order number and phone: only its own order.
        $this->buildShop('Tiny Shop', 'tiny.test');
        foreach ($this->app['router']->getRoutes() as $route) {
            // Route controllers (and the catalog read models they hold) live as long as the test app.
            $route->controller = null;
        }
        $this->track($number, '01712345678', 'tiny.test')->assertStatus(404);
        $this->assertSame($number, $this->placeGuestOrder('01712345678', '01712345678', 'tiny.test'));
        $this->track($number, '01712345678', 'tiny.test')->assertOk()->assertJsonPath('data.total', '960.00');
        $this->assertSame(2, Order::query()->withoutGlobalScopes()->where('number', $number)->count());
    }

    public function test_the_track_order_page_is_served_and_never_indexed(): void
    {
        $shell = (string) tempnam(sys_get_temp_dir(), 'shell');
        file_put_contents($shell, '<!doctype html><html><head><title>Storefront</title></head><body><div id="root"></div></body></html>');
        config(['storefront.shell_path' => $shell]);

        try {
            $html = $this->get('http://'.self::HOST.'/track-order?number=WEB-000001')->assertOk()->assertHeader('X-Robots-Tag', 'noindex')->getContent();
            $this->assertStringContainsString('<meta name="robots" content="noindex, follow">', $html);
            $this->assertStringContainsString('Track your order | Berry Kids', $html);
        } finally {
            @unlink($shell);
        }
    }

    public function test_lookups_are_rate_limited_per_ip(): void
    {
        RateLimiter::clear('order-track:127.0.0.1');
        foreach (range(1, 10) as $ignored) {
            $this->track('WEB-000001', '01712345678')->assertStatus(404);
        }
        $this->track('WEB-000001', '01712345678')->assertStatus(429);
    }
}
