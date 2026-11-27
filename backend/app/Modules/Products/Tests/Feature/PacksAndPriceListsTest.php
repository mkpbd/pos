<?php

namespace App\Modules\Products\Tests\Feature;

use App\Modules\Catalog\Tests\Concerns\CreatesCatalog;
use App\Modules\Inventory\Tests\Concerns\InteractsWithStock;
use App\Modules\Products\Application\Contracts\ProductDirectory;
use App\Modules\Products\Infrastructure\Models\ProductVariant;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * ST2c: pack (carton) barcodes, quantity breaks and branch prices on the product APIs, the POS
 * scan lookup / catalog and the ProductDirectory contract.
 */
class PacksAndPriceListsTest extends TestCase
{
    use CreatesCatalog, InteractsWithStock, InteractsWithTenancy, RefreshDatabase;

    /**
     * @param  array<string, mixed>  $catalog
     * @param  array<string, mixed>  $variant
     * @return array<string, mixed>
     */
    private function payload(array $catalog, array $variant = []): array
    {
        return [
            'name' => 'Mango Juice 250ml',
            'type' => 'standard',
            'unit_id' => $catalog['unit']->id,
            'variants' => [$variant + [
                'sku' => 'MANGO',
                'purchase_price' => '18.50',
                'selling_price' => '25.00',
                'wholesale_price' => '22.00',
                'barcodes' => ['UNIT-001', ['barcode' => 'CTN-024', 'units' => '24', 'pack_name' => 'Carton']],
            ]],
        ];
    }

    public function test_pack_barcode_is_saved_shown_and_scanned_at_the_till(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $catalog = $this->createCatalog($org);
        $this->actingAsUser($admin);

        $product = $this->postJson('/api/v1/products', $this->payload($catalog))->assertCreated()
            ->assertJsonPath('data.variants.0.barcodes', ['UNIT-001', 'CTN-024'])
            ->assertJsonPath('data.variants.0.packs', [['barcode' => 'CTN-024', 'units' => '24.000', 'pack_name' => 'Carton']])
            ->json('data');
        $variantId = $product['variants'][0]['id'];
        $this->assertDatabaseHas('product_barcodes', ['barcode' => 'UNIT-001', 'units' => '1.000', 'pack_name' => null]);

        $store = $this->mainStoreId($org);
        $this->getJson("/api/v1/pos/lookup?store_id={$store}&code=CTN-024")->assertOk()
            ->assertJsonPath('data.variant_id', $variantId)
            ->assertJsonPath('data.scan_units', '24.000')
            ->assertJsonPath('data.pack_name', 'Carton')
            ->assertJsonPath('data.price', '25.00')
            ->assertJsonPath('data.packs', [['barcode' => 'CTN-024', 'units' => '24.000', 'pack_name' => 'Carton']]);
        $this->getJson("/api/v1/pos/lookup?store_id={$store}&code=UNIT-001")->assertOk()
            ->assertJsonPath('data.scan_units', '1.000')
            ->assertJsonPath('data.pack_name', null);
        $this->getJson("/api/v1/pos/lookup?store_id={$store}&code=mango")->assertOk()->assertJsonPath('data.scan_units', '1.000');
        $this->getJson("/api/v1/pos/catalog?store_id={$store}&search=CTN-024")->assertOk()
            ->assertJsonPath('data.0.packs.0.units', '24.000');

        // Plain codes keep their pack data (the import and older clients send strings) …
        $update = $this->payload($catalog, ['id' => $variantId, 'barcodes' => ['UNIT-001', 'CTN-024', ['barcode' => 'BOX-006', 'units' => '6', 'pack_name' => 'Box']]]);
        $this->putJson("/api/v1/products/{$product['id']}", $update)->assertOk()
            ->assertJsonPath('data.variants.0.packs', [
                ['barcode' => 'CTN-024', 'units' => '24.000', 'pack_name' => 'Carton'],
                ['barcode' => 'BOX-006', 'units' => '6.000', 'pack_name' => 'Box'],
            ]);
        // … an object sets them (here: the carton becomes a unit barcode); changes are audited.
        $update['variants'][0]['barcodes'] = ['UNIT-001', ['barcode' => 'CTN-024', 'units' => '1'], 'BOX-006'];
        $this->putJson("/api/v1/products/{$product['id']}", $update)->assertOk()
            ->assertJsonPath('data.variants.0.packs', [['barcode' => 'BOX-006', 'units' => '6.000', 'pack_name' => 'Box']]);
        $audit = collect($this->getJson('/api/v1/audit-logs?action=product.updated')->assertOk()->json('data'))
            ->firstOrFail(fn (array $a) => ($a['new_values']['variants']['MANGO']['packs'] ?? null) === ['BOX-006' => '6.000 Box']);
        $this->assertSame(['BOX-006' => '6.000 Box', 'CTN-024' => '24.000 Carton'], $audit['old_values']['variants']['MANGO']['packs']);

        // Unit labels and stocktake never use a pack barcode.
        $directory = app(ProductDirectory::class);
        $this->assertSame([$variantId => 'UNIT-001'], $directory->primaryBarcodes($org->id, [$variantId]));
        $this->getJson('/api/v1/products/labels?'.http_build_query(['variant_ids' => [$variantId]]))->assertOk()->assertJsonPath('data.labels.0.barcode', 'UNIT-001');
        // Replacing with generated barcodes replaces the unit barcodes (UNIT-001, CTN-024 now) and keeps the box.
        $generated = $this->postJson('/api/v1/products/barcodes/generate', ['variant_ids' => [$variantId], 'overwrite' => true])
            ->assertOk()->json('data.0.barcode');
        $shown = $this->getJson("/api/v1/products/{$product['id']}")->assertOk()->json('data.variants.0');
        $this->assertEqualsCanonicalizing([$generated, 'BOX-006'], $shown['barcodes']);
        $this->assertSame('BOX-006', $shown['packs'][0]['barcode']);
    }

