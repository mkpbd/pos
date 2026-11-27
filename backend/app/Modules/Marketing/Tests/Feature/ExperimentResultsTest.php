<?php

namespace App\Modules\Marketing\Tests\Feature;

use App\Modules\CustomerAccounts\Tests\Concerns\ActsAsShopper;
use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Orders\Tests\Concerns\BuildsCheckout;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * B13: A/B test versions are counted per day from the B15 beacons (`arms`), add-to-carts and
 * orders (`attribution.builder.experiments`); staff read the results with the Bayesian chance
 * that B beats A — per organization.
 */
class ExperimentResultsTest extends TestCase
{
    use ActsAsShopper, BuildsCheckout, BuildsOnlineCatalog, InteractsWithTenancy, RefreshDatabase;

    private const DOCS = '/api/v1/storefront/builder/documents';

    private const PHONE = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131 Mobile Safari/537.36';

    private const DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36';

    private string $page;

    protected function setUp(): void
    {
        parent::setUp();
        Notification::fake();
        $this->buildShop();
        $this->page = $this->pageWithTest();
    }

    private function staff(): void
    {
        $this->clearBrowser();
        $this->actingAsUser($this->tenant['admin']);
    }

    private function pageWithTest(): string
    {
        $this->staff();
        $section = fn (string $id, ?string $arm) => ['id' => $id, 'type' => 'section', 'columns' => [[
            'id' => 'c'.substr($id, 1), 'width' => ['base' => 100], 'elements' => [['id' => 'e'.substr($id, 1), 'type' => 'heading', 'props' => ['text' => 'Hi']]],
        ]]] + ($arm === null ? [] : ['experiment' => ['id' => 'x_hero', 'arm' => $arm]]);
        $id = $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'landing:eid', 'title' => 'Eid sale'])->assertCreated()->json('data.id');
        $this->putJson(self::DOCS."/{$id}/draft", ['revision' => 0, 'content' => ['schema_version' => 1, 'sections' => [
            $section('s_a', 'A'), $section('s_b', 'B'), $section('s_end', null),
        ], 'experiments' => [
            ['id' => 'x_hero', 'name' => 'Hero', 'goal' => 'orders'],
            ['id' => 'x_idle', 'name' => 'Not started', 'goal' => 'clicks'],
        ]]])->assertOk();
        $this->postJson(self::DOCS."/{$id}/experiments/x_hero/start", ['revision' => 1])->assertOk();
        $this->postJson(self::DOCS."/{$id}/publish")->assertOk();
        $this->asVisitor();

        return $id;
    }

    /**
     * @param  array<string, mixed>  $body
     */
    private function beacon(array $body, string $agent = self::PHONE, string $ip = '203.0.113.5', string $host = self::HOST): TestResponse
    {
        $this->clearBrowser();
        $this->asVisitor();

        return $this->withServerVariables(['REMOTE_ADDR' => $ip])
            ->postJson("http://{$host}/api/v1/store/insights/events", $body + [
                'document_id' => $this->page, 'version' => 1, 'path' => '/p/eid', 'device' => 'mobile', 'seq' => 0,
            ], ['User-Agent' => $agent]);
    }

    /**
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

    /**
     * Phone shopper in version A (two page views, a click on A), desktop shopper in version B (a
     * page view, clicks in a later beacon) and beacons whose arms don't count.
     */
    private function collect(): void
    {
        $this->beacon(['arms' => ['x_hero' => 'A'], 'events' => [['t' => 'view', 'node' => 's_a'], ['t' => 'click', 'node' => 's_a', 'x' => 0.5, 'y' => 0.5], ['t' => 'view', 'node' => 's_end']]])
            ->assertStatus(202)->assertJsonPath('data.recorded', true);
        $this->beacon(['arms' => ['x_hero' => 'A']]);
        $this->beacon(['arms' => ['x_hero' => 'B'], 'device' => 'desktop', 'events' => [['t' => 'view', 'node' => 's_b']]], self::DESKTOP, '198.51.100.7');
        $this->beacon(['arms' => ['x_hero' => 'B'], 'device' => 'desktop', 'seq' => 1, 'events' => [
            ['t' => 'click', 'node' => 's_b', 'x' => 0.1, 'y' => 0.1], ['t' => 'click', 'node' => 's_b', 'x' => 0.2, 'y' => 0.1],
        ]], self::DESKTOP, '198.51.100.7');
        // Not running (draft test), unknown test, bad arm, not an object.
        $this->beacon(['arms' => ['x_idle' => 'A', 'x_nope' => 'B', 'x_hero' => 'C'], 'seq' => 2])->assertStatus(202);
        $this->beacon(['arms' => 'A'])->assertStatus(422);
    }

    public function test_versions_are_counted_from_beacons_carts_and_orders(): void
    {
        // 23:45 UTC is already tomorrow in Dhaka: orders must still fall in the local day.
        $this->travelTo(CarbonImmutable::now('UTC')->setTime(23, 45));
        $this->collect();
        $rows = DB::table('builder_experiment_stats')->orderBy('arm')->get()
            ->map(fn ($r) => [$r->experiment_id, $r->arm, $r->device, (int) $r->views, (int) $r->visitors, (int) $r->section_views, (int) $r->clicks, (int) $r->clicked_views, (int) $r->add_to_carts])->all();
        $this->assertSame([
            ['x_hero', 'A', 'mobile', 2, 1, 1, 1, 1, 0],
            ['x_hero', 'B', 'desktop', 1, 1, 1, 2, 1, 0],
        ], $rows);
        $this->assertSame(2, DB::table('builder_experiment_visitor_hashes')->count());

        // Add-to-carts and orders carry the versions.
        $number = $this->orderWith(['document_id' => $this->page, 'node_id' => 's_b', 'device' => 'desktop', 'experiments' => ['x_hero' => 'B', 'Bad Id' => 'A', 'x_idle' => 'Z']], null);
        $this->assertEquals(['builder' => ['document_id' => $this->page, 'node_id' => 's_b', 'device' => 'desktop', 'experiments' => ['x_hero' => 'B']]],
            Order::query()->withoutGlobalScopes()->where('number', $number)->value('attribution'));
        $this->assertSame(1, (int) DB::table('builder_experiment_stats')->where('arm', 'B')->value('add_to_carts'));
        $this->orderWith(null, ['builder' => ['document_id' => $this->page, 'device' => 'mobile', 'experiments' => ['x_hero' => 'A']]]);
        $this->orderWith(null, ['builder' => ['document_id' => $this->page, 'device' => 'desktop', 'experiments' => ['x_hero' => 'B']]]);
        $cancelled = $this->orderWith(null, ['builder' => ['document_id' => $this->page, 'experiments' => ['x_hero' => 'A']]]);
        DB::table('orders')->where('number', $cancelled)->update(['status' => 'cancelled']);
        // A cart add without a device is not counted per version (the order still is).
        $this->orderWith(['document_id' => $this->page, 'experiments' => ['x_hero' => 'A']], null);

        $this->staff();
        $timezone = $this->tenant['organization']->fresh()->timezone;
        $today = CarbonImmutable::now($timezone)->toDateString();
        $results = $this->getJson(self::DOCS."/{$this->page}/experiments/x_hero/results")->assertOk()->json('data');
        $this->assertSame(['x_hero', 'running', 'orders'], [$results['experiment']['id'], $results['experiment']['status'], $results['goal']]);
        $this->assertSame([$today, $today, null, $timezone, 'BDT'], [$results['from'], $results['to'], $results['device'], $results['timezone'], $results['currency']]);
        $this->assertSame([
            'A' => ['visitors' => 1, 'views' => 2, 'goal_count' => 1, 'rate' => '100.00', 'orders' => 2, 'revenue' => '1020.00', 'add_to_carts' => 0, 'clicks' => 1, 'section_views' => 1],
            'B' => ['visitors' => 1, 'views' => 1, 'goal_count' => 1, 'rate' => '100.00', 'orders' => 2, 'revenue' => '1020.00', 'add_to_carts' => 1, 'clicks' => 2, 'section_views' => 1],
        ], $results['arms']);
        $this->assertSame(['0.00', '50.00', 'low', false, 'keep_running'], [
            $results['lift'], $results['probability_b_beats_a'], $results['confidence'], $results['enough_data'], $results['recommendation'],
        ]);
        // The days show the events as they happened; the totals count at most one per visitor.
        $this->assertSame([['day' => $today, 'A' => ['visitors' => 1, 'goal_count' => 2], 'B' => ['visitors' => 1, 'goal_count' => 2]]], $results['daily']);

        // One device.
        $desktop = $this->getJson(self::DOCS."/{$this->page}/experiments/x_hero/results?device=desktop")->assertOk()->json('data');
        $this->assertSame([0, 0, 1, 2], [$desktop['arms']['A']['visitors'], $desktop['arms']['A']['orders'], $desktop['arms']['B']['visitors'], $desktop['arms']['B']['orders']]);
        $this->assertNull($desktop['probability_b_beats_a']);
        $this->getJson(self::DOCS."/{$this->page}/experiments/x_hero/results?device=watch")->assertStatus(422);

        // A test that never started: the last 30 days, nothing counted.
        $idle = $this->getJson(self::DOCS."/{$this->page}/experiments/x_idle/results")->assertOk()->json('data');
        $this->assertCount(30, $idle['daily']);
        $this->assertSame([0, 0, null], [$idle['arms']['A']['visitors'], $idle['arms']['B']['goal_count'], $idle['lift']]);
        $this->getJson(self::DOCS."/{$this->page}/experiments/x_nope/results")->assertNotFound()->assertJsonPath('error.code', 'EXPERIMENT_NOT_FOUND');
    }

    public function test_results_are_per_organization_need_permission_and_are_pruned(): void
    {
        $this->collect();
        $other = $this->openStore('Other shop', 'other.test');
        // Another store cannot count versions of this store's page.
        $this->beacon(['arms' => ['x_hero' => 'A']], host: 'other.test')->assertJsonPath('data.recorded', false);
        $this->clearBrowser();
        $this->actingAsUser($other['admin']);
        $this->getJson(self::DOCS."/{$this->page}/experiments/x_hero/results")->assertNotFound()->assertJsonPath('error.code', 'NOT_FOUND');
        $this->assertSame(0, DB::table('builder_experiment_stats')->where('organization_id', $other['organization']->id)->count());

        $this->clearBrowser();
        $this->actingAsUser($this->createUserWithRole($this->tenant['organization'], SystemRole::Cashier));
        $this->getJson(self::DOCS."/{$this->page}/experiments/x_hero/results")->assertForbidden();
        $this->clearBrowser();
        $this->actingAsUser($this->createUserWithRole($this->tenant['organization'], SystemRole::OnlineStoreManager));
        $this->getJson(self::DOCS."/{$this->page}/experiments/x_hero/results")->assertOk()->assertJsonPath('data.arms.A.views', 2);

        $old = CarbonImmutable::now('UTC')->subDays(95)->toDateString();
        DB::table('builder_experiment_stats')->insert(['organization_id' => $this->tenant['organization']->id, 'document_id' => $this->page, 'experiment_id' => 'x_hero', 'arm' => 'A', 'day' => $old, 'device' => 'mobile', 'views' => 9]);
        DB::table('builder_experiment_visitor_hashes')->insert(['organization_id' => $this->tenant['organization']->id, 'document_id' => $this->page, 'experiment_id' => 'x_hero', 'arm' => 'A', 'day' => $old, 'device' => 'mobile', 'hash' => str_repeat('a', 64)]);
        $this->artisan('marketing:prune-page-insights')->assertSuccessful();
        $this->assertSame([2, 2], [DB::table('builder_experiment_stats')->count(), DB::table('builder_experiment_visitor_hashes')->count()]);
    }
}
