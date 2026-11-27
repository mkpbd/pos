<?php

namespace App\Modules\Inventory\Tests\Feature;

use App\Modules\Inventory\Infrastructure\Models\StockAdjustment;
use App\Modules\Inventory\Infrastructure\Models\StockAdjustmentLine;
use App\Modules\Inventory\Infrastructure\Models\Stocktake;
use App\Modules\Inventory\Tests\Concerns\InteractsWithStock;
use App\Modules\Organizations\Infrastructure\Models\Organization;
use App\Modules\Products\Infrastructure\Models\ProductVariant;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use App\Modules\Users\Infrastructure\Models\Role;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * ST1: stocktake sessions — scope, counting with snapshots, scanning, posting as one count
 * adjustment, blind mode, one open stocktake per store, permissions and isolation.
 */
class StocktakeTest extends TestCase
{
    use InteractsWithStock, InteractsWithTenancy, RefreshDatabase;

    public function test_scope_generation_covers_sub_categories_batches_and_skips_the_rest(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $this->actingAsUser($admin);
        $drinks = $this->postJson('/api/v1/categories', ['name' => 'Drinks'])->assertCreated()->json('data.id');
        $juice = $this->postJson('/api/v1/categories', ['name' => 'Juice', 'parent_id' => $drinks])->assertCreated()->json('data.id');
        $snacks = $this->postJson('/api/v1/categories', ['name' => 'Snacks'])->assertCreated()->json('data.id');
        $store = $this->mainStoreId($org);

        $cola = $this->stockedVariant($org, 'Cola', ['category_id' => $drinks]);
        $mango = $this->stockedVariant($org, 'Mango Juice', ['category_id' => $juice]);
        $chips = $this->stockedVariant($org, 'Chips', ['category_id' => $snacks]);
        $syrup = $this->stockedVariant($org, 'Syrup', ['category_id' => $juice, 'track_batches' => true]);
        $neverStocked = $this->stockedVariant($org, 'Lemonade', ['category_id' => $drinks]);
        $inactive = $this->stockedVariant($org, 'Old Tonic', ['category_id' => $drinks]);
        foreach ([$cola, $mango, $chips, $inactive] as $v) {
            $this->adjust($store, 'opening', ['variant_id' => $v->id, 'quantity' => '5', 'unit_cost' => '10']);
        }
        $expires = now()->addYear()->toDateString();
        $this->adjust($store, 'opening', ['variant_id' => $syrup->id, 'quantity' => '4', 'unit_cost' => '2', 'batch_number' => 'S-1', 'expires_on' => $expires]);
        $this->adjust($store, 'opening', ['variant_id' => $syrup->id, 'quantity' => '6', 'unit_cost' => '2', 'batch_number' => 'S-2', 'expires_on' => $expires]);
        // An emptied batch gets no line.
        $this->adjust($store, 'opening', ['variant_id' => $syrup->id, 'quantity' => '1', 'unit_cost' => '2', 'batch_number' => 'S-0', 'expires_on' => $expires]);
        $s0 = collect($this->getJson('/api/v1/inventory/batches')->json('data'))->firstWhere('batch.batch_number', 'S-0')['batch']['id'];
        $this->adjust($store, 'damage', ['variant_id' => $syrup->id, 'quantity' => '-1', 'batch_id' => $s0]);
        $this->deactivate($org, $inactive);

        $id = $this->create($store, ['scope' => 'categories', 'scope_ids' => [$drinks]])
            ->assertJsonPath('data.status', 'draft')
            ->assertJsonPath('data.number', 'ST-000001')
            ->assertJsonPath('data.scope_items.0.name', 'Drinks')
            ->json('data.id');
        $this->postJson("/api/v1/inventory/stocktakes/{$id}/start")->assertOk()
            ->assertJsonPath('data.status', 'counting')
            ->assertJsonPath('data.summary.lines', 4)
            ->assertJsonPath('data.summary.uncounted', 4);
        $this->postJson("/api/v1/inventory/stocktakes/{$id}/start")->assertStatus(409)->assertJsonPath('error.code', 'INVALID_STATUS_CHANGE');

        $lines = $this->getJson("/api/v1/inventory/stocktakes/{$id}/lines")->assertOk()->json('data');
        // Product-name order; Syrup per batch with stock; Chips (other category), Lemonade (no stock row) and the inactive product left out.
        $this->assertSame(['Cola', 'Mango Juice', 'Syrup', 'Syrup'], array_column(array_column($lines, 'variant'), 'product_name'));
        $this->assertSame(['S-1', 'S-2'], [$lines[2]['batch']['number'], $lines[3]['batch']['number']]);
        $this->assertNull($lines[0]['system_quantity']);
        $this->assertNull($lines[0]['counted_quantity']);

        // Product scope.
        $this->postJson("/api/v1/inventory/stocktakes/{$id}/cancel")->assertOk()->assertJsonPath('data.status', 'cancelled');
        $other = $this->create($store, ['scope' => 'products', 'scope_ids' => [$chips->product_id]])->json('data.id');
        $this->postJson("/api/v1/inventory/stocktakes/{$other}/start")->assertOk()->assertJsonPath('data.summary.lines', 1);
        $this->create($store, ['scope' => 'products', 'scope_ids' => []], 422);
        $this->assertNotNull($neverStocked);
    }

