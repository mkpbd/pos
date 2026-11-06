<?php

namespace App\Modules\Purchasing\Tests\Feature;

use App\Modules\Branches\Infrastructure\Models\Store;
use App\Modules\Organizations\Infrastructure\Models\Organization;
use App\Modules\Purchasing\Tests\Concerns\BuildsSupplyChain;
use App\Modules\Sales\Tests\Concerns\InteractsWithSales;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * SC1: reorder suggestions per store — inputs from stock, open orders, transfers in transit,
 * sales velocity, rules and the supplier catalog; source-store transfers; filters, paging,
 * permissions and isolation.
 */
class ReorderSuggestionsTest extends TestCase
{
    use BuildsSupplyChain, InteractsWithSales, InteractsWithTenancy, RefreshDatabase;

    private function suggestions(string $store, string $query = ''): array
    {
        return collect($this->getJson("/api/v1/purchasing/reorder-suggestions?store_id={$store}{$query}")->assertOk()->json('data'))
            ->keyBy('variant.product_name')->all();
    }

    private function warehouse(Organization $org): string
    {
        $branch = $this->createBranch($org, 'WH');

        return $this->inTenant($org, fn () => Store::query()->where('branch_id', $branch->id)->firstOrFail()->id);
    }

    public function test_suggestion_row_from_stock_orders_rules_and_catalog(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $juice = $this->stockedVariant($org, 'Mango Juice');
        $rice = $this->stockedVariant($org, 'Miniket Rice', reorderLevel: '50', decimalUnit: true);
        $plenty = $this->stockedVariant($org, 'Plenty Soap', reorderLevel: '5');
        $pran = $this->supplier($org, 'Pran');
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $this->stockUp($store, $juice, '10', '18.00');
        $this->stockUp($store, $rice, '20.5', '60.00');
        $this->stockUp($store, $plenty, '40');
        $this->catalogRow($pran->id, $juice->id, ['unit_cost' => '18', 'pack_size' => '24', 'lead_time_days' => 2, 'is_preferred' => true]);
        $this->putJson('/api/v1/inventory/reorder-rules', ['store_id' => $store, 'rules' => [['variant_id' => $juice->id, 'min_qty' => '20']]])->assertOk();
        // 6 ordered (placed), 5 in a draft that does not count yet.
        $order = fn (string $qty) => $this->postJson('/api/v1/purchasing/orders', [
            'supplier_id' => $pran->id, 'store_id' => $store, 'order_date' => now()->toDateString(),
            'lines' => [['variant_id' => $juice->id, 'quantity' => $qty, 'unit_cost' => '18']],
        ])->assertCreated()->json('data.id');
        $this->postJson('/api/v1/purchasing/orders/'.$order('6').'/place')->assertOk();
        $order('5');

        $response = $this->getJson("/api/v1/purchasing/reorder-suggestions?store_id={$store}")->assertOk()
            ->assertJsonPath('meta.pagination.total', 2)
            ->assertJsonPath('meta.store.id', $store)
            ->assertJsonPath('meta.source_store', null)
            ->assertJsonPath('meta.settings', ['coverage_days' => 14, 'velocity_days' => 30, 'safety_days' => 3]);
        $rows = collect($response->json('data'))->keyBy('variant.product_name');
        $this->assertSame(['Mango Juice', 'Miniket Rice'], $rows->keys()->all());

        $this->assertSame([
            'variant' => ['id' => $juice->id, 'sku' => $juice->sku, 'product_name' => 'Mango Juice', 'variant_name' => null, 'unit' => 'pcs', 'allow_decimal' => false],
            'on_hand' => '10.000',
            'on_order' => '6.000',
            'in_transit' => '0.000',
            'avg_daily' => '0.000',
            'reorder_point' => '20.000',
            'target' => '20.000',
            'suggested_purchase' => '24.000', // 20 − 16 = 4 → one pack of 24
            'suggested_transfer' => '0.000',
            'supplier' => ['id' => $pran->id, 'code' => $pran->code, 'name' => 'Pran'],
            'unit_cost' => '18.0000',
            'lead_time_days' => 2,
            'reason' => 'below_min',
            'days_of_cover' => null,
            'pack_size' => '24.000',
            'min_order_qty' => null,
            'min_qty' => '20.000',
            'max_qty' => null,
            'has_rule' => true,
            'draft_on_order' => '5.000',
        ], $rows['Mango Juice']);

        // No rule: the variant's reorder level is the minimum; no supplier: the variant's cost.
        $this->assertSame('50.000', $rows['Miniket Rice']['reorder_point']);
        $this->assertSame('30.000', $rows['Miniket Rice']['suggested_purchase']); // 29.5 kg → whole pack of 1
        $this->assertNull($rows['Miniket Rice']['supplier']);
        $this->assertSame('10.0000', $rows['Miniket Rice']['unit_cost']);
        $this->assertSame(7, $rows['Miniket Rice']['lead_time_days']);
        $this->assertFalse($rows['Miniket Rice']['has_rule']);

        // Filters and paging.
        $this->assertSame(['Mango Juice'], array_keys($this->suggestions($store, "&supplier_id={$pran->id}")));
        $this->assertSame(['Miniket Rice'], array_keys($this->suggestions($store, '&search=rice')));
        $this->assertSame([], $this->suggestions($store, '&only=transfer'));
        $this->getJson("/api/v1/purchasing/reorder-suggestions?store_id={$store}&per_page=1&page=2")
            ->assertJsonPath('meta.pagination.total', 2)->assertJsonPath('meta.pagination.last_page', 2)->assertJsonPath('data.0.variant.product_name', 'Miniket Rice');
        $this->getJson("/api/v1/purchasing/reorder-suggestions?store_id={$store}&only=everything")->assertStatus(422);
        $this->getJson('/api/v1/purchasing/reorder-suggestions')->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['store_id']]]);
    }

    public function test_last_purchase_cost_is_used_without_a_supplier(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $juice = $this->stockedVariant($org, 'Mango Juice', reorderLevel: '20');
        $pran = $this->supplier($org, 'Pran');
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $this->postJson('/api/v1/purchasing/receipts', [
            'supplier_id' => $pran->id, 'store_id' => $store, 'invoice_date' => now()->toDateString(),
            'lines' => [['variant_id' => $juice->id, 'quantity' => '4', 'unit_cost' => '17.25', 'tax_rate' => '0']],
        ])->assertCreated();

        $row = $this->suggestions($store)['Mango Juice'];
        $this->assertNull($row['supplier']);
        $this->assertSame('17.2500', $row['unit_cost']);
        $this->assertSame('16.000', $row['suggested_purchase']);
    }

    public function test_sales_velocity_drives_reorder_point_and_target(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $juice = $this->sellable($org, 'Mango Juice', '25.00');
        $pran = $this->supplier($org, 'Pran');
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $this->stockUp($store, $juice, '100', '18.00');
        $this->catalogRow($pran->id, $juice->id, ['unit_cost' => '18', 'lead_time_days' => 4, 'is_preferred' => true]);

        // A sale older than the 30-day window does not count.
        $this->travelTo(now()->subDays(40));
        $this->checkout($this->cart($store, [[$juice, '20']], [['cash', '500']]))->assertCreated();
        $this->travelBack();
        $this->checkout($this->cart($store, [[$juice, '45']], [['cash', '1125']]))->assertCreated();

        // on hand 35; 45 sold / 30 days = 1.5/day; (4 lead + 3 safety) × 1.5 = 10.5 → 11; + 14 × 1.5 = 21 → target 32.
        $this->assertSame([], $this->suggestions($store));

        $this->checkout($this->cart($store, [[$juice, '25']], [['cash', '625']]))->assertCreated();
        // on hand 10; 70 sold → 2.333/day; 7 days → 16.33 → 17; 14 days → 32.67 → 33; target 50.
        $row = $this->suggestions($store)['Mango Juice'];
        $this->assertSame('2.333', $row['avg_daily']);
        $this->assertSame('17.000', $row['reorder_point']);
        $this->assertSame('50.000', $row['target']);
        $this->assertSame('40.000', $row['suggested_purchase']);
        $this->assertSame('velocity', $row['reason']);
        $this->assertSame('4.3', $row['days_of_cover']);
    }

    public function test_source_store_transfers_and_stock_in_transit(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $juice = $this->stockedVariant($org, 'Mango Juice');
        $soap = $this->stockedVariant($org, 'Soap');
        $pran = $this->supplier($org, 'Pran');
        $store = $this->mainStoreId($org);
        $warehouse = $this->warehouse($org);
        $this->actingAsUser($admin);
        $this->stockUp($store, $juice, '10');
        $this->stockUp($warehouse, $juice, '30');
        $this->catalogRow($pran->id, $juice->id, ['unit_cost' => '18', 'pack_size' => '24', 'is_preferred' => true]);
        $this->catalogRow($pran->id, $soap->id, ['unit_cost' => '5', 'is_preferred' => true]);
        $this->putJson('/api/v1/inventory/reorder-rules', ['store_id' => $store, 'rules' => [
            ['variant_id' => $juice->id, 'min_qty' => '20', 'max_qty' => '50'],
            ['variant_id' => $soap->id, 'min_qty' => '2', 'max_qty' => '6'],
        ]])->assertOk();
        // 5 already on the way from the warehouse.
        $this->postJson('/api/v1/inventory/transfers', ['from_store_id' => $warehouse, 'to_store_id' => $store, 'lines' => [['variant_id' => $juice->id, 'quantity' => '5']]])->assertCreated();

        // Without a source store everything is bought.
        $rows = $this->suggestions($store);
        $this->assertSame('5.000', $rows['Mango Juice']['in_transit']);
        $this->assertSame('48.000', $rows['Mango Juice']['suggested_purchase']); // 35 → 2 packs
        $this->assertSame('0.000', $rows['Mango Juice']['suggested_transfer']);

        $this->patchJson('/api/v1/inventory/replenishment-settings', ['source_store_id' => $warehouse])->assertOk();
        $response = $this->getJson("/api/v1/purchasing/reorder-suggestions?store_id={$store}")->assertOk()
            ->assertJsonPath('meta.source_store.id', $warehouse);
        $rows = collect($response->json('data'))->keyBy('variant.product_name');
        // Need 35: the warehouse spares its 25 on hand, the other 10 are bought as one pack of 24.
        $this->assertSame('25.000', $rows['Mango Juice']['suggested_transfer']);
        $this->assertSame('24.000', $rows['Mango Juice']['suggested_purchase']);
        // Soap: nothing at the warehouse → purchase only.
        $this->assertSame('0.000', $rows['Soap']['suggested_transfer']);
        $this->assertSame('6.000', $rows['Soap']['suggested_purchase']);
        $this->assertSame(['Mango Juice'], array_keys($this->suggestions($store, '&only=transfer')));
        $this->assertSame(['Mango Juice', 'Soap'], array_keys($this->suggestions($store, '&only=purchase')));

        // The warehouse keeps its own reorder point: a rule of 20 leaves 5 to spare.
        $this->putJson('/api/v1/inventory/reorder-rules', ['store_id' => $warehouse, 'rules' => [['variant_id' => $juice->id, 'min_qty' => '20']]])->assertOk();
        $row = $this->suggestions($store)['Mango Juice'];
        $this->assertSame('5.000', $row['suggested_transfer']);
        $this->assertSame('48.000', $row['suggested_purchase']); // 30 → 2 packs

        // The source store itself gets no transfer suggestions.
        $this->stockUp($warehouse, $soap, '1');
        $this->putJson('/api/v1/inventory/reorder-rules', ['store_id' => $warehouse, 'rules' => [['variant_id' => $soap->id, 'min_qty' => '5', 'max_qty' => '10']]])->assertOk();
        $this->getJson("/api/v1/purchasing/reorder-suggestions?store_id={$warehouse}")->assertJsonPath('meta.source_store', null);
        $this->assertSame('0.000', $this->suggestions($warehouse)['Soap']['suggested_transfer']);
    }

    public function test_untracked_archived_and_inactive_supplier_rows(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $juice = $this->stockedVariant($org, 'Mango Juice', reorderLevel: '10');
        $service = $this->sellable($org, 'Delivery', '60', ['service' => true]);
        $pran = $this->supplier($org, 'Pran');
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $this->catalogRow($pran->id, $juice->id, ['unit_cost' => '18', 'is_preferred' => true]);
        $this->putJson('/api/v1/inventory/reorder-rules', ['store_id' => $store, 'rules' => [['variant_id' => $service->id, 'min_qty' => '3']]])->assertStatus(422);

        $this->assertSame('Pran', $this->suggestions($store)['Mango Juice']['supplier']['name']);
        // An inactive supplier is not suggested (the row stays, flagged without supplier).
        $this->inTenant($org, fn () => $pran->forceFill(['is_active' => false])->save());
        $this->assertNull($this->suggestions($store)['Mango Juice']['supplier']);

        $this->inTenant($org, fn () => $juice->product->forceFill(['is_active' => false])->save());
        $this->assertSame([], $this->suggestions($store));
    }

    public function test_store_access_permissions_and_isolation(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $main] = $this->provisionTenant('Acme');
        ['admin' => $rival] = $this->provisionTenant('Rival');
        $this->stockedVariant($org, 'Mango Juice', reorderLevel: '10');
        $store = $this->mainStoreId($org);
        $north = $this->createBranch($org, 'NORTH');
        $northBuyer = $this->createUserWithRole($org, SystemRole::InventoryManager, [$north->id]);
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier, [$main->id]);
        $accountant = $this->createUserWithRole($org, SystemRole::Accountant, [$main->id]);

        $this->actingAsUser($accountant)->getJson("/api/v1/purchasing/reorder-suggestions?store_id={$store}")->assertOk()->assertJsonCount(1, 'data');
        $this->actingAsUser($cashier)->getJson("/api/v1/purchasing/reorder-suggestions?store_id={$store}")->assertForbidden();
        $this->actingAsUser($northBuyer)->getJson("/api/v1/purchasing/reorder-suggestions?store_id={$store}")
            ->assertStatus(422)->assertJsonPath('error.details.store_id.0', 'The selected store does not exist.');
        $this->actingAsUser($rival)->getJson("/api/v1/purchasing/reorder-suggestions?store_id={$store}")->assertStatus(422);
        $this->getJson("/api/v1/purchasing/reorder-suggestions?store_id={$store}&export=xlsx")->assertStatus(422);
    }
}
