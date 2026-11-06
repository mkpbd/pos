<?php

namespace App\Modules\AI\Tests\Feature;

use App\Modules\AI\Tests\Support\InteractsWithAi;
use App\Modules\Customers\Infrastructure\Models\Customer;
use App\Modules\Organizations\Infrastructure\Models\Organization;
use App\Modules\Products\Infrastructure\Models\ProductVariant;
use App\Modules\Reports\Tests\Concerns\BuildsReportData;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Infrastructure\Models\Role;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Customer insights: RFM segments on crafted purchases (12-month window), masked top customers,
 * loyalty suggestions from point balances, and segment aggregates only for the model.
 */
class CustomerInsightsTest extends TestCase
{
    use BuildsReportData, InteractsWithAi, InteractsWithTenancy, RefreshDatabase;

    private function buy(Organization $org, string $store, ProductVariant $variant, Customer $customer, string $amount, string $day): void
    {
        $order = $this->webOrder($org, $store, [['variant' => $variant, 'quantity' => '1', 'unit_price' => $amount, 'unit_cost' => '1.00']],
            ['delivered_at' => $this->dhaka($day.' 12:00'), 'placed_at' => $this->dhaka($day.' 09:00')]);
        DB::table('orders')->where('id', $order['id'])->update(['customer_id' => $customer->id]);
    }

    private function customerWithPhone(Organization $org, string $name, string $phone): Customer
    {
        $customer = $this->customer($org, $name);
        DB::table('customers')->where('id', $customer->id)->update(['phone' => $phone]);

        return $customer;
    }