    public function test_pack_barcodes_are_validated(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $catalog = $this->createCatalog($org);
        $this->actingAsUser($admin);

        $this->postJson('/api/v1/products', $this->payload($catalog, ['barcodes' => [
            ['barcode' => 'CTN-024', 'units' => '24'],
            ['barcode' => 'HALF', 'units' => '2.5', 'pack_name' => 'Tray'],
            ['barcode' => 'ZERO', 'units' => '0', 'pack_name' => 'Nothing'],
            ['units' => '3'],
        ]]))->assertUnprocessable()
            ->assertJsonValidationErrors(['variants.0.barcodes.2.units', 'variants.0.barcodes.3'], 'error.details');

        $this->postJson('/api/v1/products', $this->payload($catalog, ['barcodes' => [
            ['barcode' => 'CTN-024', 'units' => '24'],
            ['barcode' => 'HALF', 'units' => '2.5', 'pack_name' => 'Tray'],
        ]]))->assertUnprocessable()
            ->assertJsonValidationErrors(['variants.0.barcodes.0.pack_name', 'variants.0.barcodes.1.units'], 'error.details');
    }

    public function test_quantity_breaks_and_branch_prices_are_saved_validated_and_replaced(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $other = $this->provisionTenant('Other Shop');
        $catalog = $this->createCatalog($org);
        $second = $this->createBranch($org, 'B2');
        $this->actingAsUser($admin);

        $product = $this->postJson('/api/v1/products', $this->payload($catalog, [
            'price_tiers' => [['min_quantity' => '12', 'price' => '21.00'], ['min_quantity' => '6', 'price' => '23.50']],
            'branch_prices' => [['branch_id' => $branch->id, 'price' => '26.00']],
        ]))->assertCreated()
            ->assertJsonPath('data.variants.0.price_tiers', [['min_quantity' => '6.000', 'price' => '23.50'], ['min_quantity' => '12.000', 'price' => '21.00']])
            ->assertJsonPath('data.variants.0.branch_prices', [['branch_id' => $branch->id, 'price' => '26.00']])
            ->assertJsonPath('data.variants.0.wholesale_price', '22.00')
            ->json('data');
        $variantId = $product['variants'][0]['id'];
        $this->getJson("/api/v1/products/{$product['id']}")->assertOk()->assertJsonCount(2, 'data.variants.0.price_tiers');

        // Validation: min > 1, unique per variant, branches of the organization only.
        $bad = $this->payload($catalog, ['id' => $variantId,
            'price_tiers' => [['min_quantity' => '1', 'price' => '20'], ['min_quantity' => '5', 'price' => '-1']],
            'branch_prices' => [['branch_id' => 'not-a-uuid', 'price' => '1']],
        ]);
        $this->putJson("/api/v1/products/{$product['id']}", $bad)->assertUnprocessable()
            ->assertJsonValidationErrors(['variants.0.price_tiers.0.min_quantity', 'variants.0.price_tiers.1.price', 'variants.0.branch_prices.0.branch_id'], 'error.details');
        $bad['variants'][0]['price_tiers'] = [['min_quantity' => '5', 'price' => '20'], ['min_quantity' => '5.000', 'price' => '19']];
        $bad['variants'][0]['branch_prices'] = [['branch_id' => $branch->id, 'price' => '1'], ['branch_id' => $branch->id, 'price' => '2'], ['branch_id' => $other['branch']->id, 'price' => '3']];
        $this->putJson("/api/v1/products/{$product['id']}", $bad)->assertUnprocessable()
            ->assertJsonValidationErrors(['variants.0.price_tiers.1.min_quantity', 'variants.0.branch_prices.1.branch_id', 'variants.0.branch_prices.2.branch_id'], 'error.details');

        // Lists left out are kept …
        $this->putJson("/api/v1/products/{$product['id']}", $this->payload($catalog, ['id' => $variantId]))->assertOk()
            ->assertJsonCount(2, 'data.variants.0.price_tiers')
            ->assertJsonCount(1, 'data.variants.0.branch_prices');
        // … lists sent replace the stored ones, and the change is audited.
        $this->putJson("/api/v1/products/{$product['id']}", $this->payload($catalog, ['id' => $variantId,
            'price_tiers' => [['min_quantity' => '24', 'price' => '20.00']],
            'branch_prices' => [['branch_id' => $second->id, 'price' => '24.00']],
        ]))->assertOk()
            ->assertJsonPath('data.variants.0.price_tiers', [['min_quantity' => '24.000', 'price' => '20.00']])
            ->assertJsonPath('data.variants.0.branch_prices', [['branch_id' => $second->id, 'price' => '24.00']]);
        $audit = $this->getJson('/api/v1/audit-logs?action=product.updated')->assertOk()->json('data.0');
        $this->assertSame(['6.000: 23.50', '12.000: 21.00'], $audit['old_values']['variants']['MANGO']['price_tiers']);
        $this->assertSame([$second->id => '24.00'], $audit['new_values']['variants']['MANGO']['branch_prices']);

        $this->putJson("/api/v1/products/{$product['id']}", $this->payload($catalog, ['id' => $variantId, 'price_tiers' => [], 'branch_prices' => []]))->assertOk()
            ->assertJsonPath('data.variants.0.price_tiers', [])
            ->assertJsonPath('data.variants.0.branch_prices', []);
    }

