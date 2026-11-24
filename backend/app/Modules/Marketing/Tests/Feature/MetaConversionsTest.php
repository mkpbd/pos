<?php

namespace App\Modules\Marketing\Tests\Feature;

use App\Modules\CustomerAccounts\Tests\Concerns\ActsAsShopper;
use App\Modules\Marketing\Infrastructure\Jobs\SendMetaPurchaseJob;
use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Orders\Tests\Concerns\BuildsCheckout;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use Illuminate\Contracts\Queue\ShouldBeEncrypted;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * BD1c: ad click ids kept on shop and landing-page orders (pixel cookies, click ids of the
 * attribution) and the queued Conversions API `Purchase` — hashed customer data, the order
 * number as the dedupe id, the test event code, skipped for staff orders and while off, the
 * token never logged, and each organization's own settings only.
 */
class MetaConversionsTest extends TestCase
{
    use ActsAsShopper, BuildsCheckout, BuildsOnlineCatalog, InteractsWithTenancy, RefreshDatabase;

    private const TOKEN = 'EAAG-SECRET-TOKEN-123456';

    private const PIXEL = '123456789012345';

    private const GRAPH = 'https://graph.facebook.com/v21.0/123456789012345/events';

    /** @var list<array{message: string, context: array<string, mixed>}> */
    private array $logged = [];

    /** @var array{0: mixed, 1: int} what the fake Graph API answers */
    private array $graph = [['events_received' => 1, 'fbtrace_id' => 'x'], 200];

    protected function setUp(): void
    {
        parent::setUp();
        Notification::fake();
        Http::preventStrayRequests();
        Http::fake(['graph.facebook.com/*' => fn () => Http::response(...$this->graph)]);
        Event::listen(MessageLogged::class, function (MessageLogged $e) {
            $this->logged[] = ['message' => $e->message, 'context' => $e->context];
        });
        $this->buildShop();
    }

    /**
     * @param  array<string, mixed>  $settings
     */
    private function track(array $settings = []): void
    {
        $this->clearBrowser();
        $this->actingAsUser($this->tenant['admin']);
        $this->patchJson('/api/v1/marketing/tracking', $settings + [
            'meta_pixel_id' => self::PIXEL, 'meta_capi_enabled' => true, 'meta_capi_token' => self::TOKEN,
        ])->assertOk();
        $this->clearBrowser();
    }

    /**
     * A guest buys one shirt (450 + 60 delivery inside Dhaka) with the given cookies.
     *
     * @param  array<string, string>  $cookies
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed> the placed order
     */
    private function buyShirt(array $cookies = [], array $overrides = []): array
    {
        $this->clearBrowser();
        $this->jar = $cookies;
        $this->addToCart('SHIRT', 1);

        return $this->placeOrder($this->checkoutBody('510.00', $overrides), null)->assertCreated()->json('data.order');
    }

    private function orderId(string $number): string
    {
        return (string) DB::table('orders')->where('number', $number)->value('id');
    }

    /**
     * @return array<string, mixed>|null
     */
    private function trackingIds(string $number): ?array
    {
        $raw = DB::table('orders')->where('number', $number)->value('tracking_ids');

        return $raw === null ? null : json_decode((string) $raw, true);
    }

