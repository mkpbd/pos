<?php

namespace App\Modules\Marketing\Tests\Feature;

use App\Modules\CustomerAccounts\Tests\Concerns\ActsAsShopper;
use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Orders\Tests\Concerns\BuildsCheckout;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use Carbon\CarbonImmutable;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * B15: store builder pages report views, clicks, scroll depth and Web Vitals in beacons that are
 * folded into daily counts without personal data; orders keep the builder page and section they
 * came from; staff read insights per page and for the Pages list — per organization.
 */
class PageInsightsTest extends TestCase
{
    use ActsAsShopper, BuildsCheckout, BuildsOnlineCatalog, InteractsWithTenancy, RefreshDatabase;

    private const DOCS = '/api/v1/storefront/builder/documents';

    private const BROWSER = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36';

    private const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36';

    private string $page;

    protected function setUp(): void
    {
        parent::setUp();
        Notification::fake();
        $this->buildShop();
        $this->page = $this->publishedPage('eid');
    }

    private function staff(): void
    {
        $this->clearBrowser();
        $this->actingAsUser($this->tenant['admin']);
    }

    /**
     * @return list<array<string, mixed>>
     */
    private static function sections(string $title = 'Eid offers'): array
    {
        $section = fn (string $id, array $props = []) => ['id' => $id, 'type' => 'section', 'props' => $props, 'columns' => [[
            'id' => 'c'.substr($id, 1), 'width' => ['base' => 100], 'elements' => [['id' => 'e'.substr($id, 1), 'type' => 'heading', 'props' => ['text' => $title]]],
        ]]];

        return [$section('s_hero', ['anchor' => 'hero']), $section('s_offer'), $section('s_end')];
    }

