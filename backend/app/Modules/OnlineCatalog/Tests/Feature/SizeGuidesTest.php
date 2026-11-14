<?php

namespace App\Modules\OnlineCatalog\Tests\Feature;

use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * P1a: size guides (staff CRUD, category assignment, product override) and the product page's
 * `size_guide` in English and Bangla.
 */
class SizeGuidesTest extends TestCase
{
    use BuildsOnlineCatalog, InteractsWithTenancy, RefreshDatabase;

    /**
     * @param  list<string>  $categoryIds
     * @return array<string, mixed>
     */
    private function guide(string $name, array $categoryIds = [], array $overrides = []): array
    {
        return $overrides + [
            'name' => $name,
            'title' => "{$name} chart",
            'intro' => 'Measure over light clothes.',
            'columns' => [['id' => 'size', 'label' => 'Size'], ['id' => 'chest', 'label' => 'Chest (cm)']],
            'rows' => [['id' => 'r1', 'cells' => ['size' => 'S', 'chest' => '56']], ['id' => 'r2', 'cells' => ['size' => 'M']]],
            'note' => 'Between sizes? Choose the larger one.',
            'image_media_id' => null,
            'category_ids' => $categoryIds,
        ];
    }

    public function test_guides_resolve_from_product_category_ancestors_and_translate(): void
    {
        $t = $this->openStore('Berry Kids', 'berry.test');
        $org = $t['organization'];
        $clothes = $this->category($org, 'Clothes');
        $girls = $this->category($org, 'Girls', $clothes);
        $dresses = $this->category($org, 'Dresses', $girls);
        $shoes = $this->category($org, 'Shoes');

        $kids = $this->postJson('/api/v1/online-catalog/size-guides', $this->guide('Kids clothing', [$clothes], [
            'translations' => ['bn' => ['title' => 'মাপের তালিকা', 'columns' => ['chest' => 'বুক (সেমি)', 'nope' => 'x'], 'cells' => ['r2' => ['size' => 'এম']], 'note' => ' ']],
        ]))->assertCreated()->json('data');
        $this->assertSame(['id' => 'r2', 'cells' => ['size' => 'M', 'chest' => '']], $kids['rows'][1], 'Missing cells become empty.');
        $this->assertSame([$clothes], $kids['category_ids']);
        $this->assertEquals(['title' => 'মাপের তালিকা', 'intro' => null, 'note' => null, 'columns' => ['chest' => 'বুক (সেমি)'], 'cells' => ['r2' => ['size' => 'এম']]], $kids['translations']['bn']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'online_catalog.size_guide.created', 'subject_id' => $kids['id']]);
        $shoeGuide = $this->postJson('/api/v1/online-catalog/size-guides', $this->guide('Shoe sizes', [$shoes]))->assertCreated()->json('data');

        $dress = $this->makeProduct($t['unit']->id, 'Party Dress', [['DRESS', '900.00']], ['category_id' => $dresses]);
        $editor = $this->publish($dress['id']);
        $this->assertNull($editor['listing']['size_guide_id']);
        $this->assertSame(['id' => $kids['id'], 'name' => 'Kids clothing'], $editor['listing']['inherited_size_guide']);

        $this->asVisitor();
        $page = $this->getJson('http://berry.test/api/v1/store/products/party-dress')->assertOk()->json('data.size_guide');
        $this->assertSame('Kids clothing chart', $page['title']);
        $this->assertSame([['id' => 'size', 'label' => 'Size'], ['id' => 'chest', 'label' => 'Chest (cm)']], $page['columns']);
        $this->assertSame(['size' => 'S', 'chest' => '56'], $page['rows'][0]['cells']);
        $bn = $this->getJson('http://berry.test/api/v1/store/products/party-dress?lang=bn')->assertOk()->json('data.size_guide');
        $this->assertSame(['মাপের তালিকা', 'Measure over light clothes.', 'Between sizes? Choose the larger one.'], [$bn['title'], $bn['intro'], $bn['note']]);
        $this->assertSame(['Size', 'বুক (সেমি)'], array_column($bn['columns'], 'label'));
        $this->assertSame(['size' => 'এম', 'chest' => ''], $bn['rows'][1]['cells']);

        // A guide on a nearer category wins; the product's own guide beats both.
        $this->actingAsUser($t['admin']);
        $girlsGuide = $this->postJson('/api/v1/online-catalog/size-guides', $this->guide('Girls', [$girls]))->assertCreated()->json('data');
        $this->assertSame('Girls chart', $this->getJson('http://berry.test/api/v1/store/products/party-dress')->json('data.size_guide.title'));
        $editor = $this->publish($dress['id'], ['size_guide_id' => $shoeGuide['id']]);
        $this->assertSame($shoeGuide['id'], $editor['listing']['size_guide_id']);
        $this->assertSame('Shoe sizes chart', $this->getJson('http://berry.test/api/v1/store/products/party-dress')->json('data.size_guide.title'));