    public function test_click_ids_are_kept_on_shop_orders(): void
    {
        // Pixel cookies (not encrypted by the app) and click ids in the attribution.
        $order = $this->buyShirt(['_fbp' => 'fb.1.1700000000000.1234567890', '_ttp' => 'ttp-abc_123', 'other' => 'ignored'], [
            'attribution' => ['utm_source' => 'facebook', 'landing_path' => '/product/shirt?fbclid=IwAR0abc&gclid=Cj0KCQ', 'ttclid' => 'E.C.P.tt1'],
        ]);
        $ids = $this->trackingIds($order['number']);
        $this->assertSame('fb.1.1700000000000.1234567890', $ids['fbp']);
        $this->assertSame('ttp-abc_123', $ids['ttp']);
        $this->assertSame('Cj0KCQ', $ids['gclid']);
        $this->assertSame('E.C.P.tt1', $ids['ttclid']);
        // No _fbc cookie: built from the fbclid (Meta's format).
        $this->assertMatchesRegularExpression('/^fb\.1\.\d{13}\.IwAR0abc$/', $ids['fbc']);
        $this->assertArrayNotHasKey('other', $ids);
        // The attribution itself is unchanged (no query string, no click ids).
        $attribution = json_decode((string) DB::table('orders')->where('number', $order['number'])->value('attribution'), true);
        $this->assertSame(['utm_source' => 'facebook', 'landing_path' => '/product/shirt'], $attribution);

        // An _fbc cookie wins over a fbclid; invalid or over-long values are dropped.
        $order = $this->buyShirt(['_fbc' => 'fb.1.1700000000000.FROMCOOKIE', '_fbp' => str_repeat('a', 201), '_ttp' => '<script>'], [
            'attribution' => ['fbclid' => 'IGNORED', 'gclid' => 'bad value'],
        ]);
        $this->assertSame(['fbc' => 'fb.1.1700000000000.FROMCOOKIE'], $this->trackingIds($order['number']));

        // Nothing at all → null.
        $order = $this->buyShirt();
        $this->assertNull($this->trackingIds($order['number']));
    }

    public function test_a_shop_order_is_reported_to_the_conversions_api(): void
    {
        $this->track(['meta_test_event_code' => 'TEST777']);
        $order = $this->buyShirt(['_fbp' => 'fb.1.1700000000000.1234567890', '_fbc' => 'fb.1.1700000000000.IwAR0abc']);

        Http::assertSentCount(1);
        $district = (string) DB::table('order_addresses')->where('order_id', $this->orderId($order['number']))->value('district_name');
        $customerId = DB::table('orders')->where('number', $order['number'])->value('customer_id');
        $this->assertNull($customerId);
        Http::assertSent(function (HttpRequest $request) use ($order, $district) {
            $body = json_decode($request->body(), true);
            $event = $body['data'][0];
            $user = $event['user_data'];
            $custom = $event['custom_data'];

            $this->assertSame(self::GRAPH, $request->url());
            $this->assertStringNotContainsString(self::TOKEN, $request->url());
            $this->assertSame(self::TOKEN, $body['access_token']);
            $this->assertSame('TEST777', $body['test_event_code']);
            $this->assertSame('Purchase', $event['event_name']);
            // The browser pixel sends the order number as its eventID: Meta counts the order once.
            $this->assertSame($order['number'], $event['event_id']);
            $this->assertSame('website', $event['action_source']);
            $this->assertSame('http://'.self::HOST.'/order/'.$order['number'], $event['event_source_url']);
            $this->assertSame((int) DB::table('orders')->where('number', $order['number'])->selectRaw('extract(epoch from placed_at)::bigint as t')->value('t'), $event['event_time']);

            $this->assertSame([hash('sha256', 'rina@example.test')], $user['em']);
            $this->assertSame([hash('sha256', '8801712345678')], $user['ph']);
            $this->assertSame([hash('sha256', 'rina')], $user['fn']);
            $this->assertSame([hash('sha256', 'akter')], $user['ln']);
            $this->assertSame([hash('sha256', mb_strtolower(str_replace(' ', '', $district)))], $user['ct']);
            $this->assertSame([hash('sha256', 'bd')], $user['country']);
            $this->assertArrayNotHasKey('external_id', $user);
            $this->assertSame('127.0.0.1', $user['client_ip_address']);
            $this->assertSame('fb.1.1700000000000.1234567890', $user['fbp']);
            $this->assertSame('fb.1.1700000000000.IwAR0abc', $user['fbc']);

            $this->assertSame(['currency' => 'BDT', 'value' => 510.0, 'content_ids' => ['SHIRT'], 'content_type' => 'product', 'num_items' => 1, 'order_id' => $order['number']], $custom);
            // The value is a JSON number written from the decimal string.
            $this->assertStringContainsString('"value":510.00', $request->body());

            return true;
        });

        $settings = DB::table('tracking_settings')->first();
        $this->assertSame(['sent', null], [$settings->capi_last_status, $settings->capi_last_error]);
        $this->assertNotNull($settings->capi_last_sent_at);
        $this->assertStringNotContainsString(self::TOKEN, (string) json_encode($this->logged));
    }

