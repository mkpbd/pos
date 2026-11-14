<?php

namespace App\Modules\Marketing\Tests\Feature;

use App\Modules\CustomerAccounts\Tests\Concerns\ActsAsShopper;
use App\Modules\Marketing\Infrastructure\Models\Campaign;
use App\Modules\Marketing\Infrastructure\Models\ShortLink;
use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Orders\Tests\Concerns\BuildsCheckout;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * P2a: campaigns, short links (`/go/<code>`), campaign visits without personal data and the
 * campaign stats over the web orders' attribution — per organization.
 */
class MarketingTest extends TestCase
{
    use ActsAsShopper, BuildsCheckout, BuildsOnlineCatalog, InteractsWithTenancy, RefreshDatabase;

    private const BROWSER = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36';

    protected function setUp(): void
    {
        parent::setUp();
        Notification::fake();
        $this->buildShop();
        $this->staff();
    }

    private function staff(): void
    {
        $this->clearBrowser();
        $this->actingAsUser($this->tenant['admin']);
    }

    /**
     * @param  array<string, mixed>  $body
     */
    private function visit(array $body, string $agent = self::BROWSER, string $ip = '203.0.113.5', string $host = self::HOST): TestResponse
    {
        $this->clearBrowser();
        $this->asVisitor();

        return $this->withServerVariables(['REMOTE_ADDR' => $ip])->postJson("http://{$host}/api/v1/store/visits", $body, ['User-Agent' => $agent]);
    }

    /**
     * A guest order of one shirt (510.00 with delivery) with this attribution.
     *
     * @param  array<string, mixed>|null  $attribution
     */
    private function orderWith(?array $attribution): string
    {
        $this->clearBrowser();
        $this->asVisitor();
        $this->addToCart('SHIRT', 1);

        return $this->placeOrder($this->checkoutBody('510.00', $attribution === null ? [] : ['attribution' => $attribution]))->assertCreated()->json('data.order.number');
    }

    public function test_campaigns_are_created_changed_and_archived(): void
    {
        $landing = $this->postJson('/api/v1/storefront/builder/documents', ['kind' => 'page', 'key' => 'landing:eid-sale', 'title' => 'Eid sale'])->assertCreated()->json('data.id');
        $this->getJson('/api/v1/marketing/landing-pages')->assertOk()->assertJsonPath('data', [
            ['id' => $landing, 'title' => 'Eid sale', 'slug' => 'eid-sale', 'path' => '/p/eid-sale', 'published' => false],
        ]);

        $campaign = $this->postJson('/api/v1/marketing/campaigns', [
            'name' => 'Eid Sale 2026', 'landing_document_id' => $landing, 'starts_at' => '2026-04-01', 'ends_at' => '2026-04-10',
        ])->assertCreated()->json('data');
        $this->assertSame(['Eid Sale 2026', 'eid-sale-2026', 'eid-sale-2026', 'active', 0], [
            $campaign['name'], $campaign['slug'], $campaign['utm_campaign'], $campaign['status'], $campaign['short_links_count'],
        ]);
        $this->assertSame(['id' => $landing, 'title' => 'Eid sale', 'slug' => 'eid-sale', 'path' => '/p/eid-sale', 'published' => false], $campaign['landing_document']);
        // Plain dates: the whole days in the organization's time zone (Asia/Dhaka, +06:00).
        $timezone = $this->tenant['organization']->fresh()->timezone;
        $this->assertSame(
            [CarbonImmutable::parse('2026-04-01 00:00:00', $timezone)->toIso8601String(), CarbonImmutable::parse('2026-04-10 23:59:59', $timezone)->toIso8601String()],
            [CarbonImmutable::parse($campaign['starts_at'])->setTimezone($timezone)->toIso8601String(), CarbonImmutable::parse($campaign['ends_at'])->setTimezone($timezone)->startOfSecond()->toIso8601String()],
        );
        // Full ISO-8601 instants are kept.
        $this->patchJson("/api/v1/marketing/campaigns/{$campaign['id']}", ['starts_at' => '2026-04-02T09:30:00+06:00'])->assertOk();
        $this->assertTrue(Campaign::query()->findOrFail($campaign['id'])->starts_at->equalTo(CarbonImmutable::parse('2026-04-02T03:30:00Z')));

        // Unique slug and tag; an end before the start; another store's page.
        $this->postJson('/api/v1/marketing/campaigns', ['name' => 'Again', 'slug' => 'eid-sale-2026'])->assertStatus(422)->assertJsonValidationErrors('slug', 'error.details');
        $this->postJson('/api/v1/marketing/campaigns', ['name' => 'Again', 'utm_campaign' => 'EID-SALE-2026'])->assertStatus(422)->assertJsonValidationErrors('utm_campaign', 'error.details');
        $this->postJson('/api/v1/marketing/campaigns', ['name' => 'Bad', 'starts_at' => '2026-05-02', 'ends_at' => '2026-05-01'])->assertStatus(422)->assertJsonValidationErrors('ends_at', 'error.details');
        $this->postJson('/api/v1/marketing/campaigns', ['name' => 'Bad', 'landing_document_id' => (string) Str::uuid()])->assertStatus(422)->assertJsonValidationErrors('landing_document_id', 'error.details');

        $this->patchJson("/api/v1/marketing/campaigns/{$campaign['id']}", ['status' => 'archived', 'name' => 'Eid 2026'])->assertOk()
            ->assertJsonPath('data.status', 'archived')->assertJsonPath('data.name', 'Eid 2026');
        $this->getJson('/api/v1/marketing/campaigns?status=archived')->assertJsonPath('meta.pagination.total', 1);
        $this->getJson('/api/v1/marketing/campaigns?status=active')->assertJsonPath('meta.pagination.total', 0);
        $this->getJson('/api/v1/marketing/campaigns?search=eid')->assertJsonPath('data.0.id', $campaign['id']);
    }

