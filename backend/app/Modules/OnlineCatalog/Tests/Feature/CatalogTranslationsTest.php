<?php

namespace App\Modules\OnlineCatalog\Tests\Feature;

use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * E12b: Bangla translations of product, category and brand listings — staff round trip
 * (validation, partial updates, sanitizing) and the public catalog in en / bn with per-field
 * fallback, search over base and Bangla names, cache and ETag isolation per language, the
 * Bangla switch and tenant isolation.
 */
class CatalogTranslationsTest extends TestCase
{
    use BuildsOnlineCatalog, InteractsWithTenancy, RefreshDatabase;

    /**
     * Berry Kids on berry.test: Clothes (bn), brand Polo (bn), a translated shirt and an
     * untranslated cap.
     *
     * @return array{0: array<string, mixed>, 1: array<string, mixed>}
     */
    private function shop(string $name = 'Berry Kids', string $host = 'berry.test'): array
    {
        $t = $this->openStore($name, $host);
        $org = $t['organization'];
        $clothes = $this->category($org, 'Clothes');
        $polo = $this->brand($org, 'Polo');
        $this->listCategory($clothes, ['translations' => ['bn' => ['name' => 'জামাকাপড়', 'description_html' => '<p>সব <strong>পোশাক</strong></p>']]]);
        $this->listBrand($polo, ['description' => 'Classic polo.', 'translations' => ['bn' => ['name' => 'পোলো ব্র্যান্ড']]]);

        $shirt = $this->makeProduct($t['unit']->id, 'Polo Shirt', [['SHIRT', '500.00']], ['category_id' => $clothes, 'brand_id' => $polo]);
        $editor = $this->publish($shirt['id'], [
            'slug' => 'polo-shirt',
            'short_description' => 'Soft cotton.',
            'description_html' => '<p>Breathable.</p>',
            'seo_title' => 'Polo shirt for kids',
            'translations' => ['bn' => [
                'name' => '  পোলো শার্ট ',
                'short_description' => 'নরম সুতি।',
                'description_html' => '<p>আরামদায়ক</p><script>alert(1)</script>',
                'seo_title' => '',
            ]],
        ]);
        $cap = $this->makeProduct($t['unit']->id, 'Cap', [['CAP', '120.00']], ['brand_id' => $polo]);
        $this->publish($cap['id'], ['slug' => 'cap', 'short_description' => 'A sunny cap.']);

        return [$t, compact('clothes', 'polo', 'shirt', 'cap', 'editor')];
    }

    public function test_staff_save_listing_translations_with_validation_partial_updates_and_sanitizing(): void
    {
        [, $ids] = $this->shop();

        // Trimmed, rich text sanitized, blank fields dropped (key order is the store's: jsonb sorts keys).
        $this->assertEquals(['bn' => [
            'description_html' => '<p>আরামদায়ক</p>',
            'name' => 'পোলো শার্ট',
            'short_description' => 'নরম সুতি।',
        ]], $ids['editor']['listing']['translations']);

        $url = "/api/v1/online-catalog/products/{$ids['shirt']['id']}";
        $base = ['is_published' => true, 'is_featured' => false];
        // Partial: only the sent fields change; a blank one removes its translation.
        $saved = $this->putJson($url, $base + ['translations' => ['bn' => ['seo_description' => 'বাচ্চাদের পোলো', 'short_description' => ' ']]])
            ->assertOk()->json('data.listing.translations.bn');
        $this->assertEquals(['description_html' => '<p>আরামদায়ক</p>', 'name' => 'পোলো শার্ট', 'seo_description' => 'বাচ্চাদের পোলো'], $saved);
        // Leaving `translations` out keeps them.
        $this->putJson($url, $base + ['short_description' => 'Soft cotton!'])->assertOk()->assertJsonPath('data.listing.translations.bn.name', 'পোলো শার্ট');

        // Unknown locales and fields, wrong types and the base field's limits → 422.
        $this->putJson($url, $base + ['translations' => ['fr' => ['name' => 'Polo']]])->assertUnprocessable()->assertJsonValidationErrors(['translations'], 'error.details');
        $this->putJson($url, $base + ['translations' => ['bn' => ['slug' => 'polo']]])->assertUnprocessable()->assertJsonValidationErrors(['translations.bn'], 'error.details');
        $this->putJson($url, $base + ['translations' => ['bn' => ['seo_title' => str_repeat('ক', 71)]]])->assertUnprocessable()->assertJsonValidationErrors(['translations.bn.seo_title'], 'error.details');
        $this->putJson($url, $base + ['translations' => ['bn' => ['name' => ['x']]]])->assertUnprocessable()->assertJsonValidationErrors(['translations.bn.name'], 'error.details');
        $this->putJson($url, $base + ['translations' => 'bn'])->assertUnprocessable()->assertJsonValidationErrors(['translations'], 'error.details');

        // Category and brand editors return their translations; `null` clears them.
        $category = $this->getJson("/api/v1/online-catalog/categories/{$ids['clothes']}")->assertOk()->json('data.listing.translations');
        $this->assertEquals(['bn' => ['description_html' => '<p>সব <strong>পোশাক</strong></p>', 'name' => 'জামাকাপড়']], $category);
        $this->assertSame(['name' => 'পোলো ব্র্যান্ড'], $this->getJson("/api/v1/online-catalog/brands/{$ids['polo']}")->json('data.listing.translations.bn'));
        $this->listBrand($ids['polo'], ['translations' => null]);
        $this->assertSame([], $this->getJson("/api/v1/online-catalog/brands/{$ids['polo']}")->json('data.listing.translations.bn'));
    }