    public function test_counts_snapshot_the_system_quantity_so_later_sales_are_not_undone(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $this->actingAsUser($admin);
        $store = $this->mainStoreId($org);
        $a = $this->stockedVariant($org, 'Apple');
        $b = $this->stockedVariant($org, 'Banana');
        $c = $this->stockedVariant($org, 'Cherry');
        $found = $this->stockedVariant($org, 'Durian');
        $this->adjust($store, 'opening', ['variant_id' => $a->id, 'quantity' => '10', 'unit_cost' => '4']);
        $this->adjust($store, 'opening', ['variant_id' => $b->id, 'quantity' => '8', 'unit_cost' => '5']);
        $this->adjust($store, 'opening', ['variant_id' => $c->id, 'quantity' => '3', 'unit_cost' => '6']);
        $id = $this->startAll($store);

        // Apple: 9 on the shelf (one missing) while the system says 10.
        $this->countLines($id, [['variant_id' => $a->id, 'counted_quantity' => '9', 'note' => 'Back shelf']])->assertOk()
            ->assertJsonPath('data.lines.0.system_quantity', '10.000')
            ->assertJsonPath('data.lines.0.counted_quantity', '9.000')
            ->assertJsonPath('data.lines.0.difference', '-1.000')
            ->assertJsonPath('data.lines.0.value_difference', '-4.00')
            ->assertJsonPath('data.lines.0.note', 'Back shelf')
            ->assertJsonPath('data.lines.0.counted_by.id', $admin->id);
        // Banana counted right.
        $this->countLines($id, [['variant_id' => $b->id, 'counted_quantity' => '8']])->assertOk();
        // Durian is not in the store's stock: found on the shelf → an extra line.
        $this->countLines($id, [['variant_id' => $found->id, 'counted_quantity' => '2']])->assertOk()
            ->assertJsonPath('data.lines.0.is_extra', true)
            ->assertJsonPath('data.lines.0.system_quantity', '0.000');

        // After counting, two apples and three bananas are sold (stock goes down).
        $this->adjust($store, 'damage', ['variant_id' => $a->id, 'quantity' => '-2']);
        $this->adjust($store, 'damage', ['variant_id' => $b->id, 'quantity' => '-3']);

        $this->getJson("/api/v1/inventory/stocktakes/{$id}")->assertOk()
            ->assertJsonPath('data.summary.lines', 4)
            ->assertJsonPath('data.summary.counted', 3)
            ->assertJsonPath('data.summary.uncounted', 1)
            ->assertJsonPath('data.summary.with_variance', 2)
            ->assertJsonPath('data.summary.variance_quantity_in', '2.000')
            ->assertJsonPath('data.summary.variance_quantity_out', '1.000')
            ->assertJsonPath('data.summary.variance_value', '16.00'); // −1 × 4 + 2 × 10 (Durian at its purchase price)
        $this->getJson("/api/v1/inventory/stocktakes/{$id}/lines?filter=variance")->assertJsonCount(2, 'data');
        $this->getJson("/api/v1/inventory/stocktakes/{$id}/lines?filter=uncounted")->assertJsonCount(1, 'data')->assertJsonPath('data.0.variant.product_name', 'Cherry');
        $this->getJson("/api/v1/inventory/stocktakes/{$id}/lines?search=Banana")->assertJsonCount(1, 'data');

        $this->postStocktake($id, 'ignore')->assertOk()
            ->assertJsonPath('data.status', 'posted')
            ->assertJsonPath('data.uncounted_policy', 'ignore')
            ->assertJsonPath('data.posted_by.id', $admin->id);
        // Apple 10 − 2 sold − 1 missing = 7 (not the 9 counted, which would undo the sale); Banana stays 5; Cherry untouched.
        $this->assertSame('7.000', $this->stockRow($a->id, $store)['quantity']);
        $this->assertSame('5.000', $this->stockRow($b->id, $store)['quantity']);
        $this->assertSame('3.000', $this->stockRow($c->id, $store)['quantity']);
        $this->assertSame('2.000', $this->stockRow($found->id, $store)['quantity']);

        $stocktake = $this->getJson("/api/v1/inventory/stocktakes/{$id}")->json('data');
        $adjustment = $this->getJson('/api/v1/inventory/adjustments/'.$stocktake['adjustment']['id'])->assertOk()
            ->assertJsonPath('data.reason', 'count')
            ->assertJsonPath('data.note', 'Stocktake ST-000001')
            ->assertJsonCount(2, 'data.lines')
            ->json('data.lines');
        $byProduct = collect($adjustment)->keyBy('variant.product_name');
        $this->assertSame(['-1.000', '9.000', '10.000'], [$byProduct['Apple']['quantity'], $byProduct['Apple']['counted_quantity'], $byProduct['Apple']['system_quantity']]);
        $this->assertSame(['2.000', '2.000', '0.000'], [$byProduct['Durian']['quantity'], $byProduct['Durian']['counted_quantity'], $byProduct['Durian']['system_quantity']]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'stocktake.posted', 'subject_id' => $id]);