    public function test_short_links_redirect_with_utm_and_count_clicks(): void
    {
        $campaign = $this->postJson('/api/v1/marketing/campaigns', ['name' => 'Eid', 'utm_campaign' => 'eid'])->assertCreated()->json('data');
        $link = $this->postJson('/api/v1/marketing/short-links', [
            'code' => 'Eid-FB', 'target_path' => '/p/eid-sale?color=red', 'campaign_id' => $campaign['id'],
            'utm' => ['source' => 'Facebook', 'medium' => 'social', 'content' => 'Post 1'],
        ])->assertCreated()->json('data');
        $this->assertSame(['eid-fb', '/p/eid-sale?color=red', ['id' => $campaign['id'], 'name' => 'Eid'], 0, true, 'http://'.self::HOST.'/go/eid-fb'], [
            $link['code'], $link['target_path'], $link['campaign'], $link['clicks'], $link['active'], $link['url'],
        ]);
        $this->assertSame(['source' => 'facebook', 'medium' => 'social', 'campaign' => null, 'content' => 'Post 1', 'term' => null], $link['utm']);
        $random = $this->postJson('/api/v1/marketing/short-links', ['target_path' => '/'])->assertCreated()->json('data.code');
        $this->assertMatchesRegularExpression('/^[a-z0-9]{6}$/', $random);

        $this->postJson('/api/v1/marketing/short-links', ['code' => 'eid-fb', 'target_path' => '/'])->assertStatus(422)->assertJsonValidationErrors('code', 'error.details');
        foreach (['https://evil.test/x', '//evil.test', 'p/eid', '/go/other', '/a b'] as $bad) {
            $this->postJson('/api/v1/marketing/short-links', ['target_path' => $bad])->assertStatus(422)->assertJsonValidationErrors('target_path', 'error.details');
        }

        $this->clearBrowser();
        $this->asVisitor();
        $response = $this->get('http://'.self::HOST.'/go/eid-fb', ['User-Agent' => self::BROWSER]);
        $response->assertStatus(302)->assertHeader('Cache-Control', 'no-store, private');
        $location = (string) $response->headers->get('Location');
        $this->assertStringStartsWith('http://'.self::HOST.'/p/eid-sale?', $location);
        parse_str((string) parse_url($location, PHP_URL_QUERY), $query);
        $this->assertSame(['color' => 'red', 'utm_source' => 'facebook', 'utm_medium' => 'social', 'utm_campaign' => 'eid', 'utm_content' => 'Post 1', 'sl' => 'eid-fb'], $query);
        // Facebook's link preview is not a click.
        $this->get('http://'.self::HOST.'/go/EID-FB', ['User-Agent' => 'facebookexternalhit/1.1'])->assertStatus(302);
        $this->assertSame(1, ShortLink::query()->withoutGlobalScopes()->where('code', 'eid-fb')->value('clicks'));

        // Unknown and inactive codes go home; another store's code is unknown here.
        $this->get('http://'.self::HOST.'/go/nothing', ['User-Agent' => self::BROWSER])->assertRedirect('http://'.self::HOST);
        $this->staff();
        $this->patchJson("/api/v1/marketing/short-links/{$link['id']}", ['active' => false])->assertOk()->assertJsonPath('data.clicks', 1);
        $other = $this->openStore('Other Shop', 'other.example.test');
        $this->postJson('/api/v1/marketing/short-links', ['code' => 'other', 'target_path' => '/shop'])->assertCreated();
        $this->clearBrowser();
        $this->asVisitor();
        $this->get('http://'.self::HOST.'/go/eid-fb', ['User-Agent' => self::BROWSER])->assertRedirect('http://'.self::HOST);
        $this->get('http://'.self::HOST.'/go/other', ['User-Agent' => self::BROWSER])->assertRedirect('http://'.self::HOST);
        $this->get('http://other.example.test/go/other', ['User-Agent' => self::BROWSER])->assertStatus(302);
        $this->assertNotNull($other);

        // Deleting.
        $this->staff();
        $this->deleteJson("/api/v1/marketing/short-links/{$link['id']}")->assertNoContent();
        $this->getJson('/api/v1/marketing/short-links')->assertJsonPath('meta.pagination.total', 1);
    }

