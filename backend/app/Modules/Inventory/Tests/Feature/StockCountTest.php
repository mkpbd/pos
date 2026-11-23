<?php

namespace App\Modules\Inventory\Tests\Feature;

use App\Modules\Inventory\Infrastructure\Models\StockAdjustment;
use App\Modules\Inventory\Infrastructure\Models\StockLevel;
use App\Modules\Inventory\Infrastructure\Models\StockMovement;
use App\Modules\Inventory\Tests\Concerns\InteractsWithStock;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * Q1: stock count mode — the counted quantity sets the stock; the server works out the
 * difference under the row lock and keeps both numbers on the line.
 */
class StockCountTest extends TestCase
{
    use InteractsWithStock, InteractsWithTenancy, RefreshDatabase;

    public function test_a_count_sets_the_stock_and_keeps_counted_and_system_quantities(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $variant = $this->stockedVariant($org);
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $this->adjust($store, 'opening', ['variant_id' => $variant->id, 'quantity' => '45', 'unit_cost' => '10']);

        // The manual's example: 45 in stock, 50 counted → 50 (not 95).
        $up = $this->adjust($store, 'count', ['variant_id' => $variant->id, 'counted_quantity' => '50'])
            ->assertJsonPath('data.reason', 'count')
            ->assertJsonPath('data.lines.0.quantity', '5.000')
            ->assertJsonPath('data.lines.0.counted_quantity', '50.000')
            ->assertJsonPath('data.lines.0.system_quantity', '45.000')
            ->assertJsonPath('data.lines.0.unit_cost', '10.0000');
        $this->assertSame('50.000', $this->stockRow($variant->id, $store)['quantity']);

        $this->adjust($store, 'count', ['variant_id' => $variant->id, 'counted_quantity' => '42'])
            ->assertJsonPath('data.lines.0.quantity', '-8.000')
            ->assertJsonPath('data.lines.0.system_quantity', '50.000');
        $this->assertSame('42.000', $this->stockRow($variant->id, $store)['quantity']);

        $movements = $this->getJson("/api/v1/inventory/movements?variant_id={$variant->id}&sort=created_at")->assertOk()->json('data');
        $this->assertSame(['opening', 'adjustment_in', 'adjustment_out'], array_column($movements, 'type'));
        $this->assertSame(['45.000', '50.000', '42.000'], array_column($movements, 'balance_after'));

        // The detail keeps both numbers; signed lines show null.
        $this->getJson('/api/v1/inventory/adjustments/'.$up->json('data.id'))->assertOk()
            ->assertJsonPath('data.lines.0.counted_quantity', '50.000')
            ->assertJsonPath('data.lines.0.system_quantity', '45.000');
        $this->adjust($store, 'count', ['variant_id' => $variant->id, 'quantity' => '-2'])
            ->assertJsonPath('data.lines.0.quantity', '-2.000')
            ->assertJsonPath('data.lines.0.counted_quantity', null)
            ->assertJsonPath('data.lines.0.system_quantity', null);
        $this->assertDatabaseHas('audit_logs', ['action' => 'stock_adjustment.posted', 'subject_id' => $up->json('data.id')]);
    }

    public function test_matching_lines_are_skipped_and_an_all_matching_count_is_refused(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $a = $this->stockedVariant($org, 'A');
        $b = $this->stockedVariant($org, 'B');
        $never = $this->stockedVariant($org, 'Never stocked');
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $this->adjust($store, 'opening', ['variant_id' => $a->id, 'quantity' => '5', 'unit_cost' => '1']);
        $this->adjust($store, 'opening', ['variant_id' => $b->id, 'quantity' => '3', 'unit_cost' => '1']);
        $movements = StockMovement::query()->withoutGlobalScopes()->count();

        $this->postCount($store, [
            ['variant_id' => $a->id, 'counted_quantity' => '5'],
            ['variant_id' => $b->id, 'counted_quantity' => '3.000'],
            ['variant_id' => $never->id, 'counted_quantity' => '0'],
        ])->assertStatus(422)->assertJsonPath('error.code', 'NOTHING_TO_ADJUST');
        $this->assertSame(2, StockAdjustment::query()->withoutGlobalScopes()->count());
        $this->assertSame($movements, StockMovement::query()->withoutGlobalScopes()->count());
        // A zero count of a product never stocked leaves no empty stock row behind.
        $this->assertFalse(StockLevel::query()->withoutGlobalScopes()->where('variant_id', $never->id)->exists());

        $this->postCount($store, [
            ['variant_id' => $a->id, 'counted_quantity' => '5'],
            ['variant_id' => $b->id, 'counted_quantity' => '1'],
        ])->assertCreated()
            ->assertJsonCount(1, 'data.lines')
            ->assertJsonPath('data.lines.0.variant.id', $b->id)
            ->assertJsonPath('data.lines.0.quantity', '-2.000');
        $this->assertSame($movements + 1, StockMovement::query()->withoutGlobalScopes()->count());
        $this->assertSame('5.000', $this->stockRow($a->id, $store)['quantity']);
    }

