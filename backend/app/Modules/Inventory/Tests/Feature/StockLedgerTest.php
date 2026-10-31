<?php

namespace App\Modules\Inventory\Tests\Feature;

use App\Modules\Branches\Infrastructure\Models\Branch;
use App\Modules\Inventory\Application\Contracts\StockLedger;
use App\Modules\Inventory\Application\Events\StockFellBelowReorderLevel;
use App\Modules\Inventory\Domain\MovementType;
use App\Modules\Inventory\Domain\StockChange;
use App\Modules\Inventory\Domain\StockReference;
use App\Modules\Inventory\Infrastructure\Models\StockMovement;
use App\Modules\Inventory\Tests\Concerns\InteractsWithStock;
use App\Modules\Organizations\Infrastructure\Models\Organization;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use LogicException;
use Tests\TestCase;

class StockLedgerTest extends TestCase
{
    use InteractsWithStock, InteractsWithTenancy, RefreshDatabase;

    public function test_opening_stock_and_weighted_average_cost(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $variant = $this->stockedVariant($org);
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);

        $this->adjust($store, 'opening', ['variant_id' => $variant->id, 'quantity' => '10', 'unit_cost' => '10.00'])
            ->assertJsonPath('data.number', 'ADJ-000001')
            ->assertJsonPath('data.lines.0.unit_cost', '10.0000');
        $this->adjust($store, 'correction', ['variant_id' => $variant->id, 'quantity' => '10', 'unit_cost' => '12.00']);
        // 10 @ 10 + 10 @ 12 → average 11; issuing 5 leaves at 11.
        $this->adjust($store, 'damage', ['variant_id' => $variant->id, 'quantity' => '-5'])
            ->assertJsonPath('data.lines.0.unit_cost', '11.0000');

        $row = $this->stockRow($variant->id, $store);
        $this->assertSame('15.000', $row['quantity']);
        $this->assertSame('165.00', $row['value']);