    private function publishedPage(string $slug): string
    {
        $this->staff();
        $id = $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'landing:'.$slug, 'title' => 'Eid sale'])->assertCreated()->json('data.id');
        $this->putJson(self::DOCS."/{$id}/draft", ['revision' => 0, 'content' => ['schema_version' => 1, 'sections' => self::sections()]])->assertOk();
        $this->postJson(self::DOCS."/{$id}/publish")->assertOk();
        $this->asVisitor();

        return $id;
    }

    /**
     * @param  array<string, mixed>  $body
     */
    private function beacon(array $body, string $agent = self::BROWSER, string $ip = '203.0.113.5', string $host = self::HOST): TestResponse
    {
        $this->clearBrowser();
        $this->asVisitor();

        return $this->withServerVariables(['REMOTE_ADDR' => $ip])
            ->postJson("http://{$host}/api/v1/store/insights/events", $body + [
                'document_id' => $this->page, 'version' => 1, 'path' => '/p/eid', 'device' => 'mobile', 'seq' => 0,
            ], ['User-Agent' => $agent]);
    }

    /**
     * Two shoppers: one on a phone (two page views, the first with two beacons), one on a
     * desktop (sent as text/plain, as some sendBeacon calls do).
     */
    private function collect(): void
    {
        $this->beacon(['events' => [
            ['t' => 'view', 'node' => 's_hero'],
            ['t' => 'view', 'node' => 's_offer'],
            ['t' => 'view', 'node' => 's_hero'],
            ['t' => 'view', 'node' => 'nope'],
            ['t' => 'click', 'node' => 's_hero', 'el' => 'e_hero', 'x' => 0.42, 'y' => 0.8],
            ['t' => 'click', 'node' => 's_hero'],
            ['t' => 'scroll', 'node' => 's_hero'],
            'garbage',
        ], 'scroll' => 50])->assertStatus(202)->assertJsonPath('data', ['recorded' => true, 'accepted' => 3, 'ignored' => 5]);
        $this->beacon(['seq' => 1, 'events' => [
            ['t' => 'view', 'node' => 's_offer'],
            ['t' => 'click', 'node' => 's_offer', 'x' => 1, 'y' => 0],
        ], 'scroll' => 100, 'scroll_from' => 50, 'vitals' => ['lcp_ms' => 2400, 'cls' => 0.1, 'inp_ms' => 180]])
            ->assertJsonPath('data', ['recorded' => true, 'accepted' => 2, 'ignored' => 0]);
        // The same phone opens the page again: a page view, not a new visitor.
        $this->beacon([])->assertJsonPath('data', ['recorded' => true, 'accepted' => 0, 'ignored' => 0]);

        $this->clearBrowser();
        $this->asVisitor();
        $this->call('POST', 'http://'.self::HOST.'/api/v1/store/insights/events', [], [], [], [
            'CONTENT_TYPE' => 'text/plain;charset=UTF-8', 'HTTP_USER_AGENT' => self::DESKTOP, 'REMOTE_ADDR' => '198.51.100.7',
        ], (string) json_encode([
            'document_id' => strtoupper($this->page), 'version' => 1, 'path' => '/p/eid', 'device' => 'desktop', 'seq' => 0,
            'events' => [['t' => 'view', 'node' => 's_hero'], ['t' => 'click', 'node' => 's_hero', 'x' => 0.41, 'y' => 0.82]],
            'vitals' => ['lcp_ms' => 4100, 'cls' => 0.3, 'inp_ms' => 600],
        ]))->assertStatus(202)->assertJsonPath('data.recorded', true);
    }

    /**
     * A guest order of one shirt (510.00 with delivery); the builder page sent with add to cart
     * and / or with the checkout.
     *
     * @param  array<string, mixed>|null  $cartBuilder
     * @param  array<string, mixed>|null  $attribution
     */
    private function orderWith(?array $cartBuilder, ?array $attribution): string
    {
        $this->clearBrowser();
        $this->asVisitor();
        $this->browse('POST', $this->storeUrl('cart/items'), ['variant_id' => $this->v['SHIRT'], 'quantity' => 1]
            + ($cartBuilder === null ? [] : ['attribution' => ['builder' => $cartBuilder]]))->assertOk();

        return $this->placeOrder($this->checkoutBody('510.00', $attribution === null ? [] : ['attribution' => $attribution]))->assertCreated()->json('data.order.number');
    }

    private function attributionOf(string $number): mixed
    {
        return Order::query()->withoutGlobalScopes()->where('number', $number)->firstOrFail()->attribution;
    }

    public function test_beacons_are_counted_per_day_section_and_cell_without_personal_data(): void
    {
        $this->collect();
        $timezone = $this->tenant['organization']->fresh()->timezone;
        $today = CarbonImmutable::now($timezone)->toDateString();

        $pages = DB::table('builder_page_stats')->orderBy('device')->get();
        $this->assertCount(2, $pages);
        $this->assertSame(
            [['desktop', 1, 1, 0, 0, 0, 0], ['mobile', 2, 1, 1, 1, 1, 1]],
            $pages->map(fn ($r) => [$r->device, (int) $r->views, (int) $r->unique_visitors, (int) $r->scroll_25, (int) $r->scroll_50, (int) $r->scroll_75, (int) $r->scroll_100])->all(),
        );
        $this->assertSame($today, substr((string) $pages[0]->day, 0, 10));
        $this->assertSame($this->page, $pages[0]->document_id);

        $sections = DB::table('builder_section_stats')->orderBy('device')->orderBy('node_id')->get()
            ->map(fn ($r) => [$r->device, $r->node_id, (int) $r->views, (int) $r->clicks])->all();
        $this->assertSame([['desktop', 's_hero', 1, 1], ['mobile', 's_hero', 1, 1], ['mobile', 's_offer', 2, 1]], $sections);
        $cells = DB::table('builder_click_cells')->orderBy('device')->orderBy('node_id')->get()
            ->map(fn ($r) => [$r->device, $r->node_id, (int) $r->cx, (int) $r->cy, (int) $r->clicks])->all();
        $this->assertSame([['desktop', 's_hero', 8, 16, 1], ['mobile', 's_hero', 8, 16, 1], ['mobile', 's_offer', 19, 0, 1]], $cells);
        $vitals = DB::table('builder_vital_buckets')->orderBy('device')->orderBy('metric')->get()
            ->map(fn ($r) => [$r->device, $r->metric, (int) $r->bucket, (int) $r->samples])->all();
        $this->assertSame([
            ['desktop', 'cls', 30, 1], ['desktop', 'inp', 24, 1], ['desktop', 'lcp', 41, 1],
            ['mobile', 'cls', 10, 1], ['mobile', 'inp', 8, 1], ['mobile', 'lcp', 24, 1],
        ], $vitals);

        // Nothing personal: only salted hashes, no address, browser or path anywhere.
        $hashes = DB::table('builder_visitor_hashes')->get();
        $this->assertCount(2, $hashes);
        foreach ($hashes as $hash) {
            $this->assertMatchesRegularExpression('/^[0-9a-f]{64}$/', $hash->hash);
        }
        foreach (['builder_page_stats', 'builder_section_stats', 'builder_click_cells', 'builder_vital_buckets', 'builder_visitor_hashes'] as $table) {
            $dump = json_encode(DB::table($table)->get());
            foreach (['203.0.113.5', '198.51.100.7', 'Mozilla', '/p/eid', 'e_hero'] as $secret) {
                $this->assertStringNotContainsString($secret, (string) $dump, $table);
            }
        }
        $this->assertSame([], array_values(array_filter(DB::getSchemaBuilder()->getColumnListing('builder_page_stats'), fn ($c) => in_array($c, ['ip', 'user_agent', 'path'], true))));
    }

    public function test_beacons_are_validated_against_the_published_version(): void
    {
        // Bots, unknown versions, unpublished and unknown documents are not recorded.
        $this->beacon(['events' => [['t' => 'view', 'node' => 's_hero']]], agent: 'facebookexternalhit/1.1')
            ->assertStatus(202)->assertJsonPath('data', ['recorded' => false, 'accepted' => 0, 'ignored' => 1]);
        $this->beacon(['version' => 2])->assertJsonPath('data.recorded', false);
        $this->beacon(['document_id' => (string) Str::uuid()])->assertJsonPath('data.recorded', false);
        $this->staff();
        $draft = $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'landing:draft', 'title' => 'Draft'])->assertCreated()->json('data.id');
        $popup = $this->postJson(self::DOCS, ['kind' => 'popup', 'title' => 'Popup'])->json('data.id');
        $this->beacon(['document_id' => $draft])->assertJsonPath('data.recorded', false);
        if (is_string($popup)) {
            $this->beacon(['document_id' => $popup])->assertJsonPath('data.recorded', false);
        }
        $this->assertSame(0, DB::table('builder_page_stats')->count());

        // A new version: its own sections count, and the previous one still does (cached pages).
        $this->staff();
        $sections = self::sections('Eid offers 2');
        $sections[2]['id'] = 's_new';
        $sections[2]['columns'][0]['id'] = 'c_new';
        $sections[2]['columns'][0]['elements'][0]['id'] = 'e_new';
        $this->putJson(self::DOCS."/{$this->page}/draft", ['revision' => 1, 'content' => ['schema_version' => 1, 'sections' => $sections]])->assertOk();
        $this->postJson(self::DOCS."/{$this->page}/publish")->assertOk();
        $this->beacon(['version' => 2, 'events' => [['t' => 'view', 'node' => 's_new'], ['t' => 'view', 'node' => 's_end']]])
            ->assertJsonPath('data', ['recorded' => true, 'accepted' => 1, 'ignored' => 1]);
        $this->beacon(['version' => 1, 'seq' => 3, 'events' => [['t' => 'view', 'node' => 's_end'], ['t' => 'view', 'node' => 's_new']]])
            ->assertJsonPath('data', ['recorded' => true, 'accepted' => 1, 'ignored' => 1]);
        $this->beacon(['version' => 3])->assertJsonPath('data.recorded', false);

        // At most 50 events are read.
        $many = array_fill(0, 60, ['t' => 'click', 'node' => 's_hero', 'x' => 0.5, 'y' => 0.5]);
        $this->beacon(['version' => 2, 'seq' => 1, 'events' => $many])->assertJsonPath('data', ['recorded' => true, 'accepted' => 50, 'ignored' => 10]);
        $this->assertSame(50, (int) DB::table('builder_click_cells')->where('cx', 10)->where('cy', 10)->value('clicks'));

        // Malformed top-level fields.
        $this->beacon(['device' => 'watch'])->assertStatus(422);
        $this->beacon(['document_id' => 'nope'])->assertStatus(422);
        $this->beacon(['scroll' => 33])->assertStatus(422);
        $this->beacon(['seq' => -1])->assertStatus(422);

        // A Sanctum stateful origin (the dev storefront on localhost) needs no CSRF token or cookie.
        $this->clearBrowser();
        $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.9'])->postJson('http://'.self::HOST.'/api/v1/store/insights/events', [
            'document_id' => $this->page, 'version' => 2, 'device' => 'tablet', 'seq' => 0,
        ], ['User-Agent' => self::BROWSER, 'Origin' => 'http://localhost', 'Referer' => 'http://localhost/p/eid'])
            ->assertStatus(202)->assertJsonPath('data.recorded', true)->assertCookieMissing('XSRF-TOKEN');
    }

    public function test_orders_keep_the_builder_page_from_the_cart_or_the_checkout(): void
    {
        $fromCart = $this->orderWith(['document_id' => strtoupper($this->page), 'node_id' => 's_offer', 'device' => 'mobile'], null);
        // jsonb keeps its own key order.
        $this->assertEquals(['builder' => ['document_id' => $this->page, 'node_id' => 's_offer', 'device' => 'mobile']], $this->attributionOf($fromCart));

        // The checkout's own page wins over the cart's; bad parts are dropped.
        $checkout = $this->orderWith(['document_id' => $this->page, 'node_id' => 's_offer'], [
            'utm_source' => 'Facebook', 'builder' => ['document_id' => $this->page, 'node_id' => 's_hero', 'device' => 'desktop'],
        ]);
        $this->assertEquals(['utm_source' => 'facebook', 'builder' => ['document_id' => $this->page, 'node_id' => 's_hero', 'device' => 'desktop']], $this->attributionOf($checkout));
        $bad = $this->orderWith(null, ['builder' => ['document_id' => $this->page, 'node_id' => 'Bad Node!', 'device' => 'watch']]);
        $this->assertSame(['builder' => ['document_id' => $this->page]], $this->attributionOf($bad));

        // A page that is not this store's is dropped (never an error).
        $unknown = $this->orderWith(['document_id' => (string) Str::uuid()], ['builder' => ['document_id' => (string) Str::uuid()]]);
        $this->assertNull($this->attributionOf($unknown));
        $other = $this->openStore('Other shop', 'other.test');
        $id = $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'landing:theirs', 'title' => 'Theirs'])->assertCreated()->json('data.id');
        $theirs = $this->orderWith(null, ['utm_source' => 'x', 'builder' => ['document_id' => $id]]);
        $this->assertSame(['utm_source' => 'x'], $this->attributionOf($theirs));
    }

    public function test_insights_report_views_sections_heat_vitals_and_orders(): void
    {
        $this->collect();
        $this->orderWith(['document_id' => $this->page, 'node_id' => 's_offer', 'device' => 'mobile'], null);
        $this->orderWith(null, ['builder' => ['document_id' => $this->page, 'node_id' => 's_hero', 'device' => 'desktop']]);
        $this->orderWith(null, ['builder' => ['document_id' => $this->page]]);
        $cancelled = $this->orderWith(null, ['builder' => ['document_id' => $this->page, 'node_id' => 's_hero']]);
        DB::table('orders')->where('number', $cancelled)->update(['status' => 'cancelled']);
        $this->orderWith(null, null);

        $this->staff();
        $insights = $this->getJson(self::DOCS."/{$this->page}/insights")->assertOk()->json('data');
        $timezone = $this->tenant['organization']->fresh()->timezone;
        $today = CarbonImmutable::now($timezone)->toDateString();
        $this->assertSame(['id' => $this->page, 'title' => 'Eid sale', 'kind' => 'page', 'key' => 'landing:eid'], $insights['document']);
        $this->assertSame([CarbonImmutable::parse($today)->subDays(29)->toDateString(), $today, null, $timezone, 'BDT'], [
            $insights['from'], $insights['to'], $insights['device'], $insights['timezone'], $insights['currency'],
        ]);
        $this->assertSame([
            'views' => 3, 'unique_visitors' => 2, 'avg_scroll' => '33.33', 'clicks' => 3, 'orders' => 3, 'revenue' => '1530.00', 'conversion' => '150.00',
            'scroll_reach' => ['25' => '33.33', '50' => '33.33', '75' => '33.33', '100' => '33.33'],
            'vitals' => [
                'lcp_p75' => 4100, 'cls_p75' => '0.300', 'inp_p75' => 600,
                'rating' => ['lcp' => 'poor', 'cls' => 'poor', 'inp' => 'poor'],
                'samples' => ['lcp' => 2, 'cls' => 2, 'inp' => 2],
            ],
        ], $insights['totals']);
        $this->assertCount(30, $insights['daily']);
        $this->assertSame(['day' => $today, 'views' => 3, 'unique_visitors' => 2, 'orders' => 3, 'revenue' => '1530.00'], end($insights['daily']));
        $this->assertSame([
            ['node_id' => 's_hero', 'label' => 'hero', 'type' => 'section', 'views' => 2, 'view_rate' => '66.67', 'clicks' => 2, 'click_rate' => '100.00', 'orders' => 1, 'revenue' => '510.00', 'reach' => '66.67', 'live' => true],
            ['node_id' => 's_offer', 'label' => null, 'type' => 'section', 'views' => 2, 'view_rate' => '66.67', 'clicks' => 1, 'click_rate' => '50.00', 'orders' => 1, 'revenue' => '510.00', 'reach' => '66.67', 'live' => true],
            ['node_id' => 's_end', 'label' => null, 'type' => 'section', 'views' => 0, 'view_rate' => '0.00', 'clicks' => 0, 'click_rate' => null, 'orders' => 0, 'revenue' => '0.00', 'reach' => '0.00', 'live' => true],
        ], $insights['sections']);
        $this->assertSame(['s_hero' => [[8, 16, 2]], 's_offer' => [[19, 0, 1]]], $insights['heat']);
        $this->assertSame([1], array_column($insights['versions'], 'number'));

        // One device: its own figures and orders.
        $mobile = $this->getJson(self::DOCS."/{$this->page}/insights?device=mobile")->assertOk()->json('data');
        $this->assertSame([2, 1, 1, '510.00', '100.00'], [
            $mobile['totals']['views'], $mobile['totals']['unique_visitors'], $mobile['totals']['orders'], $mobile['totals']['revenue'], $mobile['totals']['conversion'],
        ]);
        $this->assertSame(['lcp_p75' => 2400, 'cls_p75' => '0.100', 'inp_p75' => 200], array_intersect_key($mobile['totals']['vitals'], array_flip(['lcp_p75', 'cls_p75', 'inp_p75'])));
        $this->assertSame(['lcp' => 'good', 'cls' => 'good', 'inp' => 'good'], $mobile['totals']['vitals']['rating']);
        $this->assertSame(['s_hero' => [[8, 16, 1]], 's_offer' => [[19, 0, 1]]], $mobile['heat']);

        // A section that is no longer live keeps its figures, after the live ones.
        $sections = self::sections();
        array_shift($sections);
        $this->putJson(self::DOCS."/{$this->page}/draft", ['revision' => 1, 'content' => ['schema_version' => 1, 'sections' => $sections]])->assertOk();
        $this->postJson(self::DOCS."/{$this->page}/publish")->assertOk();
        $after = $this->getJson(self::DOCS."/{$this->page}/insights")->assertOk()->json('data');
        $this->assertSame([['s_offer', true], ['s_end', true], ['s_hero', false]], array_map(fn ($s) => [$s['node_id'], $s['live']], $after['sections']));
        $this->assertSame([1, 2], array_column($after['versions'], 'number'));

        // The Pages list.
        $summary = $this->getJson('/api/v1/storefront/builder/insights')->assertOk()->json('data');
        $this->assertSame([['document_id' => $this->page, 'views' => 3, 'unique_visitors' => 2, 'orders' => 3, 'revenue' => '1530.00', 'conversion' => '150.00']], $summary['documents']);
        $this->assertSame('BDT', $summary['currency']);

        // Ranges and devices.
        $this->getJson(self::DOCS."/{$this->page}/insights?from=2026-01-02&to=2026-01-01")->assertStatus(422);
        $this->getJson(self::DOCS."/{$this->page}/insights?from=2024-01-01&to=2026-01-01")->assertStatus(422);
        $this->getJson(self::DOCS."/{$this->page}/insights?device=watch")->assertStatus(422);
        $empty = $this->getJson(self::DOCS."/{$this->page}/insights?from=2020-01-01&to=2020-01-31")->assertOk()->json('data');
        $this->assertSame([0, 0, null, null, []], [$empty['totals']['views'], $empty['totals']['orders'], $empty['totals']['conversion'], $empty['totals']['vitals']['lcp_p75'], $empty['heat']]);
        $this->getJson('/api/v1/storefront/builder/insights?from=2020-01-01&to=2020-01-31')->assertOk()->assertJsonPath('data.documents', []);
        $this->getJson(self::DOCS.'/'.Str::uuid().'/insights')->assertNotFound();
    }

    public function test_insights_are_per_organization_and_need_permission(): void
    {
        $this->collect();
        $this->orderWith(null, ['builder' => ['document_id' => $this->page, 'node_id' => 's_hero']]);

        // Another store cannot send beacons for this store's page nor read its insights.
        $other = $this->openStore('Other shop', 'other.test');
        $this->beacon(['events' => [['t' => 'view', 'node' => 's_hero']]], host: 'other.test')->assertJsonPath('data.recorded', false);
        $this->clearBrowser();
        $this->actingAsUser($other['admin']);
        $this->getJson(self::DOCS."/{$this->page}/insights")->assertNotFound();
        $this->getJson('/api/v1/storefront/builder/insights')->assertOk()->assertJsonPath('data.documents', []);
        $this->assertSame(0, DB::table('builder_page_stats')->where('organization_id', $other['organization']->id)->count());

        $cashier = $this->createUserWithRole($this->tenant['organization'], SystemRole::Cashier);
        $manager = $this->createUserWithRole($this->tenant['organization'], SystemRole::OnlineStoreManager);
        $this->clearBrowser();
        $this->actingAsUser($cashier);
        $this->getJson(self::DOCS."/{$this->page}/insights")->assertForbidden();
        $this->getJson('/api/v1/storefront/builder/insights')->assertForbidden();
        $this->clearBrowser();
        $this->actingAsUser($manager);
        $this->getJson(self::DOCS."/{$this->page}/insights")->assertOk()->assertJsonPath('data.totals.views', 3);
        $this->clearBrowser();
        $this->getJson('/api/v1/storefront/builder/insights')->assertUnauthorized();
    }

    public function test_old_insights_and_visitor_hashes_are_pruned_daily(): void
    {
        $this->collect();
        $organization = $this->tenant['organization']->id;
        $old = CarbonImmutable::now('UTC')->subDays(95)->toDateString();
        DB::table('builder_page_stats')->insert(['organization_id' => $organization, 'document_id' => $this->page, 'day' => $old, 'device' => 'mobile', 'views' => 9]);
        DB::table('builder_section_stats')->insert(['organization_id' => $organization, 'document_id' => $this->page, 'node_id' => 's_hero', 'day' => $old, 'device' => 'mobile', 'views' => 9]);
        DB::table('builder_click_cells')->insert(['organization_id' => $organization, 'document_id' => $this->page, 'node_id' => 's_hero', 'day' => $old, 'device' => 'mobile', 'cx' => 1, 'cy' => 1, 'clicks' => 9]);
        DB::table('builder_vital_buckets')->insert(['organization_id' => $organization, 'document_id' => $this->page, 'day' => $old, 'device' => 'mobile', 'metric' => 'lcp', 'bucket' => 3, 'samples' => 9]);

        $this->artisan('marketing:prune-page-insights')->assertSuccessful();
        $this->assertSame([2, 3, 3, 6, 2], [
            DB::table('builder_page_stats')->count(), DB::table('builder_section_stats')->count(), DB::table('builder_click_cells')->count(),
            DB::table('builder_vital_buckets')->count(), DB::table('builder_visitor_hashes')->count(),
        ]);
        // Four days later the visitor hashes are gone; the counts stay for 90 days.
        $this->travel(4)->days();
        $this->artisan('marketing:prune-page-insights')->assertSuccessful();
        $this->assertSame([2, 0], [DB::table('builder_page_stats')->count(), DB::table('builder_visitor_hashes')->count()]);
        $this->travel(90)->days();
        $this->artisan('marketing:prune-page-insights')->assertSuccessful();
        $this->assertSame(0, DB::table('builder_page_stats')->count() + DB::table('builder_section_stats')->count() + DB::table('builder_click_cells')->count() + DB::table('builder_vital_buckets')->count());

        $event = collect(app(Schedule::class)->events())->first(fn ($e) => str_contains((string) $e->command, 'marketing:prune-page-insights'));
        $this->assertNotNull($event);
        $this->assertSame('0 0 * * *', $event->expression);
    }
}
