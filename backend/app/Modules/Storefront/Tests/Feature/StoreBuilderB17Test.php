<?php

namespace App\Modules\Storefront\Tests\Feature;

use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Promotions\Tests\Concerns\BuildsPromotions;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Storefront\Application\Builder\Templates\BuilderTemplateLibrary;
use App\Modules\Storefront\Domain\Festivals\FestivalCalendar;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;
use App\Modules\Users\Infrastructure\Models\Role;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * B17: the store-data blocks (payment badges from the checkout methods, the delivery promise
 * from the shipping zones, the Bangla date's time zone) in published payloads, drafts and the
 * canvas resolver; the festival calendar and the one-click festival setup (drafts only,
 * idempotent per occasion and year, dates on the hero and the bar, countdowns ending with the
 * window, publish all, validation, permissions, isolation, audit).
 */
class StoreBuilderB17Test extends TestCase
{
    use BuildsOnlineCatalog, BuildsPromotions, InteractsWithTenancy, RefreshDatabase;

    private const DOCS = '/api/v1/storefront/builder/documents';

    private const STORE = 'http://berry.test/api/v1/store';

    private const FESTIVALS = '/api/v1/storefront/festivals';

    /** @var array<string, mixed> */
    private array $t;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('public');
        Queue::fake();
        Date::setTestNow('2026-11-15T10:00:00+06:00');
        $this->t = $this->openStore('Berry Kids', 'berry.test');
    }

    private function asVisitorNow(): void
    {
        $this->app['auth']->forgetGuards();
    }

    /**
     * @param  list<array<string, mixed>>  $elements
     */
    private function saveDraft(string $id, array $elements): TestResponse
    {
        $revision = $this->getJson(self::DOCS."/{$id}")->assertOk()->json('data.draft_revision');

        return $this->putJson(self::DOCS."/{$id}/draft", ['revision' => $revision, 'content' => ['schema_version' => 1, 'sections' => [[
            'id' => 's_main', 'type' => 'section',
            'columns' => [['id' => 'c_main', 'width' => ['base' => 100], 'elements' => $elements]],
        ]]]]);
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, array<string, mixed>>
     */
    private function elements(array $payload): array
    {
        $result = [];
        foreach ($payload['sections'] as $section) {
            foreach ($section['columns'] as $column) {
                foreach ($column['elements'] as $element) {
                    $result[$element['id']] = $element;
                }
            }
        }

        return $result;
    }

    /**
     * Inside Dhaka (60, free over 2000, 1–2 days), All Bangladesh (120 / 150 by method, free over
     * 2000 for both, 3–5 days), and a zone without districts.
     *
     * @return array{inside: string, outside: string, empty: string}
     */
    private function zones(): array
    {
        [$dhaka, $other] = DB::table('geo_districts')->orderBy('id')->limit(2)->pluck('id')->all();
        $inside = $this->postJson('/api/v1/shipping/zones', ['name' => 'Inside Dhaka', 'district_ids' => [$dhaka]])->assertCreated()->json('data.id');
        $outside = $this->postJson('/api/v1/shipping/zones', ['name' => 'All Bangladesh', 'district_ids' => [$other], 'sort_order' => 1])->assertCreated()->json('data.id');
        $empty = $this->postJson('/api/v1/shipping/zones', ['name' => 'Islands', 'district_ids' => [], 'sort_order' => 2])->assertCreated()->json('data.id');
        $method = fn (string $zone, array $data) => $this->postJson("/api/v1/shipping/zones/{$zone}/methods", $data + ['cod_fee' => '0'])->assertCreated();
        $method($inside, ['name' => 'Home delivery', 'fee' => '60', 'free_over' => '2000', 'cod_allowed' => true, 'eta_min_days' => 1, 'eta_max_days' => 2]);
        $method($outside, ['name' => 'Courier', 'fee' => '120', 'free_over' => '2000', 'cod_allowed' => true, 'eta_min_days' => 3, 'eta_max_days' => 5]);
        $method($outside, ['name' => 'Express courier', 'fee' => '150.5', 'free_over' => '2000', 'cod_allowed' => false, 'eta_min_days' => 2, 'eta_max_days' => 3]);
        $method($empty, ['name' => 'Boat', 'fee' => '300', 'cod_allowed' => false, 'eta_min_days' => 5, 'eta_max_days' => 9]);

        return ['inside' => $inside, 'outside' => $outside, 'empty' => $empty];
    }

    public function test_payment_badges_and_the_delivery_promise_come_from_the_store_setup(): void
    {
        $zones = $this->zones();
        $other = $this->openStore('Mango Mart', 'mango.test');
        [$theirDistrict] = DB::table('geo_districts')->orderByDesc('id')->limit(1)->pluck('id')->all();
        $theirZone = $this->postJson('/api/v1/shipping/zones', ['name' => 'Their zone', 'district_ids' => [$theirDistrict]])->assertCreated()->json('data.id');
        $this->postJson("/api/v1/shipping/zones/{$theirZone}/methods", ['name' => 'Theirs', 'fee' => '10', 'cod_allowed' => true, 'cod_fee' => '0', 'eta_min_days' => 1, 'eta_max_days' => 1])->assertCreated();
        $this->actingAsUser($this->t['admin']);

        $home = $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'home', 'title' => 'Home', 'from' => 'blank'])->assertCreated()->json('data.id');
        $this->saveDraft($home, [
            ['id' => 'e_pay', 'type' => 'payment_badges', 'props' => ['wallets' => ['nagad', 'bkash'], 'note' => 'Send Money to 01700-000000'], 'translations' => ['bn' => ['title' => 'যেভাবে টাকা দেবেন']]],
            ['id' => 'e_pay_none', 'type' => 'payment_badges', 'props' => ['show_store_methods' => false, 'wallets' => []]],
            ['id' => 'e_del', 'type' => 'delivery_promise', 'props' => []],
            ['id' => 'e_del_pick', 'type' => 'delivery_promise', 'props' => ['zones' => [$zones['outside'], $theirZone, $zones['empty']], 'layout' => 'bar']],
            ['id' => 'e_date', 'type' => 'bangla_date', 'props' => ['show_hijri' => true]],
            ['id' => 'e_orn', 'type' => 'ornament', 'props' => ['name' => 'alpona_border', 'repeat' => true]],
        ])->assertOk();
        $this->postJson(self::DOCS."/{$home}/publish")->assertOk();

        $this->asVisitorNow();
        $page = $this->getJson(self::STORE.'/builder/pages/home')->assertOk()->json('data');
        $this->assertSame(['e_pay', 'e_del', 'e_del_pick', 'e_date', 'e_orn'], array_keys($this->elements($page)));
        $this->assertSame([
            'methods' => [['code' => 'cod', 'name' => 'Cash on delivery']],
            'wallets' => [['code' => 'nagad', 'name' => 'Nagad'], ['code' => 'bkash', 'name' => 'bKash']],
        ], $page['data']['e_pay']);
        $this->assertSame([
            'zones' => [
                ['id' => $zones['inside'], 'name' => 'Inside Dhaka', 'method' => 'Home delivery', 'min_days' => 1, 'max_days' => 2, 'fee' => '60.00', 'fee_from' => '60.00', 'free_over' => '2000.00', 'cod_allowed' => true],
                ['id' => $zones['outside'], 'name' => 'All Bangladesh', 'method' => null, 'min_days' => 2, 'max_days' => 5, 'fee' => null, 'fee_from' => '120.00', 'free_over' => '2000.00', 'cod_allowed' => true],
            ],
            'cod_everywhere' => true,
            'free_over' => '2000.00',
        ], $page['data']['e_del']);
        // Chosen zones in their order; another store's zone and a zone without districts show nothing.
        $this->assertSame([$zones['outside']], array_column($page['data']['e_del_pick']['zones'], 'id'));
        $this->assertArrayNotHasKey('all_zones', $page['data']['e_del_pick']);
        $this->assertSame(['timezone' => 'Asia/Dhaka'], $page['data']['e_date']);
        $this->assertArrayNotHasKey('e_orn', $page['data']);

        $bn = $this->getJson(self::STORE.'/builder/pages/home?lang=bn')->assertOk()->json('data');
        $this->assertSame(['নগদ', 'বিকাশ'], array_column($bn['data']['e_pay']['wallets'], 'name'));
        $this->assertSame('যেভাবে টাকা দেবেন', $this->elements($bn)['e_pay']['props']['title']);

        // Bank transfer switched on: the published page follows (the cache is refreshed).
        $this->actingAsUser($this->t['admin']);
        $this->putJson('/api/v1/payment-gateways/bank_transfer', ['is_enabled' => true, 'instructions' => 'Pay to Test Bank.', 'settings' => ['hold_hours' => 48]])->assertOk();
        $this->asVisitorNow();
        $this->assertSame(['cod', 'bank_transfer'], array_column($this->getJson(self::STORE.'/builder/pages/home')->assertOk()->json('data.data.e_pay.methods'), 'code'));

        // Drafts keep the empty block and get the zone picker list and the missing zones.
        $this->actingAsUser($this->t['admin']);
        $draft = $this->getJson(self::DOCS."/{$home}/render")->assertOk()->json('data');
        $this->assertSame(['methods' => [], 'wallets' => [], 'state' => 'empty'], $draft['data']['e_pay_none']);
        $this->assertSame(['Inside Dhaka', 'All Bangladesh', 'Islands'], array_column($draft['data']['e_del']['all_zones'], 'name'));
        $this->assertSame([$theirZone, $zones['empty']], $draft['data']['e_del_pick']['missing']);

        // The canvas resolver.
        $resolved = $this->postJson('/api/v1/storefront/builder/resolve', ['locale' => 'bn', 'elements' => [
            ['id' => 'e_a', 'type' => 'payment_badges', 'props' => ['wallets' => ['upay'], 'show_store_methods' => false]],
            ['id' => 'e_b', 'type' => 'delivery_promise', 'props' => ['zones' => [$theirZone]]],
            ['id' => 'e_c', 'type' => 'bangla_date', 'props' => []],
            ['id' => 'e_d', 'type' => 'payment_badges', 'props' => ['wallets' => ['paypal']]],
        ]])->assertOk()->json('data');
        $this->assertSame(['methods' => [], 'wallets' => [['code' => 'upay', 'name' => 'উপায়']]], $resolved['data']['e_a']);
        $this->assertSame(['zones' => [], 'cod_everywhere' => false, 'free_over' => null], array_intersect_key($resolved['data']['e_b'], array_flip(['zones', 'cod_everywhere', 'free_over'])));
        $this->assertSame('empty', $resolved['data']['e_b']['state']);
        $this->assertSame([$theirZone], $resolved['data']['e_b']['missing']);
        $this->assertSame(['timezone' => 'Asia/Dhaka'], $resolved['data']['e_c']);
        $this->assertSame('props.wallets.0', $resolved['errors']['e_d'][0]['path'] ?? null);

        // The other store's promise lists only its own zone.
        $this->actingAsUser($other['admin']);
        $theirs = $this->postJson('/api/v1/storefront/builder/resolve', ['elements' => [['id' => 'e_x', 'type' => 'delivery_promise', 'props' => []]]])->assertOk()->json('data.data.e_x');
        $this->assertSame([$theirZone], array_column($theirs['zones'], 'id'));
        $this->assertSame(['Their zone'], array_column($theirs['all_zones'], 'name'));
    }

    // ---------------------------------------------------------------- festivals

    /**
     * Built-in festival templates for the tests (the shipped ones come from the templates
     * pack; these keep the setup tests independent of their wording).
     */
    private function useFestivalFixtures(): void
    {
        $this->app->instance(BuilderTemplateLibrary::class, new FestivalFixtureLibrary);
    }

    /**
     * @param  array<string, mixed>  $overrides
     */
    private function setUpFestival(string $key, array $overrides = []): TestResponse
    {
        return $this->postJson(self::FESTIVALS."/{$key}/setup", $overrides + [
            'year' => 2027,
            'starts_at' => '2027-02-24T00:00:00+06:00',
            'ends_at' => '2027-03-12T23:59:59+06:00',
            'include' => ['landing' => true, 'home_hero' => true, 'bar' => true],
        ]);
    }

    /**
     * @return list<array<string, mixed>> every element of a content, depth first
     */
    private function allElements(array $content): array
    {
        $result = [];
        $walk = function (array $nodes) use (&$walk, &$result) {
            foreach ($nodes as $node) {
                foreach ($node['columns'] ?? [] as $column) {
                    foreach ($column['elements'] as $element) {
                        $result[] = $element;
                        $walk([$element]);
                    }
                }
            }
        };
        $walk($content['sections']);

        return $result;
    }

    private function staff(array $permissions): User
    {
        $organization = $this->t['organization'];

        return $this->createUserWithRole($organization, $this->inTenant($organization, function () use ($permissions) {
            $role = Role::query()->create(['name' => 'Editor']);
            $role->permissions()->sync($permissions);

            return $role;
        }));
    }

    public function test_the_festival_calendar_lists_the_next_twelve_months_by_date(): void
    {
        $list = $this->getJson(self::FESTIVALS)->assertOk()->json('data');
        $this->assertSame([
            'winter-sale', 'victory-day', 'ramadan', 'ekushey', 'eid-ul-fitr', 'independence-day',
            'pohela-boishakh', 'eid-ul-adha', 'durga-puja', 'eleven-eleven',
        ], array_column($list, 'key'));
        $byKey = array_column($list, null, 'key');
        $this->assertSame([
            'key' => 'victory-day', 'name' => 'Victory Day', 'name_bn' => 'বিজয় দিবস', 'kind' => 'fixed', 'sale_wording' => true,
            'next' => ['year' => 2026, 'starts_on' => '2026-12-16', 'ends_on' => '2026-12-16', 'expected' => false, 'note' => null, 'note_bn' => null],
            'suggested' => ['starts_at' => '2026-12-09T00:00:00+06:00', 'ends_at' => '2026-12-16T23:59:59+06:00'],
            'setup' => null,
        ], $byKey['victory-day']);
        $this->assertSame(['lunar', true, '2027-03-10'], [$byKey['eid-ul-fitr']['kind'], $byKey['eid-ul-fitr']['next']['expected'], $byKey['eid-ul-fitr']['next']['starts_on']]);
        $this->assertFalse($byKey['ekushey']['sale_wording']);
        $this->assertSame('season', $byKey['winter-sale']['kind']);

        // Past the bundled table the lunar occasions are left out.
        Date::setTestNow('2028-06-01T10:00:00+06:00');
        $keys = array_column($this->getJson(self::FESTIVALS)->assertOk()->json('data'), 'key');
        $this->assertNotContains('eid-ul-fitr', $keys);
        $this->assertNotContains('ramadan', $keys);
        $this->assertContains('durga-puja', $keys);
    }

    public function test_festival_setup_makes_drafts_with_dates_and_publishing_shows_them_on_their_dates(): void
    {
        $this->useFestivalFixtures();

        $response = $this->setUpFestival('eid-ul-fitr')->assertOk()->json('data');
        $documents = array_column($response['documents'], null, 'role');
        $this->assertSame(['landing', 'home', 'bar'], array_column($response['documents'], 'role'));
        $this->assertSame(['unpublished', 'unpublished', 'unpublished'], array_column($response['documents'], 'status'));
        $this->assertSame(array_column($response['documents'], 'id'), $response['publish_ids']);
        $this->assertSame('landing:eid-ul-fitr-2027', $documents['landing']['key']);
        $this->assertSame(['year' => 2027, 'starts_at' => '2027-02-24T00:00:00+06:00', 'ends_at' => '2027-03-12T23:59:59+06:00', 'state' => 'drafts_ready', 'landing_slug' => 'eid-ul-fitr-2027'],
            array_diff_key($response['festival']['setup'], ['documents' => true]));
        $this->assertSame('eid-ul-fitr', $response['festival']['key']);

        // The landing page: countdown to the window's end; no coupon promotion, no discount block.
        $landing = $this->getJson(self::DOCS."/{$documents['landing']['id']}")->assertOk()->json('data');
        $types = array_column($this->allElements($landing['content']), null, 'type');
        $this->assertSame('2027-03-12T23:59:59+06:00', $types['countdown']['props']['ends_at']);
        $this->assertArrayNotHasKey('discount', $types);
        $this->assertSame('ঈদ মোবারক', $types['heading']['translations']['bn']['text']);
        $this->assertNull($landing['published']);

        // The home draft (imported first): the hero on top with the window as its schedule.
        $home = $this->getJson(self::DOCS."/{$documents['home']['id']}")->assertOk()->json('data');
        $this->assertSame('home', $home['key']);
        $this->assertCount(1, $home['content']['sections']);
        $hero = $home['content']['sections'][0];
        $this->assertEquals(['starts_at' => '2027-02-24T00:00:00+06:00', 'ends_at' => '2027-03-12T23:59:59+06:00'], $hero['schedule']);
        $this->assertSame('2027-03-12T23:59:59+06:00', array_column($this->allElements($home['content']), null, 'type')['countdown']['props']['ends_at']);

        // The bar: dates in its settings, switched on, not published.
        $bar = $this->getJson(self::DOCS."/{$documents['bar']['id']}")->assertOk()->json('data');
        $this->assertSame(['bar_top', '2027-02-24T00:00:00+06:00', '2027-03-12T23:59:59+06:00'], [$bar['content']['popup']['layout'], $bar['content']['popup']['starts_at'], $bar['content']['popup']['ends_at']]);
        $this->assertTrue($bar['active']);
        $this->assertSame('2027-03-12T23:59:59+06:00', array_column($this->allElements($bar['content']), null, 'type')['countdown']['props']['ends_at']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'storefront.festival_setup']);

        // Nothing is live yet.
        $this->asVisitorNow();
        $this->getJson(self::STORE.'/builder/pages/eid-ul-fitr-2027')->assertNotFound();
        $this->assertSame([], $this->getJson(self::STORE.'/builder/popups')->assertOk()->json('data.popups'));

        // Again with other dates and a discount: the same drafts, the hero replaced (not added).
        $this->actingAsUser($this->t['admin']);
        $discount = $this->makePromotion($this->t['organization'], ['name' => 'Eid 10%', 'type' => 'percent', 'value' => '10']);
        $again = $this->setUpFestival('eid-ul-fitr', ['starts_at' => '2027-03-01T00:00:00+06:00', 'ends_at' => '2027-03-13T23:59:59+06:00', 'discount_id' => $discount->id, 'landing_slug' => 'ignored-later'])->assertOk()->json('data');
        $this->assertSame(array_column($response['documents'], 'id'), array_column($again['documents'], 'id'));
        $this->assertSame(1, BuilderDocument::query()->where('kind', 'popup')->count());
        $this->assertSame(2, BuilderDocument::query()->where('kind', 'page')->count());
        $home = $this->getJson(self::DOCS."/{$documents['home']['id']}")->assertOk()->json('data');
        $this->assertCount(1, $home['content']['sections']);
        $this->assertSame('2027-03-13T23:59:59+06:00', $home['content']['sections'][0]['schedule']['ends_at']);
        $landing = $this->getJson(self::DOCS."/{$documents['landing']['id']}")->assertOk()->json('data');
        $types = array_column($this->allElements($landing['content']), null, 'type');
        $this->assertSame($discount->id, $types['discount']['props']['promotion_id']);
        $this->assertSame('2027-03-13T23:59:59+06:00', $types['countdown']['props']['ends_at']);
        $this->assertSame('landing:eid-ul-fitr-2027', $landing['key']);
        $this->assertSame(2, DB::table('audit_logs')->where('action', 'storefront.festival_setup')->count());
        $this->assertSame(1, DB::table('storefront_festival_setups')->count());

        // Publish all with the returned ids: live on its dates, by itself.
        $this->postJson('/api/v1/storefront/builder/publish-all', ['documents' => $again['publish_ids']])->assertOk();
        $festival = array_column($this->getJson(self::FESTIVALS)->assertOk()->json('data'), null, 'key')['eid-ul-fitr'];
        $this->assertSame('live_on_dates', $festival['setup']['state']);
        $this->assertSame(['published', 'published', 'published'], array_column($festival['setup']['documents'], 'status'));

        $this->asVisitorNow();
        $this->getJson(self::STORE.'/builder/pages/eid-ul-fitr-2027')->assertOk();
        $this->assertSame([], $this->getJson(self::STORE.'/builder/pages/home')->assertOk()->json('data.sections'));
        $this->assertSame([], $this->getJson(self::STORE.'/builder/popups')->assertOk()->json('data.popups'));

        Date::setTestNow('2027-03-05T12:00:00+06:00');
        Cache::flush();
        $this->assertCount(1, $this->getJson(self::STORE.'/builder/pages/home')->assertOk()->json('data.sections'));
        $this->assertSame([$documents['bar']['id']], array_column($this->getJson(self::STORE.'/builder/popups')->assertOk()->json('data.popups'), 'id'));

        Date::setTestNow('2027-03-14T00:00:00+06:00');
        Cache::flush();
        $this->assertSame([], $this->getJson(self::STORE.'/builder/pages/home')->assertOk()->json('data.sections'));
        $this->assertSame([], $this->getJson(self::STORE.'/builder/popups')->assertOk()->json('data.popups'));
    }

    public function test_festival_setup_keeps_the_rest_of_the_home_page_and_only_what_is_included(): void
    {
        $this->useFestivalFixtures();
        $home = $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'home', 'title' => 'Home', 'from' => 'blank'])->assertCreated()->json('data.id');
        $this->saveDraft($home, [['id' => 'e_hello', 'type' => 'heading', 'props' => ['text' => 'Welcome']]])->assertOk();

        $response = $this->setUpFestival('victory-day', [
            'year' => 2026, 'starts_at' => '2026-12-10T00:00:00+06:00', 'ends_at' => '2026-12-16T23:59:59+06:00',
            'include' => ['home_hero' => true], 'landing_slug' => 'bijoy',
        ])->assertOk()->json('data');
        $this->assertSame(['home'], array_column($response['documents'], 'role'));
        $this->assertSame([$home], $response['publish_ids']);
        $sections = $this->getJson(self::DOCS."/{$home}")->assertOk()->json('data.content.sections');
        $this->assertSame(2, count($sections));
        $this->assertSame('s_main', $sections[1]['id']);
        $this->assertNotNull($sections[0]['schedule']);

        // Adding the landing page later uses the chosen address.
        $again = $this->setUpFestival('victory-day', [
            'year' => 2026, 'starts_at' => '2026-12-10T00:00:00+06:00', 'ends_at' => '2026-12-16T23:59:59+06:00',
            'include' => ['landing' => true, 'home_hero' => false, 'bar' => false], 'landing_slug' => 'bijoy',
        ])->assertOk()->json('data');
        $this->assertSame(['landing', 'home'], array_column($again['documents'], 'role'));
        $this->assertSame('landing:bijoy', $again['documents'][0]['key']);
        $this->assertCount(2, $this->getJson(self::DOCS."/{$home}")->assertOk()->json('data.content.sections'));

        // A window that ends before the day itself: "ended" once over.
        $this->setUpFestival('victory-day', [
            'year' => 2026, 'starts_at' => '2026-12-10T00:00:00+06:00', 'ends_at' => '2026-12-15T23:59:59+06:00', 'include' => ['landing' => true],
        ])->assertOk();
        Date::setTestNow('2026-12-16T09:00:00+06:00');
        $festival = array_column($this->getJson(self::FESTIVALS)->assertOk()->json('data'), null, 'key')['victory-day'];
        $this->assertSame(['ended', '2026-12-15T23:59:59+06:00'], [$festival['setup']['state'], $festival['setup']['ends_at']]);
    }

    public function test_festival_setup_is_validated_permission_checked_and_isolated(): void
    {
        $this->useFestivalFixtures();
        $errorCode = fn (TestResponse $r) => $r->json('error.code');

        $this->setUpFestival('diwali')->assertNotFound();
        $this->assertSame('FESTIVAL_DATE_UNKNOWN', $errorCode($this->setUpFestival('eid-ul-fitr', ['year' => 2029])->assertUnprocessable()));
        $this->setUpFestival('eid-ul-fitr', ['ends_at' => '2027-02-23T00:00:00+06:00'])->assertUnprocessable()->assertJsonValidationErrors(['ends_at'], 'error.details');
        $this->setUpFestival('eid-ul-fitr', ['starts_at' => '2027-01-01T00:00:00+06:00'])->assertUnprocessable()->assertJsonValidationErrors(['ends_at'], 'error.details');
        $this->setUpFestival('victory-day', ['year' => 2026, 'starts_at' => '2026-11-01T00:00:00+06:00', 'ends_at' => '2026-11-10T00:00:00+06:00'])
            ->assertUnprocessable()->assertJsonValidationErrors(['ends_at'], 'error.details');
        $this->setUpFestival('eid-ul-fitr', ['starts_at' => '24 Feb 2027'])->assertUnprocessable()->assertJsonValidationErrors(['starts_at'], 'error.details');
        $this->setUpFestival('eid-ul-fitr', ['include' => ['landing' => false, 'bar' => false]])->assertUnprocessable()->assertJsonValidationErrors(['include'], 'error.details');
        $this->setUpFestival('eid-ul-fitr', ['include' => ['banner' => true]])->assertUnprocessable()->assertJsonValidationErrors(['include'], 'error.details');
        $this->setUpFestival('eid-ul-fitr', ['landing_slug' => 'Eid Sale'])->assertUnprocessable()->assertJsonValidationErrors(['landing_slug'], 'error.details');
        $this->assertSame(0, BuilderDocument::query()->count());

        // Another store's discount.
        $other = $this->openStore('Mango Mart', 'mango.test');
        $theirs = $this->makePromotion($other['organization'], ['name' => 'Their sale', 'type' => 'percent', 'value' => '5']);
        $this->actingAsUser($this->t['admin']);
        $this->setUpFestival('eid-ul-fitr', ['discount_id' => $theirs->id])->assertUnprocessable()->assertJsonValidationErrors(['discount_id'], 'error.details');

        // An address another page uses.
        $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'landing:eid-ul-fitr-2027', 'title' => 'Mine', 'from' => 'blank'])->assertCreated();
        $this->assertSame('SLUG_TAKEN', $errorCode($this->setUpFestival('eid-ul-fitr')->assertUnprocessable()));
        $this->assertSame(1, BuilderDocument::query()->count());
        $this->setUpFestival('eid-ul-fitr', ['landing_slug' => 'eid-2027'])->assertOk();

        // Isolation: the other store sees no setup; view-only staff may read but not set up.
        $this->actingAsUser($other['admin']);
        $this->assertNull(array_column($this->getJson(self::FESTIVALS)->assertOk()->json('data'), null, 'key')['eid-ul-fitr']['setup']);
        $this->assertSame([], $this->getJson(self::DOCS)->assertOk()->json('data'));
        $this->actingAsUser($this->staff(['storefront.view']));
        $this->assertNotNull(array_column($this->getJson(self::FESTIVALS)->assertOk()->json('data'), null, 'key')['eid-ul-fitr']['setup']);
        $this->setUpFestival('eid-ul-fitr')->assertForbidden();
        $this->asVisitorNow();
        $this->getJson(self::FESTIVALS)->assertUnauthorized();
    }

    public function test_the_shipped_festival_templates_set_up_for_every_occasion(): void
    {
        // Q1: the templates ship (B17b) — a missing one fails here instead of skipping the test.
        $library = app(BuilderTemplateLibrary::class);
        foreach (array_keys(FestivalCalendar::OCCASIONS) as $key) {
            foreach (['landing', 'hero', 'bar'] as $part) {
                $this->assertNotNull($library->find("festival-{$key}-{$part}"), "festival-{$key}-{$part} is missing.");
            }
        }
        $this->makeProduct($this->t['unit']->id, 'Panjabi', [['PJ', '1500.00']]);

        foreach (array_keys(FestivalCalendar::OCCASIONS) as $key) {
            $next = FestivalCalendar::next($key, Date::now()->toImmutable()->setTimezone('Asia/Dhaka'));
            $window = FestivalCalendar::suggestedWindow($key, $next, Date::now()->toImmutable(), 'Asia/Dhaka');
            $documents = $this->setUpFestival($key, [
                'year' => $next['year'],
                'starts_at' => $window['starts_at']->toIso8601String(),
                'ends_at' => $window['ends_at']->toIso8601String(),
            ])->assertOk()->json('data.documents');
            $this->assertSame(['landing', 'home', 'bar'], array_column($documents, 'role'), $key);
            foreach ($documents as $document) {
                $content = $this->getJson(self::DOCS."/{$document['id']}")->assertOk()->json('data.content');
                if ($document['role'] === 'home') {
                    // The home page holds every occasion's hero; this one's is on top.
                    $content['sections'] = [$content['sections'][0]];
                }
                foreach ($this->allElements($content) as $element) {
                    if ($element['type'] === 'countdown' && $element['props']['source'] === 'date') {
                        $this->assertSame($window['ends_at']->toIso8601String(), $element['props']['ends_at'], "{$key} {$document['role']}");
                    }
                }
            }
        }
        $this->assertSame(10, DB::table('storefront_festival_setups')->count());
        $this->assertSame(10, BuilderDocument::query()->where('kind', 'popup')->count());
    }
}

