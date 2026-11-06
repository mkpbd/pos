<?php

namespace App\Modules\Reports\Tests\Feature;

use App\Modules\Reports\Tests\Concerns\BuildsReportData;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Phase 8: sales per named customer (POS + delivered web orders, net of returns; walk-ins left
 * out), the last purchase day in the organization's timezone, channel and branch filters.
 */
class SalesByCustomerReportTest extends TestCase
{
    use BuildsReportData, InteractsWithTenancy, RefreshDatabase;

    public function test_sales_per_customer_net_of_returns_without_walk_ins(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $soap = $this->sellable($org, 'Soap', '100.00', ['cost' => '40.00']);
        $rina = $this->customer($org, 'Rina');
        $karim = $this->customer($org, 'Karim');
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $this->travelTo($this->dhaka('2026-11-05 23:30')); // 17:30 UTC: still 5 Nov in Dhaka
        $this->stockUp($store, $soap, '20', '40.00');
        $sale = $this->checkout($this->cart($store, [[$soap, '3']], [['cash', '300']], ['customer_id' => $rina->id]))->assertCreated()->json('data');
        $this->checkout($this->cart($store, [[$soap, '1']], [['cash', '100']]))->assertCreated(); // walk-in
        $this->travelTo($this->dhaka('2026-11-07 10:00'));
        $this->posReturn($sale['id'], [[$sale['lines'][0]['id'], '1']], [['cash', '100']])->assertCreated();
        $order = $this->webOrder($org, $store, [['variant' => $soap, 'quantity' => '2', 'unit_price' => '100', 'unit_cost' => '40']], ['delivered_at' => $this->dhaka('2026-11-06 12:00')]);
        DB::table('orders')->where('id', $order['id'])->update(['customer_id' => $karim->id]);

        $params = ['date_from' => '2026-11-01', 'date_to' => '2026-11-07'];
        $response = $this->report('sales_by_customer', $params)->assertOk();
        $rows = collect($response->json('data'))->keyBy('customer');

        $this->assertSame(['Rina', 'Karim'], $rows->keys()->all());
        $this->assertSame(['orders' => 1, 'returns' => '100.00', 'net_sales' => '200.00', 'average_ticket' => '200.00', 'gross_profit' => '120.00', 'last_purchase_on' => '2026-11-05'],
            array_intersect_key($rows['Rina'], array_flip(['orders', 'returns', 'net_sales', 'average_ticket', 'gross_profit', 'last_purchase_on'])));
        $this->assertSame('2026-11-06', $rows['Karim']['last_purchase_on']);
        $response->assertJsonPath('meta.totals.net_sales', '400.00')->assertJsonPath('meta.totals.orders', 2);

        $this->assertSame(['Rina'], array_column($this->report('sales_by_customer', $params + ['channel' => 'pos'])->json('data'), 'customer'));
        $this->assertSame(['Karim'], array_column($this->report('sales_by_customer', $params + ['customer_id' => $karim->id])->json('data'), 'customer'));
    }
}
