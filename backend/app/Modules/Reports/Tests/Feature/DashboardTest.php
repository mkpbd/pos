<?php

namespace App\Modules\Reports\Tests\Feature;

use App\Modules\Branches\Infrastructure\Models\Store;
use App\Modules\Reports\Tests\Concerns\BuildsReportData;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Phase 7 dashboard: KPIs with the previous period, trend, top products, low stock, recent
 * transactions, channel and branch split, permissions and the 60-second cache per scope.
 */
class DashboardTest extends TestCase
{
    use BuildsReportData, InteractsWithTenancy, RefreshDatabase;

    public function test_kpis_trend_and_lists_with_the_previous_period(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $main] = $this->provisionTenant();
        $ctg = $this->createBranch($org, 'CTG');
        $soap = $this->sellable($org, 'Soap', '100.00', ['cost' => '40.00']);
        $tea = $this->stockedVariant($org, 'Tea', [], '10');
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $this->travelTo($this->dhaka('2026-10-20 10:00'));
        $this->stockUp($store, $soap, '50', '40.00');
        $this->stockUp($store, $tea, '2', '10.00');
        $this->checkout($this->cart($store, [[$soap, '1']], [['cash', '100']]))->assertCreated();            // previous period
        $this->travelTo($this->dhaka('2026-11-06 10:00'));
        $sale = $this->checkout($this->cart($store, [[$soap, '3']], [['cash', '300']]))->assertCreated()->json('data');
        $this->posReturn($sale['id'], [[$sale['lines'][0]['id'], '1']], [['cash', '100']])->assertCreated();
        $this->travelTo($this->dhaka('2026-11-07 09:00'));
        $this->checkout($this->cart($store, [[$soap, '2']], [['cash', '200']]))->assertCreated();
        $this->webOrder($org, $store, [['variant' => $soap, 'quantity' => '1', 'unit_price' => '100', 'unit_cost' => '40']],
            ['delivered_at' => $this->dhaka('2026-11-07 08:00'), 'placed_at' => $this->dhaka('2026-11-06 20:00'), 'contact_name' => 'Web Buyer']);

        $response = $this->getJson('/api/v1/dashboard?date_from=2026-11-01&date_to=2026-11-07')->assertOk();

        // Range: POS 300 − 100 + 200, web 100 → 500 over 3 orders; previous 25–31 Oct: nothing.
        $response->assertJsonPath('data.kpis.total_sales', ['value' => '500.00', 'previous' => '0.00', 'change' => '500.00', 'change_pct' => null])
            ->assertJsonPath('data.kpis.today_revenue', ['value' => '300.00', 'previous' => '200.00', 'change' => '100.00', 'change_pct' => '50.00'])
            ->assertJsonPath('data.kpis.orders_count.value', 3)
            ->assertJsonPath('data.kpis.gross_profit.value', '300.00')
            ->assertJsonPath('data.kpis.average_ticket.value', '166.67')
            ->assertJsonPath('data.kpis.returns_amount.value', '100.00')
            ->assertJsonPath('meta.params.previous_from', '2026-10-25')
            ->assertJsonPath('meta.params.previous_to', '2026-10-31')
            ->assertJsonPath('meta.params.currency', 'BDT')
            ->assertJsonPath('meta.omitted', []);
        $trend = collect($response->json('data.sales_trend'))->keyBy('date');
        $this->assertCount(7, $trend);
        $this->assertSame(['net_sales' => '300.00', 'pos_net_sales' => '200.00', 'online_net_sales' => '100.00', 'orders' => 2, 'pos_orders' => 1, 'online_orders' => 1, 'gross_profit' => '180.00'],
            array_intersect_key($trend['2026-11-07'], array_flip(['net_sales', 'pos_net_sales', 'online_net_sales', 'orders', 'pos_orders', 'online_orders', 'gross_profit'])));
        $response->assertJsonPath('data.top_products.0.name', 'Soap')->assertJsonPath('data.top_products.0.quantity', '5.000')->assertJsonPath('data.top_products.0.net_sales', '500.00');
        $response->assertJsonPath('data.low_stock.count', 1)->assertJsonPath('data.low_stock.items.0.product', 'Tea')->assertJsonPath('data.low_stock.items.0.shortfall', '8.000');
        $this->assertSame(['sale', 'web_order', 'sale', 'sale'], array_column($response->json('data.recent_transactions'), 'type'));
        $response->assertJsonPath('data.recent_transactions.1.customer', 'Web Buyer')->assertJsonPath('data.recent_transactions.0.link', '/sales/'.$response->json('data.recent_transactions.0.id'));
        $response->assertJsonPath('data.sales_by_channel.0', ['channel' => 'pos', 'label' => 'POS', 'net_sales' => '400.00', 'orders' => 2, 'share' => '80.00']);
        $this->assertSame([$main->name => '500.00', $ctg->name => '0.00'], collect($response->json('data.sales_by_branch'))->pluck('net_sales', 'name')->all());