    public function test_visits_are_counted_per_day_without_personal_data(): void
    {
        $campaign = $this->postJson('/api/v1/marketing/campaigns', ['name' => 'Eid', 'utm_campaign' => 'eid'])->assertCreated()->json('data');
        $link = $this->postJson('/api/v1/marketing/short-links', ['code' => 'eid-fb', 'target_path' => '/p/eid', 'campaign_id' => $campaign['id'], 'utm' => ['source' => 'facebook']])->assertCreated()->json('data');

        $this->visit(['path' => '/p/eid?utm_source=x', 'code' => 'eid-fb', 'utm_medium' => 'social'])->assertOk()->assertJsonPath('data.recorded', true);
        $this->visit(['path' => '/p/eid', 'code' => 'eid-fb', 'utm_medium' => 'social'])->assertJsonPath('data.recorded', true);
        $this->visit(['path' => '/p/eid', 'code' => 'eid-fb', 'utm_medium' => 'social'], ip: '198.51.100.7')->assertJsonPath('data.recorded', true);
        // A bot, nothing to attribute, a bad path: not counted.
        $this->visit(['path' => '/p/eid', 'code' => 'eid-fb'], agent: 'Googlebot/2.1')->assertJsonPath('data.recorded', false);
        $this->visit(['path' => '/p/eid'])->assertJsonPath('data.recorded', false);
        $this->visit(['path' => 'https://evil.test/', 'utm_source' => 'x'])->assertJsonPath('data.recorded', false);
        // UTM without a known campaign: counted as direct / other.
        $this->visit(['path' => '/', 'utm_source' => 'Newsletter', 'utm_campaign' => 'unknown'])->assertJsonPath('data.recorded', true);

        $rows = DB::table('campaign_daily_stats')->orderBy('path')->get();
        $this->assertCount(2, $rows);
        $eid = $rows->firstWhere('path', '/p/eid');
        $this->assertSame([$campaign['id'], $link['id'], 'facebook', 'social', 3, 2], [$eid->campaign_id, $eid->short_link_id, $eid->source, $eid->medium, (int) $eid->visits, (int) $eid->unique_visitors]);
        $this->assertNull($rows->firstWhere('path', '/')->campaign_id);
        // Only salted hashes: no address or browser anywhere.
        $hashes = DB::table('campaign_visitor_hashes')->get();
        $this->assertCount(3, $hashes);
        foreach ($hashes as $hash) {
            $this->assertMatchesRegularExpression('/^[0-9a-f]{64}$/', $hash->hash);
            $this->assertNotSame(hash('sha256', '203.0.113.5'), $hash->hash);
        }
        $this->artisan('marketing:prune-visitor-hashes')->assertSuccessful();
        $this->assertSame(3, DB::table('campaign_visitor_hashes')->count());
        $this->travel(3)->days();
        $this->artisan('marketing:prune-visitor-hashes')->assertSuccessful();
        $this->assertSame(0, DB::table('campaign_visitor_hashes')->count());
    }