/**
 * Festival templates for the tests: a landing page, a hero section and a top bar for every
 * occasion, using the B17 elements, a date countdown and a coupon discount.
 */
class FestivalFixtureLibrary extends BuilderTemplateLibrary
{
    public function all(): array
    {
        $fixtures = [];
        foreach (array_keys(FestivalCalendar::OCCASIONS) as $key) {
            $meta = ['preset' => null, 'category' => 'festival', 'description' => 'Test', 'thumbnail' => null, 'preview' => null, 'requires' => []];
            $fixtures[] = ['id' => "festival-{$key}-landing", 'scope' => 'page', 'name' => "{$key} landing", 'allowed_in' => ['page']] + $meta;
            $fixtures[] = ['id' => "festival-{$key}-hero", 'scope' => 'section', 'name' => "{$key} hero", 'allowed_in' => ['page', 'cms', 'zone']] + $meta;
            $fixtures[] = ['id' => "festival-{$key}-bar", 'scope' => 'popup', 'name' => "{$key} bar", 'allowed_in' => ['popup']] + $meta;
        }

        return [...$fixtures, ...parent::all()];
    }

    public function content(string $id): array
    {
        if (! str_starts_with($id, 'festival-')) {
            return parent::content($id);
        }
        $countdown = ['id' => 'e_count', 'type' => 'countdown', 'props' => ['source' => 'date', 'ends_at' => '2030-01-01T00:00:00+06:00', 'title' => 'Ends in']];
        $ornament = ['id' => 'e_orn', 'type' => 'ornament', 'props' => ['name' => 'crescent_star', 'color' => 'theme:accent']];
        $heading = ['id' => 'e_title', 'type' => 'heading', 'props' => ['text' => 'Eid Mubarak', 'level' => 1], 'translations' => ['bn' => ['text' => 'ঈদ মোবারক']]];
        $section = fn (string $id, array $elements) => ['id' => $id, 'type' => 'section', 'columns' => [['id' => "c{$id}", 'width' => ['base' => 100], 'elements' => $elements]]];

        return match (true) {
            str_ends_with($id, '-landing') => ['schema_version' => 1, 'sections' => [
                $section('s_hero', [$ornament, $heading, $countdown, ['id' => 'e_disc', 'type' => 'discount', 'props' => ['promotion_ref' => 'coupon', 'title' => 'Eid offer']]]),
                $section('s_trust', [
                    ['id' => 'e_trust', 'type' => 'trust_badges', 'props' => ['items' => [['id' => 'b1', 'icon' => 'truck', 'title' => 'Cash on delivery', 'text' => '', 'link' => ['url' => '/shop']]], 'style' => 'row']],
                    ['id' => 'e_pay', 'type' => 'payment_badges', 'props' => ['wallets' => ['bkash']]],
                    ['id' => 'e_del', 'type' => 'delivery_promise', 'props' => []],
                    ['id' => 'e_date', 'type' => 'bangla_date', 'props' => []],
                ]),
            ]],
            str_ends_with($id, '-hero') => ['schema_version' => 1, 'sections' => [$section('s_hero', [$ornament, $heading, $countdown])]],
            default => ['schema_version' => 1, 'popup' => ['layout' => 'bar_top', 'overlay' => false, 'trigger' => ['kind' => 'on_load', 'delay_seconds' => 0, 'scroll_percent' => 50], 'frequency' => ['kind' => 'every_page_view', 'days' => 7]],
                'sections' => [$section('s_bar', [$ornament, $heading, $countdown])]],
        };
    }
}
