<?php

namespace App\Modules\AI\Tests\Feature;

use App\Modules\AI\Infrastructure\Models\AiInsight;
use App\Modules\AI\Infrastructure\Models\AiRequest;
use App\Modules\AI\Tests\Support\InteractsWithAi;
use App\Modules\Organizations\Infrastructure\Models\Organization;
use App\Modules\Products\Infrastructure\Models\ProductVariant;
use App\Modules\Reports\Tests\Concerns\BuildsReportData;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Infrastructure\Models\Role;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Business insights on crafted data: KPIs vs the previous day, top movers, the z-score anomaly,
 * slow movers and shortage risk; facts without AI, the narrative once AI is on, the cache per
 * scope and cost visibility, the idempotent daily job and tenant isolation.
 */
class BusinessInsightsTest extends TestCase
{
    use BuildsReportData, InteractsWithAi, InteractsWithTenancy, RefreshDatabase;

    private function sell(Organization $org, string $store, ProductVariant $variant, string $amount, string $day): void
    {
        $this->webOrder($org, $store, [['variant' => $variant, 'quantity' => '1', 'unit_price' => $amount, 'unit_cost' => bcmul($amount, '0.4', 2)]],
            ['delivered_at' => $this->dhaka($day.' 12:00'), 'placed_at' => $this->dhaka($day.' 09:00')]);
    }

    /**
     * @return array<string, mixed>
     */
    private function scenario(): array
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $soap = $this->sellable($org, 'Soap', '100.00', ['cost' => '40.00']);
        $tea = $this->sellable($org, 'Tea', '50.00', ['cost' => '20.00']);
        $old = $this->sellable($org, 'Old Stock', '30.00', ['cost' => '12.00']);
        $rice = $this->sellable($org, 'Rice', '10.00', ['cost' => '5.00']);
        $store = $this->mainStoreId($org);

        // 10 Oct – 5 Nov: 100 / 110 alternately (27 days); 5 Nov also 50 of tea; 6 Nov: 500 (the spike).
        $day = CarbonImmutable::parse('2026-10-10');
        for ($i = 0; $i < 27; $i++) {
            $this->sell($org, $store, $soap, $i % 2 === 0 ? '100.00' : '110.00', $day->toDateString());
            $day = $day->addDay();
        }
        $this->sell($org, $store, $tea, '50.00', '2026-11-05');
        $this->sell($org, $store, $soap, '500.00', '2026-11-06');

        $this->travelTo($this->dhaka('2026-11-07 10:00'));
        $this->actingAsUser($admin);
        $this->stockUp($store, $soap, '20', '40.00');
        $this->stockUp($store, $old, '5', '12.00');
        $this->stockUp($store, $rice, '12', '5.00');
        // 10 of rice sold today: 2 left at 1/3 a day → 6 days of cover < 7 days lead time.
        $this->checkout($this->cart($store, [[$rice, '10']], [['cash', '100']]))->assertCreated();

