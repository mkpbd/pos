<?php

namespace App\Modules\Loyalty\Tests\Feature;

use App\Modules\Customers\Infrastructure\Models\Customer;
use App\Modules\Loyalty\Infrastructure\Models\LoyaltyTransaction;
use App\Modules\Payments\Infrastructure\Models\Payment;
use App\Modules\Sales\Tests\Concerns\InteractsWithSales;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use LogicException;
use Tests\TestCase;

class LoyaltyTest extends TestCase
{
    use InteractsWithSales, InteractsWithTenancy, RefreshDatabase;

    public function test_points_are_earned_redeemed_and_reversed_with_cancellations(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $rice = $this->sellable($org, 'Rice', '125.00');
        $store = $this->mainStoreId($org);
        $rina = $this->customer($org, 'Rina');
        $this->actingAsUser($admin);
        $this->stockUp($store, $rice, '100');

        // Off by default: nothing is earned and nothing can be redeemed.
        $this->checkout($this->cart($store, [[$rice, '1']], [['cash', '125']], ['customer_id' => $rina->id]))->assertCreated();
        $this->assertSame(0, $this->balance($rina));

        $this->putJson('/api/v1/loyalty/settings', ['is_enabled' => true, 'spend_amount' => '100', 'points_per_spend' => 1, 'point_value' => '1.00', 'min_redeem_points' => 5])
            ->assertOk()->assertJsonPath('data.is_enabled', true);

        $first = $this->checkout($this->cart($store, [[$rice, '10']], [['cash', '1250']], ['customer_id' => $rina->id]))->assertCreated()->json('data');
        $this->assertSame(12, $this->balance($rina), '12 full hundreds');

        $pay = fn (array $payments, ?Customer $customer = null) => $this->checkout($this->cart($store, [[$rice, '1']], $payments, $customer ? ['customer_id' => $customer->id] : []));
        $pay([['loyalty_points', '5'], ['cash', '120']])->assertStatus(422)->assertJsonPath('error.code', 'CUSTOMER_REQUIRED');
        $pay([['loyalty_points', '4'], ['cash', '121']], $rina)->assertStatus(422)->assertJsonPath('error.code', 'LOYALTY_AMOUNT_INVALID');
        $pay([['loyalty_points', '5.50'], ['cash', '119.50']], $rina)->assertStatus(422)->assertJsonPath('error.code', 'LOYALTY_AMOUNT_INVALID');
        $pay([['loyalty_points', '13'], ['cash', '112']], $rina)->assertStatus(422)->assertJsonPath('error.code', 'INSUFFICIENT_POINTS');
        $this->assertSame(12, $this->balance($rina), 'failed checkouts roll the points back');

        $second = $pay([['loyalty_points', '10'], ['cash', '115']], $rina)
            ->assertCreated()
            ->assertJsonPath('data.payments.0.method', 'loyalty_points')
            ->assertJsonPath('data.payments.0.amount', '10.00')
            ->json('data');
        // 12 − 10 redeemed + 1 earned on the 115 paid in money.
        $this->assertSame(3, $this->balance($rina));
        $this->assertSame(0, Payment::query()->where('source_id', $second['id'])->where('method', 'loyalty_points')->count());

        $this->postJson("/api/v1/sales/{$second['id']}/cancel", ['reason' => 'Mistake'])->assertOk();
        $this->assertSame(12, $this->balance($rina), 'earned point taken back, redeemed points given back');
        $this->postJson("/api/v1/sales/{$first['id']}/cancel", ['reason' => 'Mistake'])->assertOk();
        $this->assertSame(0, $this->balance($rina));

        $this->getJson("/api/v1/loyalty/customers/{$rina->id}")
            ->assertOk()
            ->assertJsonPath('data.lifetime_earned', 13)
            ->assertJsonPath('data.lifetime_redeemed', 10)
            ->assertJsonPath('data.transactions.0.type', 'earn_reversal');

        $this->expectException(LogicException::class);
        LoyaltyTransaction::query()->firstOrFail()->update(['points' => 1000]);
    }

