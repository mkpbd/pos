<?php

namespace App\Modules\Storefront\Tests\Feature;

use App\Modules\OnlineCatalog\Application\Contracts\ProductPageZones;
use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * P1b: the product page's builder zones — `product.below_price`, `product.after` and
 * `product.bottom`, each with versions for a category or one product (the most specific
 * published one wins: product → nearest category → all products), their limits and target
 * checks, the documents list and canvas data, draft previews and tenant isolation; and the
 * theme's product page layout.
 */
class ProductZonesTest extends TestCase
{
    use BuildsOnlineCatalog, InteractsWithTenancy, RefreshDatabase;

    private const DOCS = '/api/v1/storefront/builder/documents';

    private const STORE = 'http://berry.test/api/v1/store';

    /** @var array<string, mixed> */
    private array $t;

    /** @var array<string, string> */
    private array $ids = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->t = $this->openStore('Berry Kids', 'berry.test');
        $org = $this->t['organization'];
        $apparel = $this->category($org, 'Apparel');
        $shirts = $this->category($org, 'Shirts', $apparel);
        $unit = $this->t['unit']->id;
        $oxford = $this->makeProduct($unit, 'Oxford Shirt', [['OXF', '900.00']], ['category_id' => $shirts, 'track_stock' => false]);
        $tee = $this->makeProduct($unit, 'Plain Tee', [['TEE', '300.00']], ['category_id' => $apparel, 'track_stock' => false]);
        $mug = $this->makeProduct($unit, 'Mug', [['MUG', '250.00']], ['track_stock' => false]);
        foreach ([$oxford, $tee, $mug] as $product) {
            $this->publish($product['id']);
        }
        $this->ids = ['apparel' => $apparel, 'shirts' => $shirts, 'oxford' => $oxford['id'], 'tee' => $tee['id'], 'mug' => $mug['id']];
    }

    private function create(string $key, string $title = 'Zone'): TestResponse
    {
        return $this->postJson(self::DOCS, ['kind' => 'zone', 'key' => $key, 'title' => $title, 'from' => 'blank']);
    }

    /**
     * A zone document with one heading, published.
     */
    private function publishedZone(string $key, string $heading): string
    {
        $id = $this->create($key, $heading)->assertCreated()->json('data.id');
        $this->saveHeading($id, $heading);
        $this->postJson(self::DOCS."/{$id}/publish")->assertOk();

        return $id;
    }

    private function saveHeading(string $id, string $heading): void
    {
        $revision = $this->getJson(self::DOCS."/{$id}")->assertOk()->json('data.draft_revision');
        $this->putJson(self::DOCS."/{$id}/draft", ['revision' => $revision, 'content' => ['schema_version' => 1, 'sections' => [[
            'id' => 's_main', 'type' => 'section',
            'columns' => [['id' => 'c_main', 'width' => ['base' => 100], 'elements' => [
                ['id' => 'e_head', 'type' => 'heading', 'props' => ['text' => $heading, 'level' => 2]],
            ]]],
        ]]]])->assertOk();
    }

    /**
     * The heading of each zone of a product page (null = no zone).
     *
     * @return array<string, ?string>
     */
    private function zoneHeadings(string $slug, string $query = ''): array
    {
        $zones = $this->getJson(self::STORE."/products/{$slug}".($query === '' ? '' : '?'.$query))->assertOk()->json('data.zones');

        return array_map(fn (?array $page) => $page === null ? null : $page['sections'][0]['columns'][0]['elements'][0]['props']['text'], $zones);
    }

    public function test_the_most_specific_published_version_of_each_zone_wins(): void
    {
        $this->assertSame(['product.below_price', 'product.after', 'product.bottom'], BuilderDocument::PRODUCT_ZONES);
        $this->assertSame(ProductPageZones::ZONES, BuilderDocument::PRODUCT_ZONES);

        $this->publishedZone('zone:product.after', 'After · everyone');
        $this->publishedZone("zone:product.after@category:{$this->ids['apparel']}", 'After · apparel');
        $this->publishedZone("zone:product.after@product:{$this->ids['oxford']}", 'After · oxford');
        $this->publishedZone("zone:product.below_price@category:{$this->ids['shirts']}", 'Price · shirts');
        $this->publishedZone('zone:product.bottom', 'Bottom · everyone');
        // A version that was never published does not show.
        $draft = $this->create("zone:product.bottom@product:{$this->ids['tee']}", 'Bottom · tee (draft)')->assertCreated()->json('data.id');
        $this->saveHeading($draft, 'Bottom · tee (draft)');
        $this->app['auth']->forgetGuards();

        $this->assertSame(['product.below_price' => 'Price · shirts', 'product.after' => 'After · oxford', 'product.bottom' => 'Bottom · everyone'], $this->zoneHeadings('oxford-shirt'));
        $this->assertSame(['product.below_price' => null, 'product.after' => 'After · apparel', 'product.bottom' => 'Bottom · everyone'], $this->zoneHeadings('plain-tee'));
        $this->assertSame(['product.below_price' => null, 'product.after' => 'After · everyone', 'product.bottom' => 'Bottom · everyone'], $this->zoneHeadings('mug'));
        $page = $this->getJson(self::STORE.'/products/oxford-shirt')->json('data.zones')['product.after'];
        $this->assertSame("zone:product.after@product:{$this->ids['oxford']}", $page['document']['key']);

        // The bootstrap keeps its zones as before (the product page has its own).
        $bootstrapZones = $this->getJson(self::STORE.'/bootstrap')->assertOk()->json('data.builder.zones');
        $this->assertSame(['listing.top', 'listing.bottom', 'product.after'], array_keys($bootstrapZones));
        $this->assertSame('After · everyone', $bootstrapZones['product.after']['sections'][0]['columns'][0]['elements'][0]['props']['text']);

        // Staff draft preview: every version that exists counts, with its draft.
        $this->actingAsUser($this->t['admin']);
        $this->assertSame('Bottom · tee (draft)', $this->zoneHeadings('plain-tee', 'preview=draft')['product.bottom']);
        $this->getJson(self::STORE.'/products/plain-tee?preview=draft')->assertHeader('Cache-Control', 'no-store, private');
        // Deleting the product's version: back to the category's.
        $oxfordVersion = collect($this->getJson(self::DOCS)->json('data'))->firstWhere('key', "zone:product.after@product:{$this->ids['oxford']}")['id'];
        $this->deleteJson(self::DOCS."/{$oxfordVersion}")->assertNoContent();
        $this->app['auth']->forgetGuards();
        $this->assertSame('After · apparel', $this->zoneHeadings('oxford-shirt')['product.after']);
        $this->assertSame('Bottom · everyone', $this->zoneHeadings('plain-tee', 'preview=draft')['product.bottom'], 'Visitors never see drafts.');
    }

    public function test_versions_need_a_category_or_product_of_the_store_and_are_limited(): void
    {
        $this->create("zone:product.after@category:{$this->ids['apparel']}")->assertCreated()->assertJsonPath('data.zone', 'product.after');
        $this->create("zone:product.after@category:{$this->ids['apparel']}")->assertStatus(409)->assertJsonPath('error.code', 'DOCUMENT_EXISTS');
        // Upper-case ids are stored lower-case (and so are the same version).
        $this->create('zone:product.after@category:'.strtoupper($this->ids['apparel']))->assertStatus(409);
        $this->create('zone:product.after@category:'.Str::uuid())->assertUnprocessable()->assertJsonPath('error.code', 'ZONE_TARGET_NOT_FOUND')
            ->assertJsonPath('error.details.target_type', 'category');
        $this->create("zone:product.after@product:{$this->ids['apparel']}")->assertUnprocessable()->assertJsonPath('error.code', 'ZONE_TARGET_NOT_FOUND');
        // Listing zones have no versions; unknown zones and targets are not keys.
        foreach (["zone:listing.top@category:{$this->ids['apparel']}", "zone:product.after@brand:{$this->ids['apparel']}", 'zone:product.middle', "zone:product.after_tabs@category:{$this->ids['apparel']}", 'zone:product.after@category:'] as $key) {
            $this->create($key)->assertUnprocessable()->assertJsonValidationErrors(['key'], 'error.details');
        }
        foreach (['zone:product.below_price', 'zone:product.bottom'] as $key) {
            $this->create($key)->assertCreated();
        }

        // Another store's category or product is not a target.
        $other = $this->openStore('Other Shop', 'other.test');
        $foreignCategory = $this->category($other['organization'], 'Foreign');
        $foreign = $this->makeProduct($other['unit']->id, 'Foreign Tea', [['FT', '10.00']]);
        $this->actingAsUser($this->t['admin']);
        $this->create("zone:product.after@category:{$foreignCategory}")->assertUnprocessable()->assertJsonPath('error.code', 'ZONE_TARGET_NOT_FOUND');
        $this->create("zone:product.bottom@product:{$foreign['id']}")->assertUnprocessable()->assertJsonPath('error.code', 'ZONE_TARGET_NOT_FOUND');

        // At most 100 versions per organization.
        $this->inTenant($this->t['organization'], function () {
            foreach (range(1, BuilderDocument::MAX_TARGETED_ZONES - 1) as $i) {
                BuilderDocument::query()->create([
                    'kind' => BuilderDocument::KIND_ZONE,
                    'key' => 'zone:product.bottom@product:'.Str::uuid(),
                    'title' => "Version {$i}",
                ]);
            }
        });
        $this->create("zone:product.bottom@product:{$this->ids['mug']}")->assertUnprocessable()
            ->assertJsonPath('error.code', 'ZONE_VERSION_LIMIT')->assertJsonPath('error.details.limit', 100);
        // The other store has its own allowance.
        $this->actingAsUser($other['admin']);
        $this->postJson(self::DOCS, ['kind' => 'zone', 'key' => "zone:product.bottom@product:{$foreign['id']}", 'title' => 'Theirs'])->assertCreated();
    }

    public function test_the_documents_name_their_target_and_preview_on_a_matching_product(): void
    {
        $empty = $this->category($this->t['organization'], 'Empty');
        $all = $this->create('zone:product.after')->json('data.id');
        $category = $this->create("zone:product.below_price@category:{$this->ids['apparel']}")->assertCreated();
        $this->assertSame(['type' => 'category', 'id' => $this->ids['apparel'], 'name' => 'Apparel'], $category->json('data.target'));
        $product = $this->create("zone:product.bottom@product:{$this->ids['tee']}")->json('data.id');
        $nothing = $this->create("zone:product.bottom@category:{$empty}")->json('data.id');
        $this->create('zone:listing.top')->assertCreated();

        $list = array_column($this->getJson(self::DOCS)->assertOk()->json('data'), null, 'key');
        $this->assertSame([null, null], [$list['zone:product.after']['target'], $list['zone:listing.top']['target']]);
        $this->assertSame(['listing.top', 'product.after'], [$list['zone:listing.top']['zone'], $list['zone:product.after']['zone']]);
        $this->assertSame(['type' => 'product', 'id' => $this->ids['tee'], 'name' => 'Plain Tee'], $list["zone:product.bottom@product:{$this->ids['tee']}"]['target']);
        $this->assertSame('http://berry.test/product/plain-tee?preview=draft', $list["zone:product.bottom@product:{$this->ids['tee']}"]['preview_url']);
        // A category version previews on a product of the category or below it.
        $this->assertContains($list["zone:product.below_price@category:{$this->ids['apparel']}"]['preview_url'], [
            'http://berry.test/product/plain-tee?preview=draft', 'http://berry.test/product/oxford-shirt?preview=draft',
        ]);
        $this->assertNull($list["zone:product.bottom@category:{$empty}"]['preview_url'], 'Nothing on sale in that category.');
        $this->assertNotNull($list['zone:product.after']['preview_url']);

        // The canvas data: the matching product, on the document itself only.
        $this->assertSame(
            ['id' => $this->ids['tee'], 'slug' => 'plain-tee', 'name' => 'Plain Tee', 'price' => '300.00', 'image_url' => null],
            $this->getJson(self::DOCS."/{$product}")->assertOk()->json('data.preview_product'),
        );
        $this->assertNull($this->getJson(self::DOCS."/{$nothing}")->json('data.preview_product'));
        $this->assertNotNull($this->getJson(self::DOCS."/{$all}")->json('data.preview_product'));
        $this->assertArrayNotHasKey('preview_product', $list['zone:product.after']);

        // A version whose product is archived keeps its target with no name.
        $this->deleteJson("/api/v1/products/{$this->ids['tee']}")->assertSuccessful();
        $gone = collect($this->getJson(self::DOCS)->json('data'))->firstWhere('key', "zone:product.bottom@product:{$this->ids['tee']}");
        $this->assertSame(['type' => 'product', 'id' => $this->ids['tee'], 'name' => null], $gone['target']);
        $this->assertNull($gone['preview_url']);
    }

    public function test_zones_stay_inside_their_store(): void
    {
        $this->publishedZone('zone:product.after', 'Berry after');
        $this->publishedZone("zone:product.bottom@category:{$this->ids['apparel']}", 'Berry apparel');

        $other = $this->openStore('Other Shop', 'other.test');
        $tea = $this->makeProduct($other['unit']->id, 'Tea', [['TEA', '50.00']], ['track_stock' => false]);
        $this->publish($tea['id']);
        $this->app['auth']->forgetGuards();

        $this->assertSame(['product.below_price' => null, 'product.after' => null, 'product.bottom' => null], $this->getJson('http://other.test/api/v1/store/products/tea')->assertOk()->json('data.zones'));

        // Another store's staff cannot see or change Berry's versions.
        $berryVersion = $this->inTenant($this->t['organization'], fn () => BuilderDocument::query()->where('key', 'like', 'zone:product.bottom@%')->value('id'));
        $this->actingAsUser($other['admin']);
        $this->getJson(self::DOCS."/{$berryVersion}")->assertNotFound();
        $this->deleteJson(self::DOCS."/{$berryVersion}")->assertNotFound();
        $this->assertSame([], collect($this->getJson(self::DOCS)->json('data'))->pluck('key')->filter(fn ($k) => str_starts_with($k, 'zone:'))->values()->all());

        // Staff of the store without storefront.manage cannot add versions.
        $viewer = $this->createUserWithRole($this->t['organization'], SystemRole::Cashier);
        $this->actingAsUser($viewer);
        $this->create("zone:product.after@product:{$this->ids['mug']}")->assertForbidden();
    }

    public function test_the_theme_carries_the_product_page_layout(): void
    {
        $this->assertSame(['gallery' => 'left', 'thumbnails' => 'bottom', 'sticky_summary' => false, 'details' => 'tabs'], $this->getJson('/api/v1/storefront/theme/draft')->assertOk()->json('data.settings.layout.product'));
        $this->getJson(self::STORE.'/bootstrap')->assertOk()->assertJsonPath('data.theme.layout.product.details', 'tabs');

        $draft = $this->getJson('/api/v1/storefront/theme/draft')->assertOk()->json('data');
        $save = function (array $product, int $revision) use ($draft) {
            $settings = $draft['settings'];
            $settings['layout']['product'] = $product;

            return $this->putJson('/api/v1/storefront/theme/draft', ['revision' => $revision, 'settings' => $settings]);
        };
        foreach ([['gallery' => 'top'], ['thumbnails' => 'left'], ['details' => 'tabs-and-more'], ['sticky_summary' => 'often']] as $bad) {
            $save($bad, $draft['draft_revision'])->assertUnprocessable()->assertJsonValidationErrors(['settings.layout.product.'.array_key_first($bad)], 'error.details');
        }
        $saved = $save(['gallery' => 'right', 'thumbnails' => 'side', 'sticky_summary' => true, 'details' => 'accordion'], $draft['draft_revision'])->assertOk()->json('data');
        $this->assertSame(['gallery' => 'right', 'thumbnails' => 'side', 'sticky_summary' => true, 'details' => 'accordion'], $saved['settings']['layout']['product']);

        // A preset keeps the owner's product page layout.
        $this->postJson('/api/v1/storefront/theme/presets/classic/apply')->assertOk()
            ->assertJsonPath('data.settings.preset', 'classic')
            ->assertJsonPath('data.settings.layout.product.details', 'accordion');
        $this->postJson('/api/v1/storefront/theme/publish')->assertOk();
        $this->app['auth']->forgetGuards();
        $this->getJson(self::STORE.'/bootstrap')->assertOk()->assertJsonPath('data.theme.layout.product', ['gallery' => 'right', 'thumbnails' => 'side', 'sticky_summary' => true, 'details' => 'accordion']);

        // The legacy theme save accepts the layout too.
        $this->actingAsUser($this->t['admin']);
        $this->putJson('/api/v1/storefront/theme', ['layout' => ['product' => ['details' => 'stacked']]])->assertOk()
            ->assertJsonPath('data.settings.layout.product', ['gallery' => 'left', 'thumbnails' => 'bottom', 'sticky_summary' => false, 'details' => 'stacked']);
    }
}