    public function test_stats_attribute_orders_and_visits_to_campaigns(): void
    {
        $eid = $this->postJson('/api/v1/marketing/campaigns', ['name' => 'Eid', 'utm_campaign' => 'eid'])->assertCreated()->json('data');
        $winter = $this->postJson('/api/v1/marketing/campaigns', ['name' => 'Winter'])->assertCreated()->json('data');
        $this->postJson('/api/v1/marketing/short-links', ['code' => 'winter-ig', 'target_path' => '/p/winter', 'campaign_id' => $winter['id']])->assertCreated();

        $this->visit(['path' => '/p/eid', 'utm_campaign' => 'EID', 'utm_source' => 'facebook', 'utm_medium' => 'cpc']);
        $this->visit(['path' => '/p/eid', 'utm_campaign' => 'eid', 'utm_source' => 'facebook', 'utm_medium' => 'cpc'], ip: '198.51.100.9');
        $this->visit(['path' => '/p/winter', 'code' => 'winter-ig', 'utm_source' => 'instagram']);

        $first = $this->orderWith(['utm_campaign' => 'EID', 'utm_source' => 'facebook', 'utm_medium' => 'cpc', 'landing_path' => '/p/eid']);
        $this->orderWith(['utm_campaign' => 'eid', 'utm_source' => 'facebook', 'utm_medium' => 'cpc', 'landing_path' => '/p/eid']);
        // The short link wins over another utm_campaign.
        $this->orderWith(['short_link' => 'winter-ig', 'utm_campaign' => 'eid', 'utm_source' => 'instagram', 'landing_path' => '/p/winter']);
        $this->orderWith(null);
        // A cancelled order is left out of the revenue.
        $cancelled = $this->orderWith(['utm_campaign' => 'eid', 'utm_source' => 'facebook', 'utm_medium' => 'cpc']);
        DB::table('orders')->where('number', $cancelled)->update(['status' => 'cancelled']);

        $this->staff();
        $stats = $this->getJson('/api/v1/marketing/stats')->assertOk()->json('data');
        $this->assertSame('BDT', $stats['currency']);
        $this->assertCount(30, $stats['by_day']);
        $this->assertSame(['visits' => 3, 'unique_visitors' => 3, 'orders' => 4, 'cancelled_orders' => 1, 'items' => '4', 'revenue' => '2040.00', 'conversion_rate' => '133.33', 'average_order_value' => '510.00'], $stats['totals']);

        $byCampaign = [];
        foreach ($stats['by_campaign'] as $row) {
            $byCampaign[$row['campaign']['name'] ?? 'direct'] = [$row['visits'], $row['orders'], $row['cancelled_orders'], $row['revenue'], $row['conversion_rate']];
        }
        $this->assertSame([
            'Eid' => [2, 2, 1, '1020.00', '100.00'],
            'Winter' => [1, 1, 0, '510.00', '100.00'],
            'direct' => [0, 1, 0, '510.00', null],
        ], $byCampaign);
        $this->assertNull(end($stats['by_campaign'])['campaign']);

        $sources = array_column(array_map(fn ($r) => [($r['source'] ?? '-').'/'.($r['medium'] ?? '-'), $r['orders'], $r['visits']], $stats['by_source']), null, 0);
        $this->assertSame(['facebook/cpc', 2, 2], $sources['facebook/cpc']);
        $this->assertSame(['instagram/-', 1, 1], $sources['instagram/-']);
        $this->assertSame(['-/-', 1, 0], $sources['-/-']);
        $this->assertSame(['/p/eid', 2, 2, '1020.00'], [$stats['top_landing_pages'][0]['path'], $stats['top_landing_pages'][0]['orders'], $stats['top_landing_pages'][0]['visits'], $stats['top_landing_pages'][0]['revenue']]);
        $today = end($stats['by_day']);
        $this->assertSame([3, 4, '2040.00'], [$today['visits'], $today['orders'], $today['revenue']]);

        // One campaign.
        $one = $this->getJson("/api/v1/marketing/stats?campaign_id={$eid['id']}")->assertOk()->json('data');
        $this->assertSame([[], 2, 2, '1020.00'], [$one['by_campaign'], $one['totals']['visits'], $one['totals']['orders'], $one['totals']['revenue']]);
        $this->assertSame(['id' => $eid['id'], 'name' => 'Eid'], $one['campaign']);

        // Orders show their campaign.
        $row = collect($this->getJson('/api/v1/web-orders')->json('data'))->firstWhere('number', $first);
        $this->assertSame(['storefront', ['id' => $eid['id'], 'name' => 'Eid']], [$row['source'], $row['campaign']]);

        // Ranges.
        $this->getJson('/api/v1/marketing/stats?from=2026-01-02&to=2026-01-01')->assertStatus(422);
        $this->getJson('/api/v1/marketing/stats?from=2024-01-01&to=2026-01-01')->assertStatus(422);
        $this->getJson('/api/v1/marketing/stats?from=2020-01-01&to=2020-01-31')->assertOk()->assertJsonPath('data.totals.orders', 0);
    }

