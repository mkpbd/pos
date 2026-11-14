<?php

namespace App\Modules\Products\Tests\Feature;

use App\Modules\Inventory\Infrastructure\Models\StockAdjustment;
use App\Modules\Inventory\Infrastructure\Models\StockMovement;
use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Products\Infrastructure\Models\ProductVariant;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Infrastructure\Models\Role;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * P1a: the admin variant grid (PUT /products/{id}/variants): generate/match rows, opening
 * stock through Inventory, compare-at prices, removed combinations, limits and isolation.
 */
class VariantGridTest extends TestCase
{
    use BuildsOnlineCatalog, InteractsWithTenancy, RefreshDatabase;

    /** @var array<string, mixed> */
    private array $tenant;

    /** @var array<string, mixed> */
    private array $product;

    private function shirt(): void
    {
        $this->tenant = $this->openStore('Berry Kids', 'berry.test');
        $this->product = $this->makeProduct($this->tenant['unit']->id, 'T-shirt', [['TEE', '500.00']]);
    }

    /**
     * Colour × Size rows for the grid (no ids: matched by option values).
     *
     * @param  list<string>  $colours
     * @param  list<string>  $sizes
     * @return array<string, mixed>
     */
    private function grid(array $colours, array $sizes, array $row = [], array $extra = []): array
    {
        $variants = [];
        foreach ($colours as $colour) {
            foreach ($sizes as $size) {
                $variants[] = $row + [
                    'option_values' => ['Colour' => $colour, 'Size' => $size],
                    'sku' => strtoupper("TEE-{$colour}-{$size}"),
                    'barcodes' => [],
                    'purchase_price' => '200.00',
                    'selling_price' => '500.00',
                    'wholesale_price' => null,
                    'reorder_level' => '2',
                    'is_active' => true,
                ];
            }
        }

        return $extra + [
            'options' => [['name' => 'Colour', 'values' => $colours], ['name' => 'Size', 'values' => $sizes]],
            'variants' => $variants,
        ];
    }

    private function url(): string
    {
        return "/api/v1/products/{$this->product['id']}/variants";
    }

    public function test_grid_creates_matches_and_is_idempotent_with_opening_stock_through_inventory(): void
    {
        $this->shirt();
        $payload = $this->grid(['Red', 'Blue'], ['S', 'M'], ['opening_stock' => '4', 'compare_at_price' => '650.00'], ['stock_store_id' => $this->tenant['store']->id]);

        $first = $this->putJson($this->url(), $payload)->assertOk()->json('data');
        $this->assertCount(4, $first['variants']);
        $this->assertSame(['TEE-RED-S', 'TEE-RED-M', 'TEE-BLUE-S', 'TEE-BLUE-M'], array_column($first['variants'], 'sku'));
        $this->assertSame(['650.00'], array_values(array_unique(array_column($first['variants'], 'compare_at_price'))));
        $this->assertSame([0], array_values(array_unique(array_column($first['variants'], 'back_in_stock_open'))));
        $this->assertSame('4.000', $first['variants'][0]['stock']['total']);
        $this->assertSame([['store_id' => $this->tenant['store']->id, 'branch_id' => $this->tenant['store']->branch_id, 'quantity' => '4.000']], $first['variants'][0]['stock']['by_store']);
        // The simple product's only variant had no history: archived.
        $this->assertSoftDeleted('product_variants', ['id' => $this->product['variants'][0]['id']]);

        // Opening stock went through the Inventory adjustment use case.
        $adjustment = $this->inTenant($this->tenant['organization'], fn () => StockAdjustment::query()->sole());
        $this->assertSame(['opening', 'Variant grid'], [$adjustment->reason, $adjustment->note]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'stock_adjustment.posted', 'subject_id' => $adjustment->id]);