    public function test_returns_take_back_earned_points_and_refund_redeemed_ones(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $rice = $this->sellable($org, 'Rice', '100.00');
        $store = $this->mainStoreId($org);
        $rina = $this->customer($org, 'Rina');
        $this->actingAsUser($admin);
        $this->stockUp($store, $rice, '100');
        $this->putJson('/api/v1/loyalty/settings', ['is_enabled' => true, 'spend_amount' => '10', 'points_per_spend' => 1, 'point_value' => '0.50']);
        $this->postJson("/api/v1/loyalty/customers/{$rina->id}/adjust", ['points' => 40, 'notes' => 'Welcome bonus'])->assertCreated()->assertJsonPath('data.balance', 40);

        // 4 × 100 = 400: 20 paid with 40 points, 380 in cash → 38 points earned.
        $sale = $this->checkout($this->cart($store, [[$rice, '4']], [['loyalty_points', '20'], ['cash', '380']], ['customer_id' => $rina->id]))->assertCreated()->json('data');
        $this->assertSame(38, $this->balance($rina));

        // Half the goods back, 10 of it refunded as points: 19 earned points go, 20 points come back.
        $this->postJson('/api/v1/returns', [
            'sale_id' => $sale['id'],
            'lines' => [['sale_line_id' => $sale['lines'][0]['id'], 'quantity' => '2']],
            'refunds' => [['method' => 'loyalty_points', 'amount' => '10'], ['method' => 'cash', 'amount' => '190']],
        ], ['Idempotency-Key' => (string) Str::uuid()])->assertCreated()->assertJsonPath('data.status', 'completed');
        $this->assertSame(39, $this->balance($rina));

        $this->postJson('/api/v1/returns', [
            'sale_id' => $sale['id'],
            'lines' => [['sale_line_id' => $sale['lines'][0]['id'], 'quantity' => '2']],
            'refunds' => [['method' => 'loyalty_points', 'amount' => '10.01'], ['method' => 'cash', 'amount' => '189.99']],
        ], ['Idempotency-Key' => (string) Str::uuid()])->assertStatus(422)->assertJsonPath('error.details', ['refunds.0.amount' => ['At most 10.00 can be refunded by Loyalty points.']]);
    }

    public function test_cashiers_read_balances_and_only_managers_configure(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $rina = $this->customer($org, 'Rina');
        $this->actingAsUser($admin);
        $this->postJson("/api/v1/loyalty/customers/{$rina->id}/adjust", ['points' => 7, 'notes' => 'Goodwill'])->assertCreated();

        $this->actingAsUser($this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]));
        $this->getJson('/api/v1/loyalty/settings')->assertOk()->assertJsonPath('data.is_enabled', false);
        $this->getJson("/api/v1/loyalty/balances?customer_ids[]={$rina->id}")->assertOk()->assertJsonPath("data.{$rina->id}", 7);
        $this->putJson('/api/v1/loyalty/settings', ['is_enabled' => true])->assertForbidden();
        $this->postJson("/api/v1/loyalty/customers/{$rina->id}/adjust", ['points' => 1, 'notes' => 'x'])->assertForbidden();

        ['admin' => $stranger] = $this->provisionTenant('Other Shop');
        $this->actingAsUser($stranger);
        $this->getJson("/api/v1/loyalty/customers/{$rina->id}")->assertNotFound();
        $this->getJson("/api/v1/loyalty/balances?customer_ids[]={$rina->id}")->assertOk()->assertJsonPath("data.{$rina->id}", 0);
    }

    private function balance(Customer $customer): int
    {
        return (int) $this->getJson("/api/v1/loyalty/balances?customer_ids[]={$customer->id}")->assertOk()->json("data.{$customer->id}");
    }
}