        // Read-only afterwards.
        $this->countLines($id, [['variant_id' => $c->id, 'counted_quantity' => '1']])->assertStatus(409)->assertJsonPath('error.code', 'STOCKTAKE_NOT_COUNTING');
        $this->postStocktake($id, 'ignore')->assertStatus(409)->assertJsonPath('error.code', 'INVALID_STATUS_CHANGE');
        $this->postJson("/api/v1/inventory/stocktakes/{$id}/cancel")->assertStatus(409);
    }

    public function test_zero_policy_and_nothing_to_change(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $this->actingAsUser($admin);
        $store = $this->mainStoreId($org);
        $a = $this->stockedVariant($org, 'Apple');
        $b = $this->stockedVariant($org, 'Banana');
        $this->adjust($store, 'opening', ['variant_id' => $a->id, 'quantity' => '10', 'unit_cost' => '4']);
        $this->adjust($store, 'opening', ['variant_id' => $b->id, 'quantity' => '8', 'unit_cost' => '5']);

        // Everything matches → posted without an adjustment.
        $id = $this->startAll($store);
        $this->countLines($id, [['variant_id' => $a->id, 'counted_quantity' => '10'], ['variant_id' => $b->id, 'counted_quantity' => '8']])->assertOk();
        $adjustments = StockAdjustment::query()->withoutGlobalScopes()->count();
        $this->postStocktake($id, 'zero')->assertOk()->assertJsonPath('data.status', 'posted')->assertJsonPath('data.adjustment', null);
        $this->assertSame($adjustments, StockAdjustment::query()->withoutGlobalScopes()->count());

        // Zero policy: the uncounted Banana is counted 0 with a snapshot taken at post time.
        $id = $this->startAll($store);
        $this->countLines($id, [['variant_id' => $a->id, 'counted_quantity' => '10']])->assertOk();
        $this->adjust($store, 'damage', ['variant_id' => $b->id, 'quantity' => '-1']); // 7 now
        $this->postStocktake($id, 'zero')->assertOk()->assertJsonPath('data.summary.uncounted', 0);
        $this->assertSame('10.000', $this->stockRow($a->id, $store)['quantity']);
        $this->assertSame('0.000', $this->stockRow($b->id, $store)['quantity']);
        $line = StockAdjustmentLine::query()->withoutGlobalScopes()->where('variant_id', $b->id)->whereNotNull('counted_quantity')->firstOrFail();
        $this->assertSame(['-7.000', '0.000', '7.000'], [(string) $line->quantity, (string) $line->counted_quantity, (string) $line->system_quantity]);
        $this->getJson("/api/v1/inventory/stocktakes/{$id}/lines?filter=uncounted")->assertJsonCount(0, 'data');
    }

    public function test_scanning_adds_up_and_handles_unknown_codes_and_batches(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $this->actingAsUser($admin);
        $store = $this->mainStoreId($org);
        $soap = $this->stockedVariant($org, 'Soap', ['variants' => [['purchase_price' => '10.00', 'selling_price' => '15.00', 'barcodes' => ['4006381333931', ['barcode' => 'SOAPBOX12', 'units' => 12, 'pack_name' => 'Box']]]]]);
        $pills = $this->stockedVariant($org, 'Pills', ['track_batches' => true, 'variants' => [['purchase_price' => '2.00', 'selling_price' => '3.00', 'barcodes' => ['5901234123457']]]]);
        $rice = $this->stockedVariant($org, 'Rice', decimalUnit: true);
        $this->adjust($store, 'opening', ['variant_id' => $soap->id, 'quantity' => '6', 'unit_cost' => '10']);
        $this->adjust($store, 'opening', ['variant_id' => $pills->id, 'quantity' => '5', 'unit_cost' => '2', 'batch_number' => 'P-1', 'expires_on' => now()->addYear()->toDateString()]);
        $id = $this->startAll($store);

        $this->scan($id, ['barcode' => '4006381333931'])->assertOk()
            ->assertJsonPath('data.line.counted_quantity', '1.000')
            ->assertJsonPath('data.line.system_quantity', '6.000')
            ->assertJsonPath('data.line.variant.barcode', '4006381333931')
            ->assertJsonPath('data.progress.counted', 1);
        // Sold meanwhile: later scans keep the first snapshot.
        $this->adjust($store, 'damage', ['variant_id' => $soap->id, 'quantity' => '-1']);
        $this->scan($id, ['barcode' => '4006381333931', 'quantity' => '3'])->assertOk()
            ->assertJsonPath('data.line.counted_quantity', '4.000')
            ->assertJsonPath('data.line.system_quantity', '6.000');
        // By SKU (case-insensitive) as well.
        $this->scan($id, ['barcode' => mb_strtolower($soap->sku)])->assertOk()->assertJsonPath('data.line.counted_quantity', '5.000');
        // ST2c: a box barcode counts its units.
        $this->scan($id, ['barcode' => 'SOAPBOX12'])->assertOk()->assertJsonPath('data.line.counted_quantity', '17.000');
        $this->scan($id, ['barcode' => '4006381333931', 'quantity' => '1.5'])->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['quantity']]]);
        $this->scan($id, ['barcode' => 'NOPE-123'])->assertStatus(422)->assertJsonPath('error.code', 'UNKNOWN_BARCODE');

        $required = $this->scan($id, ['barcode' => '5901234123457'])->assertStatus(422)
            ->assertJsonPath('error.code', 'BATCH_REQUIRED')
            ->assertJsonPath('error.details.variant.id', $pills->id)
            ->assertJsonPath('error.details.batches.0.number', 'P-1');
        $this->scan($id, ['barcode' => '5901234123457', 'batch_id' => $required->json('error.details.batches.0.id')])->assertOk()
            ->assertJsonPath('data.line.batch.number', 'P-1')
            ->assertJsonPath('data.line.counted_quantity', '1.000');
        $this->countLines($id, [['variant_id' => $pills->id, 'counted_quantity' => '2']])->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['lines.0.batch_id']]]);

        // A product found outside the stock: extra line; clearing it removes the line, clearing a scope line keeps it.
        $extra = $this->scan($id, ['barcode' => $rice->sku, 'quantity' => '1.250'])->assertOk()->assertJsonPath('data.line.is_extra', true)->json('data.line.id');
        $this->deleteJson("/api/v1/inventory/stocktakes/{$id}/lines/{$extra}/count")->assertOk()->assertJsonPath('data.removed', true);
        $soapLine = collect($this->getJson("/api/v1/inventory/stocktakes/{$id}/lines")->json('data'))->firstWhere('variant.id', $soap->id)['id'];
        $this->deleteJson("/api/v1/inventory/stocktakes/{$id}/lines/{$soapLine}/count")->assertOk()
            ->assertJsonPath('data.removed', false)
            ->assertJsonPath('data.line.counted_quantity', null)
            ->assertJsonPath('data.line.system_quantity', null);
        $this->getJson("/api/v1/inventory/stocktakes/{$id}")->assertJsonPath('data.summary.lines', 2)->assertJsonPath('data.summary.counted', 1);

        // The variance list exports through the list export mechanism.
        $this->get("/api/v1/inventory/stocktakes/{$id}/lines?filter=counted&export=csv")->assertOk();
    }

    public function test_blind_stocktakes_hide_system_quantities_from_counters(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $this->actingAsUser($admin);
        $store = $this->mainStoreId($org);
        $a = $this->stockedVariant($org, 'Apple');
        $this->adjust($store, 'opening', ['variant_id' => $a->id, 'quantity' => '10', 'unit_cost' => '4']);
        $id = $this->create($store, ['scope' => 'all', 'blind' => true])->assertJsonPath('data.blind', true)->json('data.id');
        $this->postJson("/api/v1/inventory/stocktakes/{$id}/start")->assertOk();

        $counter = $this->counter($org, $branch->id);
        $this->actingAsUser($counter);
        $this->countLines($id, [['variant_id' => $a->id, 'counted_quantity' => '7']])->assertOk()
            ->assertJsonPath('data.lines.0.counted_quantity', '7.000')
            ->assertJsonPath('data.lines.0.system_quantity', null)
            ->assertJsonPath('data.lines.0.difference', null)
            ->assertJsonPath('data.lines.0.value_difference', null);
        $this->getJson("/api/v1/inventory/stocktakes/{$id}")->assertOk()
            ->assertJsonPath('data.can_see_system_quantity', false)
            ->assertJsonPath('data.summary.counted', 1)
            ->assertJsonPath('data.summary.with_variance', null)
            ->assertJsonPath('data.summary.variance_value', null);
        $this->getJson("/api/v1/inventory/stocktakes/{$id}/lines?filter=variance")->assertForbidden();
        // Counting is not posting.
        $this->postStocktake($id, 'ignore')->assertForbidden();

        $this->actingAsUser($admin);
        $this->getJson("/api/v1/inventory/stocktakes/{$id}/lines")->assertJsonPath('data.0.system_quantity', '10.000')->assertJsonPath('data.0.difference', '-3.000');
        $this->postStocktake($id, 'ignore')->assertOk();
        $this->assertSame('7.000', $this->stockRow($a->id, $store)['quantity']);
    }

    public function test_one_open_stocktake_per_store_permissions_and_isolation(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        ['admin' => $stranger, 'organization' => $otherOrg] = $this->provisionTenant('Other Shop');
        $this->actingAsUser($admin);
        $store = $this->mainStoreId($org);

        $first = $this->create($store, ['scope' => 'all'])->json('data.id');
        $this->create($store, ['scope' => 'all'], 409)->assertJsonPath('error.code', 'STOCKTAKE_OPEN')->assertJsonPath('error.details.stocktake_id', $first);
        $this->postJson("/api/v1/inventory/stocktakes/{$first}/start")->assertOk();
        $this->create($store, ['scope' => 'all'], 409);
        $this->postJson("/api/v1/inventory/stocktakes/{$first}/cancel")->assertOk();
        $second = $this->create($store, ['scope' => 'all'])->json('data.id');
        $this->getJson('/api/v1/inventory/stocktakes?status=draft')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $second);
        $this->getJson("/api/v1/inventory/stocktakes?store_id={$store}")->assertJsonCount(2, 'data');

        // Roles: Cashier has nothing; Inventory Manager and Branch Manager count and post.
        $this->actingAsUser($this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]));
        $this->getJson('/api/v1/inventory/stocktakes')->assertForbidden();
        $this->create($store, ['scope' => 'all'], 403);
        foreach ([SystemRole::InventoryManager, SystemRole::BranchManager] as $role) {
            $user = $this->createUserWithRole($org, $role, [$branch->id]);
            $this->assertTrue($user->can('inventory.stocktake'), $role->value);
            $this->assertTrue($user->can('inventory.adjust'), $role->value);
        }

        // Other branches and organizations see nothing.
        $north = $this->createBranch($org, 'NORTH');
        $this->actingAsUser($this->createUserWithRole($org, SystemRole::InventoryManager, [$north->id]));
        $this->getJson("/api/v1/inventory/stocktakes/{$second}")->assertNotFound();
        $this->postJson("/api/v1/inventory/stocktakes/{$second}/start")->assertNotFound();
        $this->getJson('/api/v1/inventory/stocktakes')->assertJsonCount(0, 'data');
        $this->create($store, ['scope' => 'all'], 422)->assertJsonStructure(['error' => ['details' => ['store_id']]]);

        $this->actingAsUser($stranger);
        $this->getJson("/api/v1/inventory/stocktakes/{$second}")->assertNotFound();
        $this->postJson("/api/v1/inventory/stocktakes/{$second}/cancel")->assertNotFound();
        $this->create($store, ['scope' => 'all'], 422);
        $foreign = $this->stockedVariant($org, 'Ours');
        $this->create($this->mainStoreId($otherOrg), ['scope' => 'products', 'scope_ids' => [$foreign->product_id]], 422)
            ->assertJsonStructure(['error' => ['details' => ['scope_ids']]]);
        $theirs = $this->create($this->mainStoreId($otherOrg), ['scope' => 'all'])->json('data.id');
        $this->postJson("/api/v1/inventory/stocktakes/{$theirs}/start")->assertOk();
        $this->countLines($theirs, [['variant_id' => $foreign->id, 'counted_quantity' => '1']])->assertStatus(422)
            ->assertJsonStructure(['error' => ['details' => ['lines.0.variant_id']]]);
        $this->scan($theirs, ['barcode' => $foreign->sku])->assertStatus(422)->assertJsonPath('error.code', 'UNKNOWN_BARCODE');
        $this->assertSame(1, Stocktake::query()->withoutGlobalScopes()->where('organization_id', $otherOrg->id)->count());
    }

    /**
     * @param  array<string, mixed>  $fields
     */
    private function create(string $storeId, array $fields, int $status = 201): TestResponse
    {
        return $this->postJson('/api/v1/inventory/stocktakes', ['store_id' => $storeId] + $fields)->assertStatus($status);
    }

    private function startAll(string $storeId): string
    {
        $id = $this->create($storeId, ['scope' => 'all'])->json('data.id');
        $this->postJson("/api/v1/inventory/stocktakes/{$id}/start")->assertOk();

        return $id;
    }

    /**
     * @param  list<array<string, mixed>>  $lines
     */
    private function countLines(string $id, array $lines): TestResponse
    {
        return $this->putJson("/api/v1/inventory/stocktakes/{$id}/lines", ['lines' => $lines]);
    }

    /**
     * @param  array<string, mixed>  $body
     */
    private function scan(string $id, array $body): TestResponse
    {
        return $this->postJson("/api/v1/inventory/stocktakes/{$id}/scan", $body);
    }

    private function postStocktake(string $id, string $policy): TestResponse
    {
        return $this->postJson("/api/v1/inventory/stocktakes/{$id}/post", ['uncounted_policy' => $policy]);
    }

    /**
     * A counter: may count (and see stock) but not post adjustments.
     */
    private function counter(Organization $org, string $branchId): User
    {
        $role = $this->inTenant($org, function () {
            $role = Role::query()->create(['name' => 'Stock counter']);
            $role->permissions()->sync(['inventory.view', 'inventory.stocktake']);

            return $role;
        });

        return $this->createUserWithRole($org, $role, [$branchId]);
    }

    private function deactivate(Organization $org, ProductVariant $variant): void
    {
        $this->inTenant($org, fn () => $variant->product()->update(['is_active' => false]));
    }
}