    public function test_a_signed_in_customer_is_sent_as_an_external_id(): void
    {
        $this->track();
        $this->clearBrowser();
        $this->registerShopper(self::HOST);
        $this->addToCart('SHIRT', 1);
        $order = $this->placeOrder($this->checkoutBody('510.00'))->assertCreated()->json('data.order');

        $customerId = (string) DB::table('orders')->where('number', $order['number'])->value('customer_id');
        Http::assertSent(fn (HttpRequest $r) => json_decode($r->body(), true)['data'][0]['user_data']['external_id'] === [hash('sha256', strtolower($customerId))]);
    }

    public function test_the_job_is_queued_encrypted(): void
    {
        $this->track();
        Queue::fake();
        $order = $this->buyShirt();

        Queue::assertPushed(SendMetaPurchaseJob::class, fn (SendMetaPurchaseJob $job) => $job->orderId === $this->orderId($order['number'])
            && $job->organizationId === $this->tenant['organization']->id
            && $job->siteUrl === 'http://'.self::HOST
            && $job->tries === 3);
        $this->assertContains(ShouldBeEncrypted::class, class_implements(SendMetaPurchaseJob::class));
    }

    public function test_nothing_is_sent_while_off_or_for_staff_orders(): void
    {
        // Never set up, then a pixel without the Conversions API.
        $this->buyShirt();
        $this->track(['meta_capi_enabled' => false]);
        $this->buyShirt();
        Http::assertNothingSent();

        // Staff-entered orders are never reported (and keep no click ids).
        $this->track(['meta_capi_enabled' => true]);
        $this->clearBrowser();
        $this->actingAsUser($this->tenant['admin']);
        $staff = $this->withUnencryptedCookie('_fbp', 'fb.1.1700000000000.99')->postJson('/api/v1/web-orders', [
            'contact' => ['name' => 'Karim Uddin', 'phone' => '01812345678'],
            'lines' => [['variant_id' => $this->v['SHIRT'], 'quantity' => '1']],
            'address' => ['recipient_name' => 'Karim Uddin', 'phone' => '01812345678', 'division_id' => self::DHAKA_DIVISION, 'district_id' => self::DHAKA, 'area' => 'Mirpur', 'address_line' => 'House 9'],
            'shipping_method_id' => $this->methods['inside'],
            'payment_method' => 'cod',
            'channel' => 'phone',
            'expected_total' => '510.00',
        ], ['Idempotency-Key' => (string) Str::uuid()])->assertCreated()->json('data');
        $this->assertNull($this->trackingIds($staff['number']));
        Http::assertNothingSent();
        $this->assertNull(DB::table('tracking_settings')->value('capi_last_status'));
    }

    public function test_a_refused_event_is_recorded_without_the_token(): void
    {
        $this->graph = [['error' => ['message' => 'Invalid parameter for token '.self::TOKEN, 'code' => 100]], 400];
        $this->track();
        $this->buyShirt();

        $settings = DB::table('tracking_settings')->first();
        $this->assertSame('failed', $settings->capi_last_status);
        $this->assertStringStartsWith('http_400: Invalid parameter', (string) $settings->capi_last_error);
        $this->assertStringNotContainsString(self::TOKEN, (string) $settings->capi_last_error);
        $this->assertStringNotContainsString(self::TOKEN, (string) json_encode($this->logged));
        // The order stands.
        $this->assertSame(1, DB::table('orders')->count());
    }