        return compact('admin', 'org', 'branch', 'store');
    }

    public function test_facts_without_ai_then_the_narrative_once_ai_is_on(): void
    {
        ['admin' => $admin, 'org' => $org] = $this->scenario();

        $response = $this->getJson('/api/v1/ai/insights?period=daily&date=2026-11-06')->assertOk();

        $response->assertJsonPath('data.narrative', null)
            ->assertJsonPath('data.narrative_status', 'disabled')
            ->assertJsonPath('data.ai_enabled', false)
            ->assertJsonPath('data.cached', true)
            ->assertJsonPath('data.facts.date_from', '2026-11-06')
            ->assertJsonPath('data.facts.previous_from', '2026-11-05')
            ->assertJsonPath('data.facts.kpis.net_sales', ['value' => '500.00', 'previous' => '150.00', 'change' => '350.00', 'change_pct' => '233.33'])
            ->assertJsonPath('data.facts.kpis.orders', ['value' => 1, 'previous' => 2, 'change' => -1, 'change_pct' => '-50.00'])
            ->assertJsonPath('data.facts.kpis.margin', ['value' => '60.00', 'previous' => '60.00'])
            ->assertJsonPath('data.facts.margin_drop.flagged', false)
            ->assertJsonPath('data.facts.return_spike.flagged', false)
            ->assertJsonPath('data.facts.top_movers.up.0.product', 'Soap')
            ->assertJsonPath('data.facts.top_movers.up.0.change', '400.00')
            ->assertJsonPath('data.facts.top_movers.down.0.product', 'Tea')
            ->assertJsonPath('data.facts.top_movers.down.0.change', '-50.00')
            ->assertJsonPath('data.facts.anomalies.0.date', '2026-11-06')
            ->assertJsonPath('data.facts.anomalies.0.direction', 'spike')
            ->assertJsonPath('data.facts.anomalies.0.history_days', 27)
            // (14 × 100 + 13 × 110 + 50 of tea) ÷ 27 days
            ->assertJsonPath('data.facts.anomalies.0.mean', '106.67')
            ->assertJsonCount(1, 'data.facts.anomalies');
        $slow = array_column($response->json('data.facts.slow_movers.items'), 'product');
        $this->assertContains('Old Stock', $slow);
        $this->assertNotContains('Soap', $slow); // sold in the 30 days up to 6 Nov
        $this->assertNotContains('Tea', $slow);  // not in stock
        $this->assertSame('Rice', $response->json('data.facts.shortage_risk.items.0.product'));
        $this->assertSame(7, $response->json('data.facts.shortage_risk.items.0.lead_time_days'));
        $this->assertTrue((float) $response->json('data.facts.shortage_risk.items.0.days_of_cover') < 7);
        $this->assertSame(1, AiInsight::query()->withoutGlobalScopes()->count());

        // AI on: the cached facts get their narrative on the next read, once.
        $fake = $this->fakeAi()->answer('- Net sales **500.00**, up 233.33 % on 5 Nov.');
        $this->getJson('/api/v1/ai/insights?period=daily&date=2026-11-06')->assertOk()
            ->assertJsonPath('data.narrative', '- Net sales **500.00**, up 233.33 % on 5 Nov.')
            ->assertJsonPath('data.narrative_status', 'ok')
            ->assertJsonPath('data.ai_enabled', true);
        $this->getJson('/api/v1/ai/insights?period=daily&date=2026-11-06')->assertOk()->assertJsonPath('data.narrative_status', 'ok');
        $this->assertSame(1, $fake->callCount());
        $prompt = $fake->requests[0]['conversation'];
        $this->assertStringContainsString('Never invent', $prompt->system);
        $this->assertStringContainsString('"net_sales"', $prompt->messages[0]->text());
        $this->assertStringNotContainsString('product_id', $prompt->messages[0]->text());
        $this->assertSame([], $fake->requests[0]['tools']);
        $this->assertSame(['insights', 'ok'], [AiRequest::query()->withoutGlobalScopes()->value('feature'), AiRequest::query()->withoutGlobalScopes()->value('status')]);
        $this->assertSame((string) $admin->id, AiRequest::query()->withoutGlobalScopes()->value('user_id'));
    }

    public function test_cost_visibility_and_purchasing_scope_are_cached_separately(): void
    {
        ['admin' => $admin, 'org' => $org, 'branch' => $branch] = $this->scenario();
        $roleId = $this->postJson('/api/v1/roles', ['name' => 'Insights reader', 'permissions' => ['ai.insights']])->assertCreated()->json('data.id');
        $reader = $this->createUserWithRole($org, Role::query()->withoutGlobalScopes()->findOrFail($roleId), [$branch->id]);

        $this->actingAsUser($reader);
        $response = $this->getJson('/api/v1/ai/insights?date=2026-11-06')->assertOk()
            ->assertJsonPath('data.facts.branch_id', $branch->id)
            ->assertJsonPath('data.facts.kpis.net_sales.value', '500.00')
            ->assertJsonPath('data.facts.margin_drop', null)
            ->assertJsonPath('data.facts.shortage_risk', null)
            ->assertJsonPath('data.facts.omitted', ['gross_profit', 'margin', 'margin_drop', 'stock_value']);
        $this->assertArrayNotHasKey('gross_profit', $response->json('data.facts.kpis'));
        $this->assertArrayNotHasKey('stock_value', $response->json('data.facts.slow_movers.items.0'));
        $this->assertSame([[$branch->id, false]], AiInsight::query()->withoutGlobalScopes()->get()->map(fn ($r) => [$r->scope_key, $r->with_cost])->all());

        // The admin's branch view is another row (with cost); validation of the branch and the date.
        $this->actingAsUser($admin);
        $this->getJson('/api/v1/ai/insights?date=2026-11-06&branch_id='.$branch->id)->assertOk()->assertJsonPath('data.facts.kpis.gross_profit.value', '300.00');
        $this->assertSame(2, AiInsight::query()->withoutGlobalScopes()->count());
        ['branch' => $foreign] = $this->provisionTenant('Other Shop');
        $this->getJson('/api/v1/ai/insights?branch_id='.$foreign->id)->assertStatus(422)->assertJsonValidationErrorFor('branch_id', 'error.details');
        $this->getJson('/api/v1/ai/insights?date=2026-11-08')->assertStatus(422);
        $this->getJson('/api/v1/ai/insights?period=weekly')->assertStatus(422);
    }

    public function test_a_running_period_is_computed_live_and_monthly_compares_the_same_days(): void
    {
        $this->scenario();

        $this->getJson('/api/v1/ai/insights?period=monthly')->assertOk()
            ->assertJsonPath('data.cached', false)
            ->assertJsonPath('data.facts.date_from', '2026-11-01')
            ->assertJsonPath('data.facts.date_to', '2026-11-07')
            ->assertJsonPath('data.facts.previous_from', '2026-10-01')
            ->assertJsonPath('data.facts.previous_to', '2026-10-07');
        $this->assertSame(0, AiInsight::query()->withoutGlobalScopes()->count());
    }

    public function test_the_daily_job_is_idempotent_and_starts_at_07_30_local_time(): void
    {
        // Pin the clock before provisioning: the job walks organizations oldest first, and the
        // scripted answers below assume this one is older than "Other Shop".
        $this->travelTo($this->dhaka('2026-11-07 06:00'));
        ['org' => $org, 'branch' => $branch] = $this->scenario();
        $other = $this->provisionTenant('Other Shop');
        $fake = $this->fakeAi()->answer('Org.')->answer('Branch.')->answer('Other org.')->answer('Other branch.');

        $this->travelTo($this->dhaka('2026-11-07 07:00'));
        $this->artisan('ai:daily-insights')->assertSuccessful();
        $this->assertSame(0, AiInsight::query()->withoutGlobalScopes()->count());

        $this->travelTo($this->dhaka('2026-11-07 07:30'));
        $this->artisan('ai:daily-insights')->expectsOutputToContain('Generated 4 daily insight(s); 0 already cached.')->assertSuccessful();
        $this->artisan('ai:daily-insights')->expectsOutputToContain('Generated 0 daily insight(s); 4 already cached.')->assertSuccessful();
        $this->assertSame(4, $fake->callCount());

        $rows = AiInsight::query()->withoutGlobalScopes()->where('organization_id', $org->id)->orderBy('scope_key')->get();
        $this->assertSame(['all', $branch->id], $rows->sortBy(fn ($r) => $r->scope_key === 'all' ? 0 : 1)->pluck('scope_key')->values()->all());
        $this->assertTrue($rows->every(fn ($r) => $r->period === 'daily' && $r->period_date->toDateString() === '2026-11-06' && $r->with_cost && $r->narrative_status === 'ok'));
        $this->assertSame('500.00', $rows->firstWhere('scope_key', 'all')->facts['kpis']['net_sales']['value']);
        // The other organization's insight holds only its own (empty) figures.
        $theirs = AiInsight::query()->withoutGlobalScopes()->where('organization_id', $other['organization']->id)->where('scope_key', 'all')->sole();
        $this->assertSame('0.00', $theirs->facts['kpis']['net_sales']['value']);
        $this->assertSame(4, AiRequest::query()->withoutGlobalScopes()->where('feature', 'daily_insights')->count());

        // A user reading the cached day gets the stored narrative; no new model call.
        $this->getJson('/api/v1/ai/insights?date=2026-11-06')->assertOk()->assertJsonPath('data.narrative', 'Org.');
        $this->assertSame(4, $fake->callCount());
    }
}