    public function test_batch_tracked_products_are_counted_per_batch(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $variant = $this->stockedVariant($org, 'Paracetamol', ['track_batches' => true]);
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $expires = now()->addYear()->toDateString();
        $this->adjust($store, 'opening', ['variant_id' => $variant->id, 'quantity' => '10', 'unit_cost' => '2', 'batch_number' => 'B-1', 'expires_on' => $expires]);
        $this->adjust($store, 'opening', ['variant_id' => $variant->id, 'quantity' => '4', 'unit_cost' => '2', 'batch_number' => 'B-2', 'expires_on' => $expires]);
        $batches = collect($this->getJson('/api/v1/inventory/batches')->json('data'))->pluck('batch.id', 'batch.batch_number');

        $this->adjust($store, 'count', ['variant_id' => $variant->id, 'counted_quantity' => '12'], 422)
            ->assertJsonStructure(['error' => ['details' => ['lines.0.batch_id']]]);

        // One product on several lines — one per batch; a batch found on the shelf by number.
        $this->postCount($store, [
            ['variant_id' => $variant->id, 'batch_id' => $batches['B-1'], 'counted_quantity' => '7'],
            ['variant_id' => $variant->id, 'batch_id' => $batches['B-2'], 'counted_quantity' => '4'],
            ['variant_id' => $variant->id, 'batch_number' => 'B-3', 'expires_on' => $expires, 'counted_quantity' => '2', 'unit_cost' => '3'],
        ])->assertCreated()->assertJsonCount(2, 'data.lines')
            ->assertJsonPath('data.lines.0.batch.batch_number', 'B-1')
            ->assertJsonPath('data.lines.0.quantity', '-3.000')
            ->assertJsonPath('data.lines.0.system_quantity', '10.000')
            ->assertJsonPath('data.lines.1.batch.batch_number', 'B-3')
            ->assertJsonPath('data.lines.1.quantity', '2.000')
            ->assertJsonPath('data.lines.1.system_quantity', '0.000');
        $this->assertSame('13.000', $this->stockRow($variant->id, $store)['quantity']);

        // The same batch twice (by id and by number) is refused.
        $this->postCount($store, [
            ['variant_id' => $variant->id, 'batch_id' => $batches['B-1'], 'counted_quantity' => '1'],
            ['variant_id' => $variant->id, 'batch_number' => 'b-1', 'counted_quantity' => '2'],
        ])->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['lines.1.variant_id']]]);
        $this->assertSame('13.000', $this->stockRow($variant->id, $store)['quantity']);
    }

    public function test_counted_quantity_validation(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $pcs = $this->stockedVariant($org, 'Juice');
        $kg = $this->stockedVariant($org, 'Rice', decimalUnit: true);
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);

        $this->adjust($store, 'correction', ['variant_id' => $pcs->id, 'counted_quantity' => '5'], 422)
            ->assertJsonStructure(['error' => ['details' => ['lines.0.counted_quantity']]]);
        $this->adjust($store, 'count', ['variant_id' => $pcs->id, 'counted_quantity' => '-1'], 422)
            ->assertJsonStructure(['error' => ['details' => ['lines.0.counted_quantity']]]);
        $this->adjust($store, 'count', ['variant_id' => $pcs->id, 'counted_quantity' => '5', 'quantity' => '5'], 422)
            ->assertJsonStructure(['error' => ['details' => ['lines.0.quantity']]]);
        $this->adjust($store, 'count', ['variant_id' => $pcs->id], 422)
            ->assertJsonStructure(['error' => ['details' => ['lines.0.quantity']]]);
        $this->adjust($store, 'count', ['variant_id' => $pcs->id, 'counted_quantity' => '1.5'], 422)
            ->assertJsonStructure(['error' => ['details' => ['lines.0.quantity']]]);
        // Without batches a product may still appear only once.
        $this->postCount($store, [
            ['variant_id' => $pcs->id, 'counted_quantity' => '1'],
            ['variant_id' => $pcs->id, 'counted_quantity' => '2'],
        ])->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['lines.1.variant_id']]]);

        $this->adjust($store, 'count', ['variant_id' => $kg->id, 'counted_quantity' => '2.375', 'unit_cost' => '60'])
            ->assertJsonPath('data.lines.0.quantity', '2.375');
        $this->assertSame(1, StockAdjustment::query()->withoutGlobalScopes()->count());
    }

    public function test_counts_are_isolated_per_organization_and_branch(): void
    {
        ['admin' => $adminA, 'organization' => $orgA] = $this->provisionTenant('Alpha');
        ['admin' => $adminB, 'organization' => $orgB] = $this->provisionTenant('Beta');
        $variantA = $this->stockedVariant($orgA);
        $variantB = $this->stockedVariant($orgB);
        $storeA = $this->mainStoreId($orgA);
        $storeB = $this->mainStoreId($orgB);
        $this->actingAsUser($adminB)->adjust($storeB, 'opening', ['variant_id' => $variantB->id, 'quantity' => '7', 'unit_cost' => '1']);

        $this->actingAsUser($adminA);
        $this->adjust($storeB, 'count', ['variant_id' => $variantB->id, 'counted_quantity' => '1'], 422)
            ->assertJsonStructure(['error' => ['details' => ['store_id']]]);
        $this->adjust($storeA, 'count', ['variant_id' => $variantB->id, 'counted_quantity' => '1'], 422)
            ->assertJsonStructure(['error' => ['details' => ['lines.0.variant_id']]]);
        $this->assertSame('7.000', app(TenantContext::class)->runAs($orgB->id, fn () => StockLevel::query()->where('variant_id', $variantB->id)->value('quantity')));

        $north = $this->createBranch($orgA, 'NORTH');
        $clerk = $this->createUserWithRole($orgA, SystemRole::InventoryManager, [$north->id]);
        $this->actingAsUser($clerk)->adjust($storeA, 'count', ['variant_id' => $variantA->id, 'counted_quantity' => '3'], 422);
        $this->assertSame(0, app(TenantContext::class)->runAs($orgA->id, fn () => StockAdjustment::query()->count()));
    }

    /**
     * @param  list<array<string, mixed>>  $lines
     */
    private function postCount(string $storeId, array $lines): TestResponse
    {
        return $this->postJson('/api/v1/inventory/adjustments', ['store_id' => $storeId, 'reason' => 'count', 'lines' => $lines]);
    }
}
