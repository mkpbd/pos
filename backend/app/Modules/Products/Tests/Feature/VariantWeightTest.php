<?php

namespace App\Modules\Products\Tests\Feature;

use App\Modules\Catalog\Tests\Concerns\CreatesCatalog;
use App\Modules\Products\Application\Contracts\ProductDirectory;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * BD2a: a variant's delivery weight in grams on the product save / show APIs, the variant grid
 * and the ProductDirectory contract. Left out = kept; null clears it.
 */
class VariantWeightTest extends TestCase
{
    use CreatesCatalog, InteractsWithTenancy, RefreshDatabase;

    /**
     * @param  array<string, mixed>  $catalog
     * @param  array<string, mixed>  $variant
     * @return array<string, mixed>
     */
    private function payload(array $catalog, array $variant = []): array
    {
        return [
            'name' => 'Rice 5kg',
            'type' => 'standard',
            'unit_id' => $catalog['unit']->id,
            'variants' => [$variant + ['sku' => 'RICE5', 'purchase_price' => '400', 'selling_price' => '450']],
        ];
    }

    public function test_weight_is_saved_shown_kept_when_left_out_and_cleared_with_null(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $other = $this->provisionTenant('Other Shop');
        $catalog = $this->createCatalog($org);
        $this->actingAsUser($admin);

        $product = $this->postJson('/api/v1/products', $this->payload($catalog, ['weight_grams' => 5050]))->assertCreated()
            ->assertJsonPath('data.variants.0.weight_grams', 5050)->json('data');
        $variantId = $product['variants'][0]['id'];
        $this->getJson("/api/v1/products/{$product['id']}")->assertOk()->assertJsonPath('data.variants.0.weight_grams', 5050);

        $directory = app(ProductDirectory::class);
        $this->assertSame(5050, $directory->variants($org->id, [$variantId])[$variantId]['weight_grams']);
        $this->assertSame([], $directory->variants($other['organization']->id, [$variantId]));

        // Left out (older clients, imports): kept.
        $this->putJson("/api/v1/products/{$product['id']}", $this->payload($catalog, ['id' => $variantId, 'selling_price' => '460']))->assertOk()
            ->assertJsonPath('data.variants.0.weight_grams', 5050);
        $this->putJson("/api/v1/products/{$product['id']}/variants", [
            'options' => [],
            'variants' => [['id' => $variantId, 'sku' => 'RICE5', 'selling_price' => '460']],
        ])->assertOk()->assertJsonPath('data.variants.0.weight_grams', 5050);

        // The variant grid sets it; null clears it.
        $this->putJson("/api/v1/products/{$product['id']}/variants", [
            'options' => [],
            'variants' => [['id' => $variantId, 'sku' => 'RICE5', 'selling_price' => '460', 'weight_grams' => 4900]],
        ])->assertOk()->assertJsonPath('data.variants.0.weight_grams', 4900);
        $this->putJson("/api/v1/products/{$product['id']}", $this->payload($catalog, ['id' => $variantId, 'weight_grams' => null]))->assertOk()
            ->assertJsonPath('data.variants.0.weight_grams', null);
        $this->assertNull($directory->variants($org->id, [$variantId])[$variantId]['weight_grams']);

        // A product saved without weights has none.
        $this->postJson('/api/v1/products', $this->payload($catalog, ['sku' => 'PLAIN']))->assertCreated()
            ->assertJsonPath('data.variants.0.weight_grams', null);
    }

    public function test_weight_is_validated(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $catalog = $this->createCatalog($org);
        $this->actingAsUser($admin);

        foreach ([0, -5, 1.5, 'heavy', 1000001] as $bad) {
            $this->postJson('/api/v1/products', $this->payload($catalog, ['weight_grams' => $bad]))->assertStatus(422)
                ->assertJsonValidationErrors(['variants.0.weight_grams'], 'error.details');
        }
        $this->postJson('/api/v1/products', $this->payload($catalog, ['weight_grams' => 1]))->assertCreated();
    }
}
