<?php

namespace App\Modules\Inventory\Tests\Feature;

use App\Modules\Inventory\Tests\Concerns\InteractsWithStock;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class StockTransferTest extends TestCase
{
    use InteractsWithStock, InteractsWithTenancy, RefreshDatabase;

    /**
     * @return array<string, mixed>
     */
    private function setUpTwoBranches(): array
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $main] = $this->provisionTenant();
        $north = $this->createBranch($org, 'NORTH');
        $variant = $this->stockedVariant($org);
        $from = $this->mainStoreId($org);
        $to = $north->stores()->firstOrFail()->id;
        $this->actingAsUser($admin)->adjust($from, 'opening', ['variant_id' => $variant->id, 'quantity' => '10', 'unit_cost' => '6.50']);

        return compact('admin', 'org', 'main', 'north', 'variant', 'from', 'to');
    }

    public function test_dispatch_and_receive_move_stock_at_source_cost(): void
    {
        ['variant' => $variant, 'from' => $from, 'to' => $to] = $this->setUpTwoBranches();

        $transfer = $this->postJson('/api/v1/inventory/transfers', [
            'from_store_id' => $from, 'to_store_id' => $to,
            'lines' => [['variant_id' => $variant->id, 'quantity' => '4']],
        ])->assertCreated()
            ->assertJsonPath('data.status', 'in_transit')
            ->assertJsonPath('data.number', 'TRF-000001')
            ->assertJsonPath('data.lines.0.unit_cost', '6.5000')
            ->json('data');

        $this->assertSame('6.000', $this->stockRow($variant->id, $from)['quantity']);
        $this->assertNull($this->stockRow($variant->id, $to));

        $this->postJson("/api/v1/inventory/transfers/{$transfer['id']}/receive")->assertOk()->assertJsonPath('data.status', 'received');
        $this->assertSame('4.000', $this->stockRow($variant->id, $to)['quantity']);
        $this->assertSame('26.00', $this->stockRow($variant->id, $to)['value']);

        $this->postJson("/api/v1/inventory/transfers/{$transfer['id']}/receive")
            ->assertStatus(422)->assertJsonPath('error.code', 'TRANSFER_NOT_IN_TRANSIT');
        $this->postJson("/api/v1/inventory/transfers/{$transfer['id']}/cancel")
            ->assertStatus(422)->assertJsonPath('error.code', 'TRANSFER_NOT_IN_TRANSIT');
    }

    public function test_cancel_returns_goods_to_the_source(): void
    {
        ['variant' => $variant, 'from' => $from, 'to' => $to] = $this->setUpTwoBranches();
        $id = $this->postJson('/api/v1/inventory/transfers', [
            'from_store_id' => $from, 'to_store_id' => $to,
            'lines' => [['variant_id' => $variant->id, 'quantity' => '3']],
        ])->json('data.id');

        $this->postJson("/api/v1/inventory/transfers/{$id}/cancel")->assertOk()->assertJsonPath('data.status', 'cancelled');

        $this->assertSame('10.000', $this->stockRow($variant->id, $from)['quantity']);
        $types = array_column($this->getJson("/api/v1/inventory/movements?variant_id={$variant->id}")->json('data'), 'type');
        $this->assertEqualsCanonicalizing(['opening', 'transfer_out', 'transfer_in'], $types);
    }

    public function test_validation_and_stock_checks(): void
    {
        ['variant' => $variant, 'from' => $from, 'to' => $to] = $this->setUpTwoBranches();

        $this->postJson('/api/v1/inventory/transfers', ['from_store_id' => $from, 'to_store_id' => $from, 'lines' => [['variant_id' => $variant->id, 'quantity' => '1']]])
            ->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['to_store_id']]]);
        $this->postJson('/api/v1/inventory/transfers', ['from_store_id' => $from, 'to_store_id' => $to, 'lines' => [['variant_id' => $variant->id, 'quantity' => '0']]])
            ->assertStatus(422);
        $this->postJson('/api/v1/inventory/transfers', ['from_store_id' => $from, 'to_store_id' => $to, 'lines' => [['variant_id' => $variant->id, 'quantity' => '11']]])
            ->assertStatus(422)->assertJsonPath('error.code', 'INSUFFICIENT_STOCK');
        $this->assertSame(0, $this->getJson('/api/v1/inventory/transfers')->json('meta.pagination.total'));
    }

    public function test_only_the_receiving_branch_can_receive(): void
    {
        ['org' => $org, 'main' => $main, 'north' => $north, 'variant' => $variant, 'from' => $from, 'to' => $to] = $this->setUpTwoBranches();
        $id = $this->postJson('/api/v1/inventory/transfers', [
            'from_store_id' => $from, 'to_store_id' => $to,
            'lines' => [['variant_id' => $variant->id, 'quantity' => '2']],
        ])->json('data.id');

        $mainClerk = $this->createUserWithRole($org, SystemRole::InventoryManager, [$main->id]);
        $northClerk = $this->createUserWithRole($org, SystemRole::InventoryManager, [$north->id]);
        $outsider = $this->createUserWithRole($org, SystemRole::InventoryManager, [$this->createBranch($org, 'SOUTH')->id]);

        $this->actingAsUser($outsider)->getJson("/api/v1/inventory/transfers/{$id}")->assertNotFound();
        $this->actingAsUser($mainClerk)->getJson("/api/v1/inventory/transfers/{$id}")->assertOk()
            ->assertJsonPath('data.can_receive', false)->assertJsonPath('data.can_cancel', true);
        $this->actingAsUser($mainClerk)->postJson("/api/v1/inventory/transfers/{$id}/receive")->assertNotFound();

        $this->actingAsUser($northClerk)->getJson('/api/v1/inventory/transfers?direction=incoming')->assertJsonCount(1, 'data');
        $this->actingAsUser($northClerk)->postJson("/api/v1/inventory/transfers/{$id}/receive")->assertOk();
    }
}