        $list = $this->getJson('/api/v1/online-catalog/size-guides')->assertOk()->json('data');
        $this->assertSame(['Girls', 'Kids clothing', 'Shoe sizes'], array_column($list, 'name'));
        $this->assertSame([0, 0, 1], array_column($list, 'products_count'));

        // Deleting the product's guide falls back to the category's.
        $this->deleteJson("/api/v1/online-catalog/size-guides/{$shoeGuide['id']}")->assertNoContent();
        $this->assertSame('Girls chart', $this->getJson('http://berry.test/api/v1/store/products/party-dress')->json('data.size_guide.title'));
        $this->deleteJson("/api/v1/online-catalog/size-guides/{$girlsGuide['id']}")->assertNoContent();
        $this->deleteJson("/api/v1/online-catalog/size-guides/{$kids['id']}")->assertNoContent();
        $this->assertNull($this->getJson('http://berry.test/api/v1/store/products/party-dress')->json('data.size_guide'));
    }

    public function test_validation_permissions_and_isolation(): void
    {
        $t = $this->openStore('Berry Kids', 'berry.test');
        $clothes = $this->category($t['organization'], 'Clothes');
        $guide = $this->postJson('/api/v1/online-catalog/size-guides', $this->guide('Kids', [$clothes]))->assertCreated()->json('data');
        $url = '/api/v1/online-catalog/size-guides';

        $this->postJson($url, $this->guide('Other', [$clothes]))->assertUnprocessable()->assertJsonValidationErrors(['category_ids.0'], 'error.details');
        $this->postJson($url, $this->guide('Bad', [], ['rows' => [['id' => 'r1', 'cells' => ['waist' => '50']]]]))->assertUnprocessable()->assertJsonValidationErrors(['rows.0.cells.waist'], 'error.details');
        $this->postJson($url, $this->guide('Bad', [], ['columns' => [['id' => 'a', 'label' => 'A'], ['id' => 'a', 'label' => 'B']]]))->assertUnprocessable()->assertJsonValidationErrors(['columns.1.id'], 'error.details');
        $columns = array_map(fn (int $i) => ['id' => "c{$i}", 'label' => "C{$i}"], range(1, 13));
        $this->postJson($url, $this->guide('Wide', [], ['columns' => $columns, 'rows' => []]))->assertUnprocessable()->assertJsonValidationErrors(['columns'], 'error.details');
        $this->postJson($url, $this->guide('Odd id', [], ['columns' => [['id' => 'a b', 'label' => 'A']], 'rows' => []]))->assertUnprocessable()->assertJsonValidationErrors(['columns.0.id'], 'error.details');
        $this->postJson($url, $this->guide('Pic', [], ['image_media_id' => '00000000-0000-7000-8000-000000000000']))->assertUnprocessable()->assertJsonValidationErrors(['image_media_id'], 'error.details');
        $product = $this->makeProduct($t['unit']->id, 'Dress', [['D1', '10.00']]);
        $this->putJson("/api/v1/online-catalog/products/{$product['id']}", ['is_published' => false, 'is_featured' => false, 'size_guide_id' => '00000000-0000-7000-8000-000000000000'])
            ->assertUnprocessable()->assertJsonValidationErrors(['size_guide_id'], 'error.details');

        // Updating keeps the guide's own categories; reassigning frees the old one.
        $this->putJson("{$url}/{$guide['id']}", $this->guide('Kids', [$clothes], ['title' => 'Kids sizes']))->assertOk()->assertJsonPath('data.title', 'Kids sizes');

        // Staff without online_catalog.manage read only (cashiers not at all).
        $manager = $this->createUserWithRole($t['organization'], SystemRole::InventoryManager, [$t['branch']->id]);
        $this->actingAsUser($manager)->getJson($url)->assertForbidden();
        $this->actingAsUser($manager)->postJson($url, $this->guide('X'))->assertForbidden();

        // Another organization neither sees nor uses this organization's guides and categories.
        $other = $this->openStore('Other Shop', 'other.test');
        $this->actingAsUser($other['admin']);
        $this->assertSame([], $this->getJson($url)->assertOk()->json('data'));
        $this->getJson("{$url}/{$guide['id']}")->assertNotFound();
        $this->putJson("{$url}/{$guide['id']}", $this->guide('Mine'))->assertNotFound();
        $this->deleteJson("{$url}/{$guide['id']}")->assertNotFound();
        $this->postJson($url, $this->guide('Mine', [$clothes]))->assertUnprocessable()->assertJsonValidationErrors(['category_ids.0'], 'error.details');
        $otherProduct = $this->makeProduct($other['unit']->id, 'Cap', [['CAP', '10.00']]);
        $this->putJson("/api/v1/online-catalog/products/{$otherProduct['id']}", ['is_published' => false, 'is_featured' => false, 'size_guide_id' => $guide['id']])
            ->assertUnprocessable()->assertJsonValidationErrors(['size_guide_id'], 'error.details');
    }
}
