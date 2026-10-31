<?php

namespace App\Modules\Products\Tests\Feature;

use App\Modules\Catalog\Tests\Concerns\CreatesCatalog;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Critical workflow #1: product creation.
 */
class ProductManagementTest extends TestCase
{
    use CreatesCatalog, InteractsWithTenancy, RefreshDatabase;

    /**
     * @param  array<string, mixed>  $catalog
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    private function payload(array $catalog, array $overrides = []): array
    {
        return array_replace([
            'name' => 'Mango Juice 250ml',
            'type' => 'standard',
            'category_id' => $catalog['category']->id,
            'brand_id' => $catalog['brand']->id,
            'unit_id' => $catalog['unit']->id,
            'tax_rate_id' => $catalog['tax']->id,
            'track_stock' => true,
            'max_discount_percent' => '10',
            'is_active' => true,
            'variants' => [[
                'purchase_price' => '18.50',
                'selling_price' => '25.00',
                'wholesale_price' => '22.00',
                'reorder_level' => '24',
                'barcodes' => ['4006381333931'],
            ]],
        ], $overrides);
    }

    public function test_creates_simple_product_with_generated_sku(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $catalog = $this->createCatalog($org);

        $response = $this->actingAsUser($admin)->postJson('/api/v1/products', $this->payload($catalog));

        $response->assertCreated()
            ->assertJsonPath('data.name', 'Mango Juice 250ml')
            ->assertJsonPath('data.category.name', 'Beverages')
            ->assertJsonPath('data.unit.code', 'pcs')
            ->assertJsonPath('data.tax_rate.rate', '15.0000')
            ->assertJsonPath('data.max_discount_percent', '10.00')
            ->assertJsonPath('data.variants.0.sku', 'SKU-000001')
            ->assertJsonPath('data.variants.0.purchase_price', '18.50')
            ->assertJsonPath('data.variants.0.selling_price', '25.00')
            ->assertJsonPath('data.variants.0.reorder_level', '24.000')
            ->assertJsonPath('data.variants.0.barcodes', ['4006381333931']);

        $this->assertDatabaseHas('audit_logs', ['action' => 'product.created', 'subject_id' => $response->json('data.id')]);

        $second = $this->postJson('/api/v1/products', $this->payload($catalog, ['name' => 'Orange Juice', 'variants' => [['purchase_price' => '1', 'selling_price' => '2']]]));
        $second->assertCreated()->assertJsonPath('data.variants.0.sku', 'SKU-000002');
    }

    public function test_creates_product_with_variant_matrix(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $catalog = $this->createCatalog($org);

        $response = $this->actingAsUser($admin)->postJson('/api/v1/products', $this->payload($catalog, [
            'name' => 'Polo Shirt',
            'options' => [['name' => 'Size', 'values' => ['M', 'L']]],
            'variants' => [
                ['sku' => 'POLO-M', 'option_values' => ['size' => 'm'], 'purchase_price' => '300', 'selling_price' => '450', 'barcodes' => []],
                ['sku' => 'POLO-L', 'option_values' => ['Size' => 'L'], 'purchase_price' => '320', 'selling_price' => '480', 'barcodes' => []],
            ],
        ]));

        $response->assertCreated()
            ->assertJsonCount(2, 'data.variants')
            ->assertJsonPath('data.variants.0.option_values', ['Size' => 'M']) // canonical spelling
            ->assertJsonPath('data.variants.1.selling_price', '480.00');
    }

    public function test_rejects_bad_barcodes_duplicates_and_inactive_references(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $catalog = $this->createCatalog($org);
        $this->actingAsUser($admin);
        $this->postJson('/api/v1/products', $this->payload($catalog, ['variants' => [['sku' => 'JUICE', 'purchase_price' => '1', 'selling_price' => '2', 'barcodes' => ['96385074']]]]))->assertCreated();

        $this->postJson('/api/v1/products', $this->payload($catalog, ['variants' => [['purchase_price' => '1', 'selling_price' => '2', 'barcodes' => ['4006381333932']]]]))
            ->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['variants.0.barcodes.0']]]);
        $this->postJson('/api/v1/products', $this->payload($catalog, ['variants' => [['purchase_price' => '1', 'selling_price' => '2', 'barcodes' => ['96385074']]]]))
            ->assertStatus(422)->assertJsonPath('error.details', ['variants.0.barcodes.0' => ['Barcode "96385074" is already assigned to another product.']]);
        $this->postJson('/api/v1/products', $this->payload($catalog, ['variants' => [['sku' => 'juice', 'purchase_price' => '1', 'selling_price' => '2']]]))
            ->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['variants.0.sku']]]);
        $this->postJson('/api/v1/products', $this->payload($catalog, ['variants' => [['purchase_price' => '-1', 'selling_price' => '2.555']]]))
            ->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['variants.0.purchase_price', 'variants.0.selling_price']]]);

        $catalog['brand']->forceFill(['is_active' => false])->save();
        $this->postJson('/api/v1/products', $this->payload($catalog, ['variants' => [['purchase_price' => '1', 'selling_price' => '2']]]))
            ->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['brand_id']]]);
    }

    public function test_update_replaces_variants_releases_skus_and_audits_price_changes(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $catalog = $this->createCatalog($org);
        $this->actingAsUser($admin);
        $product = $this->postJson('/api/v1/products', $this->payload($catalog, [
            'options' => [['name' => 'Size', 'values' => ['M', 'L']]],
            'variants' => [
                ['sku' => 'P-M', 'option_values' => ['Size' => 'M'], 'purchase_price' => '10', 'selling_price' => '15', 'barcodes' => ['96385074']],
                ['sku' => 'P-L', 'option_values' => ['Size' => 'L'], 'purchase_price' => '12', 'selling_price' => '18'],
            ],
        ]))->json('data');

        // Keep M (new price, barcode moved to a new variant), drop L, add XL reusing L's SKU.
        $updated = $this->putJson("/api/v1/products/{$product['id']}", $this->payload($catalog, [
            'options' => [['name' => 'Size', 'values' => ['M', 'XL']]],
            'variants' => [
                ['id' => $product['variants'][0]['id'], 'sku' => 'P-M', 'option_values' => ['Size' => 'M'], 'purchase_price' => '10', 'selling_price' => '16', 'barcodes' => []],
                ['sku' => 'P-L', 'option_values' => ['Size' => 'XL'], 'purchase_price' => '13', 'selling_price' => '20', 'barcodes' => ['96385074']],
            ],
        ]));

        $updated->assertOk()
            ->assertJsonCount(2, 'data.variants')
            ->assertJsonPath('data.variants.0.id', $product['variants'][0]['id'])
            ->assertJsonPath('data.variants.0.selling_price', '16.00')
            ->assertJsonPath('data.variants.1.option_values', ['Size' => 'XL'])
            ->assertJsonPath('data.variants.1.barcodes', ['96385074']);
        $this->assertSoftDeleted('product_variants', ['id' => $product['variants'][1]['id']]);

        $audit = $this->getJson('/api/v1/audit-logs?action=product.updated')->assertOk()->json('data.0');
        $this->assertSame('15.00', $audit['old_values']['variants']['P-M']['selling_price']);
        $this->assertSame('16.00', $audit['new_values']['variants']['P-M']['selling_price']);
    }

    public function test_variant_ids_from_other_products_are_rejected(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $catalog = $this->createCatalog($org);
        $this->actingAsUser($admin);
        $a = $this->postJson('/api/v1/products', $this->payload($catalog, ['variants' => [['purchase_price' => '1', 'selling_price' => '2']]]))->json('data');
        $b = $this->postJson('/api/v1/products', $this->payload($catalog, ['name' => 'B', 'variants' => [['purchase_price' => '1', 'selling_price' => '2']]]))->json('data');

        $this->putJson("/api/v1/products/{$b['id']}", $this->payload($catalog, ['variants' => [
            ['id' => $a['variants'][0]['id'], 'purchase_price' => '1', 'selling_price' => '2'],
        ]]))->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['variants.0.id']]]);
    }

    public function test_cost_prices_are_hidden_from_cashiers(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $catalog = $this->createCatalog($org);
        $id = $this->actingAsUser($admin)->postJson('/api/v1/products', $this->payload($catalog))->json('data.id');
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier);

        $variant = $this->actingAsUser($cashier)->getJson("/api/v1/products/{$id}")->assertOk()->json('data.variants.0');

        $this->assertArrayNotHasKey('purchase_price', $variant);
        $this->assertSame('25.00', $variant['selling_price']);
        $this->actingAsUser($cashier)->postJson('/api/v1/products', $this->payload($catalog))->assertForbidden();
    }

    public function test_search_filters_archive_and_restore(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $catalog = $this->createCatalog($org);
        $this->actingAsUser($admin);
        $juice = $this->postJson('/api/v1/products', $this->payload($catalog))->json('data.id');
        $this->postJson('/api/v1/products', $this->payload($catalog, ['name' => 'Repair service', 'type' => 'service', 'category_id' => null, 'variants' => [['purchase_price' => '0', 'selling_price' => '500']]]))
            ->assertCreated()->assertJsonPath('data.track_stock', false);

        $this->getJson('/api/v1/products?search=mango')->assertJsonCount(1, 'data');
        $this->getJson('/api/v1/products?search=4006381333931')->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $juice);
        $this->getJson('/api/v1/products?search=SKU-000002')->assertJsonCount(1, 'data')->assertJsonPath('data.0.type', 'service');
        $this->getJson('/api/v1/products?type=service')->assertJsonCount(1, 'data');
        $this->getJson("/api/v1/products?category_id={$catalog['category']->id}")->assertJsonCount(1, 'data');

        $this->deleteJson("/api/v1/products/{$juice}")->assertNoContent();
        $this->getJson('/api/v1/products')->assertJsonCount(1, 'data');
        $this->getJson('/api/v1/products?archived=1')->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $juice);
        $this->getJson("/api/v1/products/{$juice}")->assertNotFound();

        $this->postJson("/api/v1/products/{$juice}/restore")->assertOk()->assertJsonPath('data.archived_at', null);
        $this->assertDatabaseHas('audit_logs', ['action' => 'product.restored', 'subject_id' => $juice]);
    }

    public function test_lookup_by_barcode_or_sku_for_the_till(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $catalog = $this->createCatalog($org);
        $this->actingAsUser($admin);
        $id = $this->postJson('/api/v1/products', $this->payload($catalog))->json('data.id');

        $this->getJson('/api/v1/products/lookup?code=4006381333931')
            ->assertOk()->assertJsonPath('data.id', $id)->assertJsonPath('data.tax_rate.rate', '15.0000')->assertJsonCount(1, 'data.variants');
        $this->getJson('/api/v1/products/lookup?code=sku-000001')->assertOk()->assertJsonPath('data.id', $id);
        $this->getJson('/api/v1/products/lookup?code=0000')->assertNotFound();

        $this->deleteJson("/api/v1/products/{$id}");
        $this->getJson('/api/v1/products/lookup?code=4006381333931')
            ->assertStatus(422)->assertJsonPath('error.code', 'PRODUCT_NOT_SELLABLE');
    }

    public function test_products_are_isolated_per_organization(): void
    {
        ['admin' => $adminA, 'organization' => $orgA] = $this->provisionTenant('Alpha');
        ['admin' => $adminB, 'organization' => $orgB] = $this->provisionTenant('Beta');
        $catalogA = $this->createCatalog($orgA);
        $catalogB = $this->createCatalog($orgB);
        $productB = $this->actingAsUser($adminB)->postJson('/api/v1/products', $this->payload($catalogB))->json('data.id');

        $this->actingAsUser($adminA);
        $this->getJson("/api/v1/products/{$productB}")->assertNotFound();
        $this->getJson('/api/v1/products/lookup?code=4006381333931')->assertNotFound();
        // Using another organization's unit is rejected; barcodes are unique per organization only.
        $this->postJson('/api/v1/products', $this->payload($catalogA, ['unit_id' => $catalogB['unit']->id]))
            ->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['unit_id']]]);
        $this->postJson('/api/v1/products', $this->payload($catalogA))->assertCreated();
    }

    public function test_catalog_records_in_use_by_products_cannot_be_deleted(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $catalog = $this->createCatalog($org);
        $this->actingAsUser($admin)->postJson('/api/v1/products', $this->payload($catalog))->assertCreated();

        $this->deleteJson("/api/v1/units/{$catalog['unit']->id}")->assertStatus(422)->assertJsonPath('error.code', 'IN_USE');
        $this->deleteJson("/api/v1/tax-rates/{$catalog['tax']->id}")->assertStatus(422)->assertJsonPath('error.code', 'IN_USE');
        $this->deleteJson("/api/v1/categories/{$catalog['category']->id}")->assertStatus(422)->assertJsonPath('error.code', 'IN_USE');
    }
}