        // Defaults: the last 30 days up to today.
        $this->getJson('/api/v1/dashboard')->assertOk()->assertJsonPath('meta.params.date_from', '2026-10-09')->assertJsonPath('meta.params.date_to', '2026-11-07')
            ->assertJsonPath('data.kpis.total_sales.value', '600.00');
        $this->getJson('/api/v1/dashboard?date_from=2025-01-01&date_to=2026-11-07')->assertStatus(422)->assertJsonPath('error.code', 'RANGE_TOO_LARGE');
    }

    public function test_cashiers_see_their_branch_without_profit_or_web_orders(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $main] = $this->provisionTenant();
        $soap = $this->sellable($org, 'Soap', '100.00', ['cost' => '40.00']);
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $this->stockUp($store, $soap, '10', '40.00');
        $this->checkout($this->cart($store, [[$soap, '1']], [['cash', '100']]))->assertCreated();
        $this->webOrder($org, $store, [['variant' => $soap, 'quantity' => '1', 'unit_price' => '100', 'unit_cost' => '40']]);

        $this->actingAsUser($this->createUserWithRole($org, SystemRole::Cashier, [$main->id]));
        $response = $this->getJson('/api/v1/dashboard')->assertOk();

        $response->assertJsonPath('data.kpis.gross_profit', null)->assertJsonPath('meta.omitted', ['gross_profit'])
            ->assertJsonPath('data.kpis.total_sales.value', '200.00');
        $this->assertArrayNotHasKey('gross_profit', $response->json('data.sales_trend.0'));
        $this->assertSame(['sale'], array_column($response->json('data.recent_transactions'), 'type'));
    }

    public function test_the_cache_lasts_a_minute_and_is_never_shared_across_branch_scopes(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $main] = $this->provisionTenant();
        $ctg = $this->createBranch($org, 'CTG');
        $soap = $this->sellable($org, 'Soap', '100.00');
        $store = $this->mainStoreId($org);
        $ctgStore = $this->inTenant($org, fn () => Store::query()->where('branch_id', $ctg->id)->value('id'));
        $this->actingAsUser($admin);
        $this->stockUp($store, $soap, '10');
        $this->stockUp($ctgStore, $soap, '10');
        $this->checkout($this->cart($store, [[$soap, '1']], [['cash', '100']]))->assertCreated();
        $mainManager = $this->createUserWithRole($org, SystemRole::BranchManager, [$main->id]);
        $ctgManager = $this->createUserWithRole($org, SystemRole::BranchManager, [$ctg->id]);
        $total = fn () => $this->getJson('/api/v1/dashboard')->assertOk()->json('data.kpis.total_sales.value');

        $this->actingAsUser($mainManager);
        $this->assertSame('100.00', $total());
        $this->actingAsUser($ctgManager);
        $this->assertSame('0.00', $total(), 'another branch scope is computed, not served from cache');
        $this->checkout($this->cart($ctgStore, [[$soap, '2']], [['cash', '200']]))->assertCreated();
        $this->assertSame('0.00', $total(), 'cached for this scope');
        $this->actingAsUser($admin);
        $this->assertSame('300.00', $total());

        $this->travel(61)->seconds();
        $this->actingAsUser($ctgManager);
        $this->assertSame('200.00', $total(), 'expired after 60 seconds');
    }
}
