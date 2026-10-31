<?php

namespace App\Modules\OnlineCatalog\Tests\Feature;

use App\Modules\Branches\Infrastructure\Models\Store;
use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class OnlineCatalogAdminTest extends TestCase
{
    use BuildsOnlineCatalog, InteractsWithTenancy, RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('public');
    }

    public function test_product_listing_defaults_and_save(): void
    {
        $t = $this->openStore('Berry Kids', 'berry.test');
        $juice = $this->makeProduct($t['unit']->id, 'Mango Juice 1L', [['MJ-1', '120.00']]);
        $other = $this->makeProduct($t['unit']->id, 'Mango Juice 1L!', [['MJ-2', '99.00']]);
        $this->publish($other['id']);

        $draft = $this->getJson("/api/v1/online-catalog/products/{$juice['id']}")->assertOk()->json('data');
        $this->assertFalse($draft['listing']['exists']);
        $this->assertSame('mango-juice-1l-2', $draft['listing']['slug'], 'The suggestion avoids slugs in use.');
        $this->assertSame('draft', $draft['listing']['state']);
        $this->assertSame([['variant_id' => $juice['variants'][0]['id'], 'compare_at_price' => null, 'image_id' => null]], $draft['variants']);
        $this->assertSame('120.00', $draft['product']['variants'][0]['selling_price']);
        $this->assertSame('/product/mango-juice-1l-2', $draft['url']);

        $image = $this->postJson("/api/v1/products/{$juice['id']}/images", ['image' => UploadedFile::fake()->image('j.jpg', 300, 300)])->json('data.images.0.id');
        $saved = $this->putJson("/api/v1/online-catalog/products/{$juice['id']}", [
            'slug' => ' Mango-Juice ',
            'is_published' => true,
            'is_featured' => true,
            'published_at' => now()->addDay()->toIso8601String(),
            'is_new_until' => now()->addWeek()->toDateString(),
            'short_description' => 'Fresh.',
            'description_html' => '<p>Sweet <img src="https://evil.test/x.png" onerror="alert(1)"></p>',
            'specifications' => [['label' => 'Volume', 'value' => '1 L'], ['label' => 'Origin', 'value' => 'Rajshahi']],
            'seo_title' => 'Mango juice',
            'variants' => [['variant_id' => $juice['variants'][0]['id'], 'compare_at_price' => '140', 'image_id' => $image]],
        ])->assertOk()->json('data');

        $this->assertTrue($saved['listing']['exists']);
        $this->assertSame('mango-juice', $saved['listing']['slug']);
        $this->assertSame('scheduled', $saved['listing']['state']);
        $this->assertStringNotContainsString('onerror', $saved['listing']['description_html']);
        $this->assertStringNotContainsString('evil.test', $saved['listing']['description_html']);
        $this->assertSame([['variant_id' => $juice['variants'][0]['id'], 'compare_at_price' => '140.00', 'image_id' => $image]], $saved['variants']);
        $this->assertSame('Rajshahi', $saved['listing']['specifications'][1]['value']);
        $this->assertTrue(DB::table('audit_logs')->where('action', 'online_catalog.product_listing.saved')->exists());

        // A blank slug keeps the current one.
        $this->putJson("/api/v1/online-catalog/products/{$juice['id']}", ['is_published' => true, 'is_featured' => false, 'slug' => null, 'published_at' => null])
            ->assertOk()->assertJsonPath('data.listing.slug', 'mango-juice')->assertJsonPath('data.listing.state', 'live')
            ->assertJsonPath('data.listing.short_description', 'Fresh.');
    }

    public function test_product_listing_validation(): void
    {
        $t = $this->openStore('Berry Kids', 'berry.test');
        $juice = $this->makeProduct($t['unit']->id, 'Mango Juice', [['MJ-1', '120.00']]);
        $tea = $this->makeProduct($t['unit']->id, 'Tea', [['TEA-1', '50.00']]);
        $teaImage = $this->postJson("/api/v1/products/{$tea['id']}/images", ['image' => UploadedFile::fake()->image('t.jpg')])->json('data.images.0.id');
        $this->publish($tea['id'], ['slug' => 'tea']);
        $variant = $juice['variants'][0]['id'];
        $url = "/api/v1/online-catalog/products/{$juice['id']}";
        $base = ['is_published' => true, 'is_featured' => false];

        $this->putJson($url, $base + ['variants' => [['variant_id' => $variant, 'compare_at_price' => '120.00']]])
            ->assertUnprocessable()->assertJsonPath('error.code', 'COMPARE_AT_NOT_ABOVE_PRICE')->assertJsonPath('error.details.variant_id', $variant);
        $this->putJson($url, $base + ['variants' => [['variant_id' => $tea['variants'][0]['id']]]])
            ->assertUnprocessable()->assertJsonValidationErrors('variants.0.variant_id', 'error.details');
        $this->putJson($url, $base + ['variants' => [['variant_id' => $variant, 'image_id' => $teaImage]]])
            ->assertUnprocessable()->assertJsonValidationErrors('variants.0.image_id', 'error.details');
        $this->putJson($url, $base + ['published_at' => '2026-11-05T00:00:00+06:00', 'unpublished_at' => '2026-11-04T00:00:00+06:00'])
            ->assertUnprocessable()->assertJsonValidationErrors('unpublished_at', 'error.details');
        $this->putJson($url, $base + ['slug' => 'tea'])->assertUnprocessable()->assertJsonValidationErrors('slug', 'error.details');
        $this->putJson($url, $base + ['slug' => 'Bad slug!'])->assertUnprocessable()->assertJsonValidationErrors('slug', 'error.details');
        $this->putJson($url, ['is_featured' => false])->assertUnprocessable()->assertJsonValidationErrors('is_published', 'error.details');
        $this->putJson($url, $base + ['specifications' => array_fill(0, 31, ['label' => 'a', 'value' => 'b'])])->assertUnprocessable();

        // Inactive products cannot be published (a draft listing is fine).
        $this->putJson("/api/v1/products/{$juice['id']}", [
            'name' => 'Mango Juice', 'type' => 'standard', 'unit_id' => $t['unit']->id, 'is_active' => false,
            'variants' => [['id' => $variant, 'sku' => 'MJ-1', 'purchase_price' => '1', 'selling_price' => '120.00']],
        ])->assertOk();
        $this->putJson($url, $base)->assertUnprocessable()->assertJsonPath('error.code', 'PRODUCT_NOT_SELLABLE');
        $this->putJson($url, ['is_published' => false, 'is_featured' => false])->assertOk();

        $this->getJson('/api/v1/online-catalog/products/00000000-0000-0000-0000-000000000000')->assertNotFound();
    }

    public function test_related_products_rules(): void
    {
        $t = $this->openStore('Berry Kids', 'berry.test');
        $a = $this->makeProduct($t['unit']->id, 'A', [['A', '1.00']])['id'];
        $b = $this->makeProduct($t['unit']->id, 'B', [['B', '1.00']])['id'];
        $c = $this->makeProduct($t['unit']->id, 'C', [['C', '1.00']])['id'];
        $other = $this->openStore('Tiny Toes', 'tiny.test');
        $foreign = $this->makeProduct($other['unit']->id, 'Foreign', [['F', '1.00']])['id'];
        $this->actingAsUser($t['admin']);
        $url = "/api/v1/online-catalog/products/{$a}/related";

        $this->putJson($url, ['related' => [$a], 'frequently_bought' => []])->assertUnprocessable()->assertJsonValidationErrors('related.0', 'error.details');
        $this->putJson($url, ['related' => [$foreign], 'frequently_bought' => []])->assertUnprocessable()->assertJsonPath('error.code', 'PRODUCT_NOT_FOUND');
        $this->putJson($url, ['related' => array_fill(0, 13, $b), 'frequently_bought' => []])->assertUnprocessable();
        $this->putJson($url, ['related' => [$c, $b], 'frequently_bought' => [$b]])->assertOk()
            ->assertJsonPath('data.related.related.0.id', $c)
            ->assertJsonPath('data.related.related.1.id', $b)
            ->assertJsonPath('data.related.frequently_bought.0.sku', 'B');
    }

    public function test_category_and_brand_listings(): void
    {
        $t = $this->openStore('Berry Kids', 'berry.test');
        $org = $t['organization'];
        $grocery = $this->category($org, 'Grocery');
        $drinks = $this->category($org, 'Cold Drinks', $grocery);
        $pran = $this->brand($org, 'Pran');

        $rows = $this->getJson('/api/v1/online-catalog/categories')->assertOk()->json('data');
        $this->assertSame([[$grocery, 0, null], [$drinks, 1, null]], array_map(fn ($r) => [$r['id'], $r['depth'], $r['listing']], $rows));

        $this->getJson("/api/v1/online-catalog/categories/{$drinks}")->assertOk()
            ->assertJsonPath('data.category.parent_id', $grocery)
            ->assertJsonPath('data.listing.exists', false)
            ->assertJsonPath('data.listing.slug', 'cold-drinks')
            ->assertJsonPath('data.url', '/category/cold-drinks');

        $this->putJson("/api/v1/online-catalog/categories/{$drinks}", ['is_visible' => true, 'image_media_id' => '00000000-0000-0000-0000-000000000000'])
            ->assertUnprocessable()->assertJsonPath('error.code', 'MEDIA_NOT_FOUND');
        $media = $this->post('/api/v1/media', ['file' => UploadedFile::fake()->image('c.png', 400, 300)], $this->spaHeaders())->json('data.id');
        $this->putJson("/api/v1/online-catalog/categories/{$drinks}", [
            'is_visible' => true, 'image_media_id' => $media, 'description_html' => '<p>Cold <script>x</script></p>', 'seo_title' => 'Drinks',
        ])->assertOk()
            ->assertJsonPath('data.listing.exists', true)
            ->assertJsonPath('data.listing.image_media_id', $media)
            ->assertJsonPath('data.listing.description_html', '<p>Cold </p>');
        $this->assertSame('cold-drinks', $this->getJson('/api/v1/online-catalog/categories')->json('data.1.listing.slug'));
        $this->putJson("/api/v1/online-catalog/categories/{$grocery}", ['is_visible' => true, 'slug' => 'cold-drinks'])
            ->assertUnprocessable()->assertJsonValidationErrors('slug', 'error.details');

        // Media used by a listing cannot be deleted.
        $this->deleteJson("/api/v1/media/{$media}")->assertStatus(422);

        $this->getJson('/api/v1/online-catalog/brands')->assertOk()->assertJsonPath('data.0.listing', null);
        $this->putJson("/api/v1/online-catalog/brands/{$pran}", ['is_visible' => false, 'description' => 'Food & drinks', 'slug' => 'pran-foods'])->assertOk()
            ->assertJsonPath('data.brand.name', 'Pran')
            ->assertJsonPath('data.listing.slug', 'pran-foods')
            ->assertJsonPath('data.listing.is_visible', false)
            ->assertJsonPath('data.url', '/brand/pran-foods');
        $this->putJson("/api/v1/online-catalog/brands/{$pran}", ['is_visible' => true])->assertOk()->assertJsonPath('data.listing.slug', 'pran-foods');
    }

    public function test_permissions(): void
    {
        $t = $this->openStore('Berry Kids', 'berry.test');
        $juice = $this->makeProduct($t['unit']->id, 'Juice', [['J', '1.00']])['id'];
        $cashier = $this->createUserWithRole($t['organization'], SystemRole::Cashier);
        $stock = $this->createUserWithRole($t['organization'], SystemRole::InventoryManager);
        $manager = $this->createUserWithRole($t['organization'], SystemRole::OnlineStoreManager);

        $this->actingAsUser($cashier);
        $this->getJson("/api/v1/online-catalog/products/{$juice}")->assertForbidden();
        $this->putJson("/api/v1/online-catalog/products/{$juice}", ['is_published' => true, 'is_featured' => false])->assertForbidden();
        $this->getJson('/api/v1/online-catalog/categories')->assertForbidden();
        $this->getJson('/api/v1/attributes')->assertOk();
        $this->postJson('/api/v1/attributes', ['name' => 'Size', 'display' => 'button', 'is_filterable' => true, 'values' => []])->assertForbidden();

        $this->actingAsUser($stock);
        $this->postJson('/api/v1/attributes', ['name' => 'Size', 'display' => 'button', 'is_filterable' => true, 'values' => []])->assertForbidden();

        $this->actingAsUser($manager);
        $this->putJson("/api/v1/online-catalog/products/{$juice}", ['is_published' => true, 'is_featured' => false])->assertOk();
        $this->postJson('/api/v1/attributes', ['name' => 'Size', 'display' => 'button', 'is_filterable' => true, 'values' => []])->assertCreated();
    }

    public function test_organizations_are_isolated(): void
    {
        $a = $this->openStore('Berry Kids', 'berry.test');
        $juice = $this->makeProduct($a['unit']->id, 'Juice', [['J', '1.00']])['id'];
        $this->publish($juice);
        $category = $this->category($a['organization'], 'Grocery');
        $brand = $this->brand($a['organization'], 'Pran');
        $attribute = $this->postJson('/api/v1/attributes', ['name' => 'Size', 'display' => 'button', 'is_filterable' => true, 'values' => [['value' => 'M']]])->json('data.id');

        $b = $this->openStore('Tiny Toes', 'tiny.test');
        $this->getJson("/api/v1/online-catalog/products/{$juice}")->assertNotFound();
        $this->putJson("/api/v1/online-catalog/products/{$juice}", ['is_published' => false, 'is_featured' => false])->assertNotFound();
        $this->putJson("/api/v1/online-catalog/products/{$juice}/related", ['related' => [], 'frequently_bought' => []])->assertNotFound();
        $this->getJson("/api/v1/online-catalog/categories/{$category}")->assertNotFound();
        $this->putJson("/api/v1/online-catalog/categories/{$category}", ['is_visible' => true])->assertNotFound();
        $this->putJson("/api/v1/online-catalog/brands/{$brand}", ['is_visible' => true])->assertNotFound();
        $this->assertSame([], $this->getJson('/api/v1/online-catalog/categories')->json('data'));
        $this->assertSame([], $this->getJson('/api/v1/online-catalog/brands')->json('data'));
        $this->assertSame([], $this->getJson('/api/v1/attributes')->json('data'));
        $this->patchJson("/api/v1/attributes/{$attribute}", ['name' => 'Hacked'])->assertNotFound();
        $this->deleteJson("/api/v1/attributes/{$attribute}")->assertNotFound();
        // B's own product can take the same slug: slugs are unique per organization.
        $mine = $this->makeProduct($b['unit']->id, 'Juice', [['J', '1.00']])['id'];
        $this->assertSame('juice', $this->publish($mine)['listing']['slug']);

        // Settings: another organization's store cannot be the fulfilment store.
        $this->patchJson('/api/v1/storefront/settings', ['fulfilment_store_id' => $a['store']->id])
            ->assertUnprocessable()->assertJsonPath('error.code', 'STORE_NOT_FOUND');
    }

    public function test_fulfilment_store_setting(): void
    {
        $t = $this->openStore('Berry Kids', 'berry.test', withFulfilment: false);
        $this->getJson('/api/v1/storefront/settings')->assertOk()->assertJsonPath('data.fulfilment_store_id', null);

        $this->patchJson('/api/v1/storefront/settings', ['fulfilment_store_id' => $t['store']->id])->assertOk()
            ->assertJsonPath('data.fulfilment_store_id', $t['store']->id);
        $this->patchJson('/api/v1/storefront/settings', ['fulfilment_store_id' => 'nope'])->assertUnprocessable();

        Store::query()->withoutGlobalScopes()->whereKey($t['store']->id)->update(['is_active' => false]);
        $this->patchJson('/api/v1/storefront/settings', ['fulfilment_store_id' => $t['store']->id])
            ->assertUnprocessable()->assertJsonPath('error.code', 'STORE_NOT_FOUND');
        $this->patchJson('/api/v1/storefront/settings', ['fulfilment_store_id' => null])->assertOk()->assertJsonPath('data.fulfilment_store_id', null);
    }
}