    public function test_rfm_segments_masked_customers_and_loyalty_suggestions(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $soap = $this->sellable($org, 'Soap', '100.00');
        $store = $this->mainStoreId($org);
        $a = $this->customerWithPhone($org, 'Anika Rahman', '01711000678');
        $b = $this->customerWithPhone($org, 'Babul Mia', '01811000111');
        $c = $this->customerWithPhone($org, 'Chumki Das', '01911000222');
        $d = $this->customerWithPhone($org, 'Dulal Shah', '01611000333');
        $e = $this->customerWithPhone($org, 'Eva Khan', '01511000444');
        $f = $this->customerWithPhone($org, 'Faruk Old', '01311000555');

        foreach (['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'] as $day) {
            $this->buy($org, $store, $soap, $a, '1000.00', $day);                      // champion
        }
        $this->buy($org, $store, $soap, $b, '300.00', '2026-11-06');                    // new
        foreach (['2026-04-18', '2026-04-19', '2026-04-20', '2026-04-21'] as $day) {
            $this->buy($org, $store, $soap, $c, '200.00', $day);                       // at risk: 200 days ago
        }
        $this->buy($org, $store, $soap, $d, '100.00', '2026-01-11');                    // hibernating: 300 days ago
        $this->buy($org, $store, $soap, $e, '150.00', '2026-10-17');
        $this->buy($org, $store, $soap, $e, '150.00', '2026-10-18');                    // loyal
        $this->buy($org, $store, $soap, $f, '999.00', '2025-10-01');                    // outside the 12 months
        DB::table('loyalty_settings')->insert(['id' => (string) Str::uuid(), 'organization_id' => $org->id, 'is_enabled' => true,
            'spend_amount' => '100.00', 'points_per_spend' => 1, 'point_value' => '0.50', 'min_redeem_points' => 0, 'created_at' => now(), 'updated_at' => now()]);
        foreach ([[$c, 120], [$d, 40], [$a, 10]] as [$customer, $points]) {
            DB::table('loyalty_accounts')->insert(['id' => (string) Str::uuid(), 'organization_id' => $org->id, 'customer_id' => $customer->id,
                'balance' => $points, 'lifetime_earned' => $points, 'lifetime_redeemed' => 0, 'created_at' => now(), 'updated_at' => now()]);
        }
        $this->travelTo($this->dhaka('2026-11-07 10:00'));
        $this->actingAsUser($admin);

        // The registry report behind it: named customers only, last purchase day.
        $rows = $this->rowsBy('sales_by_customer', ['date_from' => '2025-11-08', 'date_to' => '2026-11-07'], 'customer');
        $this->assertEqualsCanonicalizing(['Anika Rahman', 'Chumki Das', 'Eva Khan', 'Babul Mia', 'Dulal Shah'], array_keys($rows));
        $this->assertSame(['orders' => 5, 'net_sales' => '5000.00', 'average_ticket' => '1000.00', 'last_purchase_on' => '2026-11-05'],
            array_intersect_key($rows['Anika Rahman'], array_flip(['orders', 'net_sales', 'average_ticket', 'last_purchase_on'])));

        $fake = $this->fakeAi()->answer('- Remind the at-risk customer of their points.');
        $response = $this->getJson('/api/v1/ai/customer-insights')->assertOk()
            ->assertJsonPath('data.period', ['date_from' => '2025-11-08', 'date_to' => '2026-11-07'])
            ->assertJsonPath('data.customers_analyzed', 5)
            ->assertJsonPath('data.loyalty_program_enabled', true)
            ->assertJsonPath('data.narrative', '- Remind the at-risk customer of their points.')
            ->assertJsonPath('data.narrative_status', 'ok');

        $segments = collect($response->json('data.segments'))->keyBy('segment');
        $this->assertSame(['champions' => 1, 'loyal' => 1, 'potential' => 0, 'new' => 1, 'at_risk' => 1, 'hibernating' => 1], $segments->map(fn ($s) => $s['count'])->all());
        $champion = $segments['champions']['top_customers'][0];
        $this->assertSame(['customer_id' => $a->id, 'name' => 'Anika Rahman', 'phone_hint' => '…678', 'orders' => 5, 'net_sales' => '5000.00',
            'last_purchase_on' => '2026-11-05', 'recency_days' => 2, 'loyalty_points' => 10, 'scores' => ['r' => 4, 'f' => 5, 'm' => 5]], $champion);
        $this->assertSame('Chumki Das', $segments['at_risk']['top_customers'][0]['name']);
        $this->assertSame(200, $segments['at_risk']['top_customers'][0]['recency_days']);
        $this->assertSame('20.00', $segments['champions']['share']);
        $this->assertSame([], $segments['potential']['top_customers']);

        $suggestions = collect($response->json('data.suggestions'))->keyBy('code');
        $this->assertSame(['remind_points', 'win_back_points', 'reward_champions', 'second_purchase'], $suggestions->keys()->all());
        $this->assertSame(['customers' => 1, 'points' => 120, 'value' => '60.00'], array_intersect_key($suggestions['remind_points'], array_flip(['customers', 'points', 'value'])));

        // The model saw segment aggregates only.
        $sent = $fake->requests[0]['conversation']->messages[0]->text();
        foreach (['Anika', 'Chumki', 'Rahman', '01711000678', '678', $a->id, $c->id, 'phone'] as $private) {
            $this->assertStringNotContainsString($private, $sent);
        }
        $this->assertStringContainsString('"at_risk"', $sent);
        $this->assertStringContainsString('remind_points', $sent);

        // Cached for the hour: no second model call.
        $this->getJson('/api/v1/ai/customer-insights')->assertOk();
        $this->assertSame(1, $fake->callCount());

        // Without customers.view the top customers are anonymous; another organization's branch is rejected.
        $roleId = $this->postJson('/api/v1/roles', ['name' => 'Insights only', 'permissions' => ['ai.insights']])->assertCreated()->json('data.id');
        $reader = $this->createUserWithRole($org, Role::query()->withoutGlobalScopes()->findOrFail($roleId), [$branch->id]);
        $this->actingAsUser($reader);
        $anonymous = $this->getJson('/api/v1/ai/customer-insights')->assertOk();
        $top = collect($anonymous->json('data.segments'))->firstWhere('segment', 'champions')['top_customers'][0];
        $this->assertNull($top['name']);
        $this->assertNull($top['customer_id']);
        $this->assertSame('…678', $top['phone_hint']);
        ['branch' => $foreign] = $this->provisionTenant('Other Shop');
        $this->getJson('/api/v1/ai/customer-insights?branch_id='.$foreign->id)->assertStatus(422);
    }
}