        $movements = $this->getJson("/api/v1/inventory/movements?variant_id={$variant->id}&sort=created_at")->assertOk()->json('data');
        $this->assertSame(['opening', 'adjustment_in', 'adjustment_out'], array_column($movements, 'type'));
        $this->assertSame(['10.000', '20.000', '15.000'], array_column($movements, 'balance_after'));
        $this->assertSame('ADJ-000003', $movements[2]['reference']['number']);
    }

    public function test_insufficient_stock_rolls_back_the_whole_document(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $a = $this->stockedVariant($org, 'A');
        $b = $this->stockedVariant($org, 'B');
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $this->adjust($store, 'opening', ['variant_id' => $a->id, 'quantity' => '5', 'unit_cost' => '1']);
        $this->adjust($store, 'opening', ['variant_id' => $b->id, 'quantity' => '1', 'unit_cost' => '1']);

        $this->postJson('/api/v1/inventory/adjustments', [
            'store_id' => $store,
            'reason' => 'damage',
            'lines' => [
                ['variant_id' => $a->id, 'quantity' => '-2'],
                ['variant_id' => $b->id, 'quantity' => '-3'],
            ],
        ])->assertStatus(422)
            ->assertJsonPath('error.code', 'INSUFFICIENT_STOCK')
            ->assertJsonPath('error.details.available', '1.000')
            ->assertJsonPath('error.details.requested', '3.000');

        // Line A was processed first but rolled back with the rest; the number was not consumed.
        $this->assertSame('5.000', $this->stockRow($a->id, $store)['quantity']);
        $this->assertSame(2, StockMovement::query()->withoutGlobalScopes()->count());
        $this->adjust($store, 'damage', ['variant_id' => $a->id, 'quantity' => '-1'])->assertJsonPath('data.number', 'ADJ-000003');
    }

    public function test_negative_stock_only_where_the_branch_allows_it(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $variant = $this->stockedVariant($org);
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);

        $this->adjust($store, 'correction', ['variant_id' => $variant->id, 'quantity' => '-1'], 422);

        $branch->forceFill(['allow_negative_stock' => true])->save();
        $this->adjust($store, 'correction', ['variant_id' => $variant->id, 'quantity' => '-2']);
        $this->assertSame('-2.000', $this->stockRow($variant->id, $store)['quantity']);

        // Receiving into negative stock takes the new cost as the average.
        $this->adjust($store, 'correction', ['variant_id' => $variant->id, 'quantity' => '5', 'unit_cost' => '8']);
        $this->assertSame('3.000', $this->stockRow($variant->id, $store)['quantity']);
        $this->assertSame('24.00', $this->stockRow($variant->id, $store)['value']);
    }

    public function test_line_rules_units_reasons_and_services(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $pcs = $this->stockedVariant($org, 'Juice');
        $kg = $this->stockedVariant($org, 'Rice', decimalUnit: true);
        $service = $this->stockedVariant($org, 'Delivery', ['type' => 'service']);
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);

        $this->adjust($store, 'opening', ['variant_id' => $pcs->id, 'quantity' => '1.5', 'unit_cost' => '1'], 422)
            ->assertJsonStructure(['error' => ['details' => ['lines.0.quantity']]]);
        $this->adjust($store, 'opening', ['variant_id' => $kg->id, 'quantity' => '1.250', 'unit_cost' => '60']);
        $this->adjust($store, 'damage', ['variant_id' => $kg->id, 'quantity' => '1'], 422);
        $this->adjust($store, 'opening', ['variant_id' => $kg->id, 'quantity' => '-1'], 422);
        $this->adjust($store, 'opening', ['variant_id' => $service->id, 'quantity' => '1', 'unit_cost' => '1'], 422)
            ->assertJsonStructure(['error' => ['details' => ['lines.0.variant_id']]]);
        $this->adjust($store, 'opening', ['variant_id' => $pcs->id, 'quantity' => '0', 'unit_cost' => '1'], 422);
    }

    public function test_batch_tracked_products_need_batches_and_expose_expiry(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $variant = $this->stockedVariant($org, 'Paracetamol', ['track_batches' => true]);
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);

        $this->adjust($store, 'opening', ['variant_id' => $variant->id, 'quantity' => '10', 'unit_cost' => '2'], 422)
            ->assertJsonStructure(['error' => ['details' => ['lines.0.batch_number']]]);

        $soon = now()->addDays(10)->toDateString();
        $later = now()->addYear()->toDateString();
        $this->adjust($store, 'opening', ['variant_id' => $variant->id, 'quantity' => '10', 'unit_cost' => '2', 'batch_number' => 'B-1', 'expires_on' => $soon]);
        $this->adjust($store, 'opening', ['variant_id' => $variant->id, 'quantity' => '4', 'unit_cost' => '2', 'batch_number' => 'B-2', 'expires_on' => $later]);
        $this->adjust($store, 'opening', ['variant_id' => $variant->id, 'quantity' => '1', 'unit_cost' => '2', 'batch_number' => 'b-1', 'expires_on' => $later], 422)
            ->assertJsonPath('error.code', 'BATCH_EXPIRY_MISMATCH');

        $batches = $this->getJson('/api/v1/inventory/batches')->assertOk()->json('data');
        $this->assertSame(['B-1', 'B-2'], array_column(array_column($batches, 'batch'), 'batch_number'));
        $this->assertCount(1, $this->getJson('/api/v1/inventory/batches?expiring_within_days=30')->json('data'));
        $this->assertSame('14.000', $this->stockRow($variant->id, $store)['quantity']);

        $this->adjust($store, 'expiry', ['variant_id' => $variant->id, 'quantity' => '-1'], 422)
            ->assertJsonStructure(['error' => ['details' => ['lines.0.batch_id']]]);
        $this->adjust($store, 'expiry', ['variant_id' => $variant->id, 'quantity' => '-10', 'batch_id' => $batches[0]['batch']['id']]);
        $this->assertCount(1, $this->getJson('/api/v1/inventory/batches')->json('data'));
    }

    public function test_low_stock_event_fires_once_when_crossing_the_reorder_level(): void
    {
        Event::fake([StockFellBelowReorderLevel::class]);
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $variant = $this->stockedVariant($org, reorderLevel: '5');
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $this->adjust($store, 'opening', ['variant_id' => $variant->id, 'quantity' => '8', 'unit_cost' => '1']);

        $this->adjust($store, 'damage', ['variant_id' => $variant->id, 'quantity' => '-2']); // 6: above
        $this->adjust($store, 'damage', ['variant_id' => $variant->id, 'quantity' => '-2']); // 4: crosses
        $this->adjust($store, 'damage', ['variant_id' => $variant->id, 'quantity' => '-1']); // 3: already below

        Event::assertDispatchedTimes(StockFellBelowReorderLevel::class, 1);
        Event::assertDispatched(StockFellBelowReorderLevel::class, fn ($e) => $e->quantity === '4.000' && $e->reorderLevel === '5.000');
        $this->getJson('/api/v1/inventory/stock?low_stock=1')->assertJsonCount(1, 'data')->assertJsonPath('data.0.is_low', true);
    }

    public function test_ledger_rows_are_immutable(): void
    {
        // (The "inside a transaction" guard cannot be exercised here: RefreshDatabase wraps every test in one.)
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $variant = $this->stockedVariant($org);
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $this->adjust($store, 'opening', ['variant_id' => $variant->id, 'quantity' => '1', 'unit_cost' => '1']);

        app(TenantContext::class)->runAs($org->id, function () {
            $this->expectException(LogicException::class);
            StockMovement::query()->firstOrFail()->update(['quantity' => '999']);
        });
    }

    public function test_ledger_skips_untracked_products_and_rejects_inactive_stores(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $service = $this->stockedVariant($org, 'Delivery', ['type' => 'service']);
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);

        app(TenantContext::class)->runAs($org->id, function () use ($service, $store) {
            $result = app(StockLedger::class)->post([new StockChange($store, $service->id, null, MovementType::AdjustmentIn, '1', '1')], new StockReference('test', $service->id));
            $this->assertSame([null], $result);
            $this->assertSame(0, StockMovement::query()->count());
        });

        $this->patchJson("/api/v1/branches/{$this->mainBranchId($org)}/stores/{$store}", ['is_active' => false])->assertOk();
        $this->adjust($store, 'opening', ['variant_id' => $this->stockedVariant($org)->id, 'quantity' => '1', 'unit_cost' => '1'], 422)
            ->assertJsonStructure(['error' => ['details' => ['store_id']]]);
    }

    public function test_cost_values_hidden_and_writes_forbidden_for_cashiers(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $variant = $this->stockedVariant($org);
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin)->adjust($store, 'opening', ['variant_id' => $variant->id, 'quantity' => '3', 'unit_cost' => '4']);

        $manager = $this->createUserWithRole($org, SystemRole::InventoryManager, [$branch->id]);
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]);

        $this->actingAsUser($cashier)->getJson('/api/v1/inventory/stock')->assertForbidden();
        $this->actingAsUser($manager)->getJson('/api/v1/inventory/stock')->assertOk()->assertJsonPath('data.0.value', '12.00');
        $this->actingAsUser($manager)->getJson('/api/v1/inventory/valuation')->assertOk()->assertJsonPath('total', null);
    }

    public function test_stock_is_isolated_per_organization_and_branch(): void
    {
        ['admin' => $adminA, 'organization' => $orgA] = $this->provisionTenant('Alpha');
        ['admin' => $adminB, 'organization' => $orgB] = $this->provisionTenant('Beta');
        $variantA = $this->stockedVariant($orgA);
        $variantB = $this->stockedVariant($orgB);
        $storeA = $this->mainStoreId($orgA);
        $storeB = $this->mainStoreId($orgB);
        $this->actingAsUser($adminB)->adjust($storeB, 'opening', ['variant_id' => $variantB->id, 'quantity' => '7', 'unit_cost' => '1']);

        $this->actingAsUser($adminA);
        $this->getJson('/api/v1/inventory/stock')->assertOk()->assertJsonCount(0, 'data');
        $this->adjust($storeB, 'opening', ['variant_id' => $variantA->id, 'quantity' => '1', 'unit_cost' => '1'], 422)
            ->assertJsonStructure(['error' => ['details' => ['store_id']]]);
        $this->adjust($storeA, 'opening', ['variant_id' => $variantB->id, 'quantity' => '1', 'unit_cost' => '1'], 422)
            ->assertJsonStructure(['error' => ['details' => ['lines.0.variant_id']]]);

        $north = $this->createBranch($orgA, 'NORTH');
        $clerk = $this->createUserWithRole($orgA, SystemRole::InventoryManager, [$north->id]);
        $this->actingAsUser($clerk)->adjust($storeA, 'opening', ['variant_id' => $variantA->id, 'quantity' => '1', 'unit_cost' => '1'], 422);
        $this->actingAsUser($clerk)->getJson('/api/v1/inventory/stock?branch_id='.$this->mainBranchId($orgA))->assertNotFound();
    }

    private function mainBranchId(Organization $organization): string
    {
        return app(TenantContext::class)->runAs($organization->id, fn () => Branch::query()->where('code', 'MAIN')->firstOrFail()->id);
    }
}