    public function test_variant_grid_saves_packs_and_price_lists(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $catalog = $this->createCatalog($org);
        $this->actingAsUser($admin);
        $product = $this->postJson('/api/v1/products', $this->payload($catalog))->assertCreated()->json('data');

        $this->putJson("/api/v1/products/{$product['id']}/variants", [
            'options' => [['name' => 'Size', 'values' => ['S']]],
            'variants' => [[
                'option_values' => ['Size' => 'S'],
                'sku' => 'MANGO-S',
                'selling_price' => '25.00',
                'barcodes' => [['barcode' => 'CTN-S', 'units' => '12', 'pack_name' => 'Carton']],
                'price_tiers' => [['min_quantity' => '12', 'price' => '22.00']],
                'branch_prices' => [['branch_id' => $branch->id, 'price' => '27.00']],
            ]],
        ])->assertOk()
            ->assertJsonPath('data.variants.0.packs.0.units', '12.000')
            ->assertJsonPath('data.variants.0.price_tiers.0.price', '22.00')
            ->assertJsonPath('data.variants.0.branch_prices.0.price', '27.00');
    }

    public function test_product_directory_carries_wholesale_tiers_packs_and_branch_prices_per_organization(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $other = $this->provisionTenant('Other Shop');
        $catalog = $this->createCatalog($org);
        $this->actingAsUser($admin);
        $variantId = $this->postJson('/api/v1/products', $this->payload($catalog, [
            'price_tiers' => [['min_quantity' => '12', 'price' => '21.00'], ['min_quantity' => '6', 'price' => '23.50']],
            'branch_prices' => [['branch_id' => $branch->id, 'price' => '26.00']],
        ]))->assertCreated()->json('data.variants.0.id');
        $plainId = $this->postJson('/api/v1/products', ['name' => 'Water', 'type' => 'standard', 'unit_id' => $catalog['unit']->id,
            'variants' => [['purchase_price' => '5', 'selling_price' => '10']]])->assertCreated()->json('data.variants.0.id');

        $directory = app(ProductDirectory::class);
        $variants = $directory->variants($org->id, [$variantId, $plainId]);
        $this->assertSame('22.00', $variants[$variantId]['wholesale_price']);
        $this->assertSame([['min_quantity' => '6.000', 'price' => '23.50'], ['min_quantity' => '12.000', 'price' => '21.00']], $variants[$variantId]['price_tiers']);
        $this->assertSame([['barcode' => 'CTN-024', 'units' => '24.000', 'pack_name' => 'Carton']], $variants[$variantId]['packs']);
        $this->assertNull($variants[$plainId]['wholesale_price']);
        $this->assertSame([], $variants[$plainId]['price_tiers']);
        $this->assertSame([], $variants[$plainId]['packs']);

        $this->assertSame([$variantId => '26.00'], $directory->branchPrices($org->id, $branch->id, [$variantId, $plainId]));
        $this->assertSame([], $directory->branchPrices($org->id, $branch->id, []));
        // Isolation: another organization sees none of it.
        $this->assertSame([], $directory->branchPrices($other['organization']->id, $branch->id, [$variantId]));
        $this->assertSame([], $directory->variants($other['organization']->id, [$variantId]));

        // Another organization cannot read or edit the product.
        $this->actingAsUser($other['admin']);
        $this->getJson('/api/v1/products/'.$this->inTenant($org, fn () => ProductVariant::query()->findOrFail($variantId)->product_id))
            ->assertNotFound();
    }
}