        // The same payload again: every row matches an existing variant, nothing new, no stock.
        $second = $this->putJson($this->url(), $payload)->assertOk()->json('data');
        $this->assertSame(array_column($first['variants'], 'id'), array_column($second['variants'], 'id'));
        $this->assertSame(1, $this->inTenant($this->tenant['organization'], fn () => StockAdjustment::query()->count()));
        $this->assertSame('4.000', $second['variants'][0]['stock']['total']);

        // Rows match case-insensitively; a new size adds one variant with its own opening stock.
        $more = $this->grid(['red', 'blue'], ['s', 'm', 'L'], [], ['stock_store_id' => $this->tenant['store']->id]);
        $more['options'] = [['name' => 'Colour', 'values' => ['Red', 'Blue']], ['name' => 'Size', 'values' => ['S', 'M', 'L']]];
        foreach ($more['variants'] as $i => $row) {
            $more['variants'][$i]['option_values'] = ['Colour' => ucfirst($row['option_values']['Colour']), 'Size' => strtoupper($row['option_values']['Size'])];
            $more['variants'][$i]['opening_stock'] = '7';
        }
        $third = $this->putJson($this->url(), $more)->assertOk()->json('data');
        $this->assertCount(6, $third['variants']);
        $this->assertContains($first['variants'][0]['id'], array_column($third['variants'], 'id'));
        $byKey = collect($third['variants'])->keyBy(fn ($v) => $v['option_values']['Colour'].'/'.$v['option_values']['Size']);
        $this->assertSame('4.000', $byKey['Red/S']['stock']['total'], 'Existing variants ignore opening_stock.');
        $this->assertSame('7.000', $byKey['Red/L']['stock']['total']);
        $this->assertSame('650.00', $byKey['Red/S']['compare_at_price'], 'Rows without compare_at_price keep it.');
    }

    public function test_removed_combinations_with_history_are_deactivated_others_archived(): void
    {
        $this->shirt();
        $created = $this->putJson($this->url(), $this->grid(['Red', 'Blue'], ['S']))->assertOk()->json('data.variants');
        [$red, $blue] = $created;
        $this->stockUp($this->tenant, [$red['id'] => '3']);

        // Only Red/M remains in the grid; Red/S has stock history, Blue/S has none.
        $payload = $this->grid(['Red', 'Blue'], ['S', 'M']);
        $payload['variants'] = [$payload['variants'][1]];
        $variants = $this->putJson($this->url(), $payload)->assertOk()->json('data.variants');

        $this->assertSame(['TEE-RED-M', 'TEE-RED-S'], array_column($variants, 'sku'));
        $this->assertSame([true, false], array_column($variants, 'is_active'));
        $this->assertSoftDeleted('product_variants', ['id' => $blue['id']]);
        $this->assertNotSoftDeleted('product_variants', ['id' => $red['id']]);
    }

    public function test_validation_and_permissions(): void
    {
        $this->shirt();
        $other = $this->makeProduct($this->tenant['unit']->id, 'Cap', [['CAP-1', '100.00']]);

        // SKU of another product, compare-at not above the price, opening stock without a store.
        $payload = $this->grid(['Red'], ['S', 'M']);
        $payload['variants'][0]['sku'] = 'CAP-1';
        $payload['variants'][1]['compare_at_price'] = '500.00';
        $payload['variants'][1]['opening_stock'] = '2';
        $this->putJson($this->url(), $payload)->assertUnprocessable()
            ->assertJsonValidationErrors(['variants.1.compare_at_price', 'stock_store_id'], 'error.details');
        $payload['variants'][1]['compare_at_price'] = null;
        $payload['stock_store_id'] = $this->tenant['store']->id;
        $this->putJson($this->url(), $payload)->assertUnprocessable()->assertJsonValidationErrors(['variants.0.sku'], 'error.details');

        // Duplicate combination, value outside the options, malformed money.
        $bad = $this->grid(['Red'], ['S', 'M']);
        $bad['variants'][1]['option_values'] = ['Colour' => 'Red', 'Size' => 's'];
        $this->putJson($this->url(), $bad)->assertUnprocessable()->assertJsonValidationErrors(['variants.1.option_values'], 'error.details');
        $bad = $this->grid(['Red'], ['S']);
        $bad['variants'][0]['selling_price'] = '10.555';
        $this->putJson($this->url(), $bad)->assertUnprocessable()->assertJsonValidationErrors(['variants.0.selling_price'], 'error.details');

        // At most 200 variants.
        $sizes = array_map(fn (int $i) => "S{$i}", range(1, 41));
        $this->putJson($this->url(), $this->grid(['Red', 'Blue', 'Green', 'Black', 'White'], array_slice($sizes, 0, 41)))
            ->assertUnprocessable()->assertJsonValidationErrors(['variants'], 'error.details');

        $this->assertSame(1, $this->inTenant($this->tenant['organization'], fn () => ProductVariant::query()->where('product_id', $this->product['id'])->count()), 'Nothing was saved.');

        // products.manage without inventory.adjust: no opening stock (403, nothing saved);
        // without online_catalog.manage compare-at prices are ignored.
        $roleId = $this->postJson('/api/v1/roles', ['name' => 'Catalogue clerk', 'permissions' => ['products.view', 'products.manage', 'inventory.view']])->assertCreated()->json('data.id');
        $clerk = $this->createUserWithRole($this->tenant['organization'], Role::query()->withoutGlobalScopes()->findOrFail($roleId), [$this->tenant['branch']->id]);
        $this->actingAsUser($clerk);
        $stocked = $this->grid(['Red'], ['S'], ['opening_stock' => '5'], ['stock_store_id' => $this->tenant['store']->id]);
        $this->putJson($this->url(), $stocked)->assertForbidden();
        $this->assertSame(0, $this->inTenant($this->tenant['organization'], fn () => StockMovement::query()->count()));

        $priced = $this->grid(['Red'], ['S'], ['compare_at_price' => '900.00']);
        $variant = $this->putJson($this->url(), $priced)->assertOk()->json('data.variants.0');
        $this->assertNull($variant['compare_at_price']);
        $this->assertArrayNotHasKey('purchase_price', $variant);
        $this->assertSame('0.000', $variant['stock']['total']);

        unset($other);
    }

    public function test_cost_is_kept_for_users_without_cost_access_and_tenants_are_isolated(): void
    {
        $this->shirt();
        $id = $this->putJson($this->url(), $this->grid(['Red'], ['S']))->assertOk()->json('data.variants.0.id');

        $roleId = $this->postJson('/api/v1/roles', ['name' => 'Pricer', 'permissions' => ['products.view', 'products.manage']])->assertCreated()->json('data.id');
        $pricer = $this->createUserWithRole($this->tenant['organization'], Role::query()->withoutGlobalScopes()->findOrFail($roleId), [$this->tenant['branch']->id]);
        $payload = $this->grid(['Red'], ['S']);
        unset($payload['variants'][0]['purchase_price']);
        $payload['variants'][0]['selling_price'] = '550.00';
        $variant = $this->actingAsUser($pricer)->putJson($this->url(), $payload)->assertOk()->json('data.variants.0');
        $this->assertSame($id, $variant['id']);
        $this->assertNull($variant['stock'], 'No inventory.view: no stock.');
        $stored = $this->inTenant($this->tenant['organization'], fn () => ProductVariant::query()->findOrFail($id));
        $this->assertSame(['200.00', '550.00'], [$stored->purchase_price, $stored->selling_price]);

        // Another organization's admin cannot see or change the product.
        $other = $this->openStore('Other Shop', 'other.test');
        $this->actingAsUser($other['admin']);
        $this->putJson($this->url(), $this->grid(['Red'], ['S']))->assertNotFound();
        $this->getJson("/api/v1/products/{$this->product['id']}")->assertNotFound();
    }
}