    public function test_landing_page_orders_keep_click_ids_and_are_reported(): void
    {
        $this->track();
        $this->clearBrowser();
        $this->actingAsUser($this->tenant['admin']);
        $shirt = (string) DB::table('product_variants')->where('id', $this->v['SHIRT'])->value('product_id');
        $docs = '/api/v1/storefront/builder/documents';
        $id = $this->postJson($docs, ['kind' => 'page', 'key' => 'landing:shirt-offer', 'title' => 'Offer'])->assertCreated()->json('data.id');
        $this->putJson("{$docs}/{$id}/draft", ['revision' => 0, 'content' => ['schema_version' => 1, 'sections' => [[
            'id' => 's_main', 'type' => 'section',
            'columns' => [['id' => 'c_main', 'width' => ['base' => 100], 'elements' => [[
                'id' => 'e_order', 'type' => 'order_form', 'props' => [
                    'product_id' => $shirt, 'title' => 'Order now', 'quantity' => ['default' => 1, 'max' => 3],
                    'fields' => ['email' => 'optional', 'note' => 'optional'], 'payment' => 'cod_only',
                    'button_label' => 'Confirm order', 'success_message' => 'Thank you!',
                ],
            ]]]],
        ]]]])->assertOk();
        $this->postJson("{$docs}/{$id}/publish")->assertOk();
        $this->clearBrowser();

        $order = $this->browse('POST', $this->storeUrl('checkout/direct'), [
            'document_id' => $id,
            'element_id' => 'e_order',
            'lines' => [['variant_id' => $this->v['SHIRT'], 'quantity' => 1]],
            'contact' => ['name' => 'Rina', 'phone' => '01712345678'],
            'address' => ['district_id' => self::DHAKA, 'address_line' => 'House 1, Road 2'],
            'shipping_method_id' => $this->methods['inside'],
            'payment_method' => 'cod',
            'expected_total' => '510.00',
            'attribution' => ['utm_source' => 'facebook', 'landing_path' => '/p/shirt-offer?fbclid=IwAR9xyz&ttclid=TT1'],
        ], ['Idempotency-Key' => (string) Str::uuid()])->assertCreated()->json('data.order');

        $ids = $this->trackingIds($order['number']);
        $this->assertMatchesRegularExpression('/^fb\.1\.\d{13}\.IwAR9xyz$/', $ids['fbc']);
        $this->assertSame('TT1', $ids['ttclid']);

        Http::assertSentCount(1);
        Http::assertSent(function (HttpRequest $request) use ($order, $ids) {
            $event = json_decode($request->body(), true)['data'][0];

            return $event['event_id'] === $order['number']
                && $event['event_source_url'] === 'http://'.self::HOST.'/p/shirt-offer'
                && $event['user_data']['fbc'] === $ids['fbc']
                && $event['user_data']['fn'] === [hash('sha256', 'rina')]
                && ! isset($event['user_data']['ln'], $event['user_data']['em'])
                && ! isset($event['test_event_code']);
        });
    }

    public function test_each_organization_reports_with_its_own_settings_only(): void
    {
        // Berry Kids reports; Other Shop (no tracking) places an order → nothing for Berry's pixel.
        $this->track();
        $berry = $this->tenant;
        $this->buildShop('Other Shop', 'other.example.test');
        $this->addToCart('SHIRT', 1, 'other.example.test');
        $this->placeOrder($this->checkoutBody('510.00'), null, 'other.example.test')->assertCreated();
        Http::assertNothingSent();

        $this->assertSame(1, DB::table('tracking_settings')->count());
        $this->assertSame($berry['organization']->id, DB::table('tracking_settings')->value('organization_id'));
    }
}