    public function test_public_catalog_reads_in_bangla_with_per_field_fallback(): void
    {
        $this->shop();
        $this->asVisitor();

        $en = $this->getJson('http://berry.test/api/v1/store/products')->assertOk()->assertHeader('Content-Language', 'en');
        $this->assertSame(['Cap', 'Polo Shirt'], collect($en->json('data'))->pluck('name')->sort()->values()->all());

        $bn = $this->getJson('http://berry.test/api/v1/store/products?lang=bn')->assertOk()->assertHeader('Content-Language', 'bn');
        $cards = collect($bn->json('data'))->keyBy('slug');
        $this->assertSame('পোলো শার্ট', $cards['polo-shirt']['name']);
        $this->assertSame('নরম সুতি।', $cards['polo-shirt']['short_description']);
        $this->assertSame(['name' => 'জামাকাপড়', 'slug' => 'clothes'], $cards['polo-shirt']['category']);
        $this->assertSame('পোলো ব্র্যান্ড', $cards['polo-shirt']['brand']['name']);
        // Untranslated fields and records read in English.
        $this->assertSame(['Cap', 'A sunny cap.'], [$cards['cap']['name'], $cards['cap']['short_description']]);
        $this->assertSame([['slug' => 'clothes', 'name' => 'জামাকাপড়', 'count' => 1]], $bn->json('facets.categories'));

        $page = $this->getJson('http://berry.test/api/v1/store/products/polo-shirt?lang=bn')->assertOk()->json('data');
        $this->assertSame(['পোলো শার্ট', 'নরম সুতি।', '<p>আরামদায়ক</p>'], [$page['name'], $page['short_description'], $page['description_html']]);
        // seo_title has no translation: the base SEO title (per field), not the Bangla name.
        $this->assertSame(['Polo shirt for kids', 'নরম সুতি।'], [$page['seo']['title'], $page['seo']['description']]);
        $this->assertSame(['হোম', 'জামাকাপড়', 'পোলো শার্ট'], array_column($page['breadcrumbs'], 'name'));
        $this->assertSame('Home', $this->getJson('http://berry.test/api/v1/store/products/polo-shirt')->json('data.breadcrumbs.0.name'));

        $category = $this->getJson('http://berry.test/api/v1/store/categories/clothes?lang=bn')->assertOk()->json('data');
        $this->assertSame(['জামাকাপড়', '<p>সব <strong>পোশাক</strong></p>', 'জামাকাপড়'], [$category['name'], $category['description_html'], $category['seo']['title']]);
        $this->assertSame('জামাকাপড়', $this->getJson('http://berry.test/api/v1/store/categories?lang=bn')->json('data.0.name'));
        $brand = $this->getJson('http://berry.test/api/v1/store/brands/polo?lang=bn')->assertOk()->json('data');
        $this->assertSame(['পোলো ব্র্যান্ড', 'Classic polo.'], [$brand['name'], $brand['description']]);

        // Unknown or missing languages read in the default (English).
        $this->getJson('http://berry.test/api/v1/store/products/polo-shirt?lang=fr')->assertOk()->assertHeader('Content-Language', 'en')->assertJsonPath('data.name', 'Polo Shirt');
    }

