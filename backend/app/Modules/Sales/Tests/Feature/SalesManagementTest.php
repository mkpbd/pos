<?php

namespace App\Modules\Sales\Tests\Feature;

use App\Modules\Sales\Infrastructure\Models\SalePayment;
use App\Modules\Sales\Tests\Concerns\InteractsWithSales;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Cancellation, history and the daily summary.
 */
class SalesManagementTest extends TestCase
{
    use InteractsWithSales, InteractsWithTenancy, RefreshDatabase;

    public function test_cancelling_restocks_batches_and_reverses_payments(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $syrup = $this->sellable($org, 'Syrup', '80.00', ['batches' => true]);
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $this->stockUp($store, $syrup, '3', '40.00', 'B1', now()->addMonth()->toDateString());
        $sale = $this->checkout($this->cart($store, [[$syrup, '2']], [['card', '100'], ['cash', '100']]))->assertCreated()->json('data');

        $this->postJson("/api/v1/sales/{$sale['id']}/cancel", ['reason' => 'Customer changed mind'])
            ->assertOk()
            ->assertJsonPath('data.status', 'cancelled')
            ->assertJsonPath('data.cancellation_reason', 'Customer changed mind')
            ->assertJsonPath('data.payments.2.kind', 'reversal')
            ->assertJsonPath('data.payments.2.amount', '-100.00')
            ->assertJsonPath('data.payments.3.amount', '-60.00');

        $this->assertSame('3.000', $this->stockRow($syrup->id, $store)['quantity']);
        $this->assertSame('0.00', number_format((float) SalePayment::query()->sum('amount'), 2));
        $movements = $this->getJson("/api/v1/inventory/movements?variant_id={$syrup->id}&sort=created_at")->json('data');
        $this->assertSame(['opening', 'sale', 'sale_cancellation'], array_column($movements, 'type'));
        $this->assertSame('40.0000', $movements[2]['unit_cost']);

        $this->postJson("/api/v1/sales/{$sale['id']}/cancel", ['reason' => 'again'])
            ->assertStatus(422)->assertJsonPath('error.code', 'SALE_ALREADY_CANCELLED');
        $this->getJson('/api/v1/audit-logs?action=sale.cancelled')->assertOk()->assertJsonCount(1, 'data');
    }

    public function test_cashiers_can_sell_but_not_cancel(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $soap = $this->sellable($org, 'Soap', '10.00');
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $this->stockUp($store, $soap, '5');
        $this->actingAsUser($this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]));

        $id = $this->checkout($this->cart($store, [[$soap, '1']], [['cash', '10']]))->assertCreated()->json('data.id');
        $this->getJson("/api/v1/sales/{$id}")->assertOk()->assertJsonPath('data.cost_total', null);
        $this->getJson('/api/v1/sales/summary')->assertOk()->assertJsonPath('data.cost', null)->assertJsonPath('data.gross_profit', null);
        $this->postJson("/api/v1/sales/{$id}/cancel", ['reason' => 'x'])->assertForbidden();
    }

    public function test_history_filters_and_daily_summary(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $soap = $this->sellable($org, 'Soap', '100.00', ['tax' => '10', 'cost' => '60.00']);
        $store = $this->mainStoreId($org);
        $customer = $this->customer($org, 'Rina', creditLimit: '500');
        $this->actingAsUser($admin);
        $this->stockUp($store, $soap, '20', '60.00');

        $this->checkout($this->cart($store, [[$soap, '1']], [['cash', '200']]));                        // 110 cash, change 90
        $this->checkout($this->cart($store, [[$soap, '2']], [['card', '200']], ['customer_id' => $customer->id])); // 220: 200 card, 20 due
        $cancelled = $this->checkout($this->cart($store, [[$soap, '1']], [['mobile_banking', '110']]))->json('data.id');
        $this->postJson("/api/v1/sales/{$cancelled}/cancel", ['reason' => 'Mistake'])->assertOk();

        $this->getJson('/api/v1/sales?status=completed')->assertOk()->assertJsonCount(2, 'data');
        $this->getJson("/api/v1/sales?customer_id={$customer->id}")->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.customer.name', 'Rina')
            ->assertJsonPath('data.0.due_total', '20.00');
        $this->getJson('/api/v1/sales?search=000003')->assertOk()->assertJsonPath('data.0.status', 'cancelled');

        $summary = $this->getJson('/api/v1/sales/summary')->assertOk()->json('data');
        $this->assertSame(2, $summary['sales_count']);
        $this->assertSame('300.00', $summary['gross_sales']);
        $this->assertSame('30.00', $summary['tax']);
        $this->assertSame('330.00', $summary['total']);
        $this->assertSame('180.00', $summary['cost']);
        $this->assertSame('120.00', $summary['gross_profit']);
        $this->assertSame('20.00', $summary['due']);
        $this->assertSame(1, $summary['cancelled_count']);
        $this->assertSame(
            ['cash' => '110.00', 'card' => '200.00', 'mobile_banking' => '0.00'],
            array_column($summary['payments'], 'amount', 'method'),
        );
    }
}