    public function test_marketing_is_per_organization_and_needs_permissions(): void
    {
        $campaign = $this->postJson('/api/v1/marketing/campaigns', ['name' => 'Eid'])->assertCreated()->json('data');
        $link = $this->postJson('/api/v1/marketing/short-links', ['code' => 'eid', 'target_path' => '/'])->assertCreated()->json('data');
        $this->orderWith(['utm_campaign' => 'eid']);

        $other = $this->provisionTenant('Other Org');
        $this->clearBrowser();
        $this->actingAsUser($other['admin']);
        $this->getJson('/api/v1/marketing/campaigns')->assertOk()->assertJsonPath('meta.pagination.total', 0);
        $this->getJson("/api/v1/marketing/campaigns/{$campaign['id']}")->assertNotFound();
        $this->patchJson("/api/v1/marketing/campaigns/{$campaign['id']}", ['name' => 'Mine'])->assertNotFound();
        $this->deleteJson("/api/v1/marketing/short-links/{$link['id']}")->assertNotFound();
        $this->getJson("/api/v1/marketing/stats?campaign_id={$campaign['id']}")->assertNotFound();
        $this->assertSame(0, $this->getJson('/api/v1/marketing/stats')->json('data.totals.orders'));
        // The same code and tag are free in another organization.
        $this->postJson('/api/v1/marketing/campaigns', ['name' => 'Eid'])->assertCreated()->assertJsonPath('data.slug', 'eid');
        $this->postJson('/api/v1/marketing/short-links', ['code' => 'eid', 'target_path' => '/'])->assertCreated();

        $cashier = $this->createUserWithRole($this->tenant['organization'], SystemRole::Cashier);
        $manager = $this->createUserWithRole($this->tenant['organization'], SystemRole::OnlineStoreManager);
        $this->clearBrowser();
        $this->actingAsUser($cashier);
        $this->getJson('/api/v1/marketing/campaigns')->assertForbidden();
        $this->getJson('/api/v1/marketing/stats')->assertForbidden();
        $this->clearBrowser();
        $this->actingAsUser($manager);
        $this->getJson('/api/v1/marketing/stats')->assertOk();
        $this->postJson('/api/v1/marketing/short-links', ['code' => 'manager', 'target_path' => '/shop'])->assertCreated();
    }
}