    public function test_search_matches_base_and_bangla_names_in_both_languages(): void
    {
        $this->shop();
        $this->asVisitor();
        $names = fn (string $query) => collect($this->getJson('http://berry.test/api/v1/store/products?'.$query)->assertOk()->json('data'))->pluck('slug')->sort()->values()->all();

        $this->assertSame(['polo-shirt'], $names('q='.urlencode('শার্ট').'&lang=bn'));
        $this->assertSame(['polo-shirt'], $names('q='.urlencode('শার্ট')), 'Bangla names match in English too.');
        $this->assertSame(['polo-shirt'], $names('q=shirt&lang=bn'), 'Base names match in Bangla.');
        $this->assertSame(['cap', 'polo-shirt'], $names('q='.urlencode('ব্র্যান্ড').'&lang=bn'), 'Bangla brand names match.');

        $suggest = $this->getJson('http://berry.test/api/v1/store/search/suggest?lang=bn&q='.urlencode('জামা'))->assertOk()->json('data');
        $this->assertSame([['slug' => 'clothes', 'name' => 'জামাকাপড়', 'url' => '/category/clothes']], $suggest['categories']);
        $suggest = $this->getJson('http://berry.test/api/v1/store/search/suggest?lang=bn&q=polo')->assertOk()->json('data');
        $this->assertSame('পোলো শার্ট', collect($suggest['products'])->firstWhere('slug', 'polo-shirt')['name']);
        $this->assertSame('clothes', $this->getJson('http://berry.test/api/v1/store/search/suggest?q=clo&lang=bn')->json('data.categories.0.slug'));
    }

    public function test_cached_reads_and_etags_never_cross_languages(): void
    {
        $this->shop();
        $this->asVisitor();
        $name = fn (string $lang) => collect($this->getJson('http://berry.test/api/v1/store/products'.($lang === '' ? '' : '?lang='.$lang))->json('data'))->firstWhere('slug', 'polo-shirt')['name'];

        // Alternate languages over the cached candidate set: each read gets its own language.
        foreach ([1, 2] as $round) {
            $this->assertSame('পোলো শার্ট', $name('bn'));
            $this->assertSame('Polo Shirt', $name('en'));
            $this->assertSame('Polo Shirt', $name(''));
            $this->assertSame('পোলো শার্ট', $name('bn'));
        }
        foreach ([1, 2] as $round) {
            $this->assertSame('জামাকাপড়', $this->getJson('http://berry.test/api/v1/store/categories?lang=bn')->json('data.0.name'));
            $this->assertSame('Clothes', $this->getJson('http://berry.test/api/v1/store/categories?lang=en')->json('data.0.name'));
        }

        // Identical bodies in both languages still get different ETags; a 304 needs the same language.
        $en = $this->getJson('http://berry.test/api/v1/store/products?q=nothing')->assertOk();
        $bn = $this->getJson('http://berry.test/api/v1/store/products?q=nothing&lang=bn')->assertOk();
        $this->assertSame($en->json('data'), $bn->json('data'));
        $this->assertNotSame($en->headers->get('ETag'), $bn->headers->get('ETag'));
        $this->getJson('http://berry.test/api/v1/store/products?q=nothing&lang=bn', ['If-None-Match' => $bn->headers->get('ETag')])->assertStatus(304);
        $this->getJson('http://berry.test/api/v1/store/products?q=nothing', ['If-None-Match' => $bn->headers->get('ETag')])->assertOk();
    }

    public function test_bangla_off_reads_english_everywhere(): void
    {
        [$t] = $this->shop();
        $this->actingAsUser($t['admin']);
        $this->patchJson('/api/v1/storefront/settings', ['bangla_enabled' => false])->assertOk()->assertJsonPath('data.bangla_enabled', false);
        $this->asVisitor();

        $this->getJson('http://berry.test/api/v1/store/products/polo-shirt?lang=bn')->assertOk()
            ->assertHeader('Content-Language', 'en')->assertJsonPath('data.name', 'Polo Shirt');
        $this->getJson('http://berry.test/api/v1/store/categories?lang=bn')->assertJsonPath('data.0.name', 'Clothes');
    }

    public function test_translations_stay_inside_their_store(): void
    {
        $this->shop();
        $this->asVisitor();
        $other = $this->openStore('Other Shop', 'other.test');
        $shirt = $this->makeProduct($other['unit']->id, 'Polo Shirt', [['O-SHIRT', '300.00']]);
        $this->publish($shirt['id'], ['slug' => 'polo-shirt']);
        $this->asVisitor();

        $this->getJson('http://other.test/api/v1/store/products/polo-shirt?lang=bn')->assertOk()->assertJsonPath('data.name', 'Polo Shirt');
        $this->getJson('http://other.test/api/v1/store/products?lang=bn&q='.urlencode('শার্ট'))->assertOk()->assertJsonCount(0, 'data');
        $this->getJson('http://berry.test/api/v1/store/products/polo-shirt?lang=bn')->assertOk()->assertJsonPath('data.name', 'পোলো শার্ট');
    }
}
