<?php

namespace App\Modules\Storefront\Tests\Feature;

use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Storefront\Domain\Builder\ElementRegistry;
use App\Modules\Storefront\Tests\Concerns\PublishesTheme;
use App\Modules\Users\Infrastructure\Models\Role;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * B14: store page templates (`template:<page>` documents: starters, the main part exactly once,
 * allowed elements, page fields, bootstrap flags, the public template payload, "Use the standard
 * page"), the product listing element (scopes, its data, the listing API's `categories`) and the
 * editor's sample page context (catalogue, blog) — all organization-scoped.
 */
class StoreBuilderB14Test extends TestCase
{
    use BuildsOnlineCatalog, InteractsWithTenancy, PublishesTheme, RefreshDatabase;

    private const DOCS = '/api/v1/storefront/builder/documents';

    private const SAMPLE = '/api/v1/storefront/builder/sample-context';

    /** @var array<string, mixed> */
    private array $t;

    /** @var array<string, string> */
    private array $ids = [];

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('public');
        Storage::fake((string) config('media.disk'));
        $this->t = $this->openStore('Berry Kids', 'berry.test');
    }

    private function catalog(): void
    {
        $org = $this->t['organization'];
        $this->ids['tea'] = $this->category($org, 'Tea');
        $this->ids['snacks'] = $this->category($org, 'Snacks');
        $this->ids['hidden'] = $this->category($org, 'Hidden');
        $this->listCategory($this->ids['tea'], ['description_html' => '<p>Fresh <strong>leaf</strong> tea.</p>']);
        $this->listCategory($this->ids['snacks']);
        $this->ids['pran'] = $this->brand($org, 'Pran');
        $this->listBrand($this->ids['pran'], ['description' => 'Local favourites']);
        foreach ([['Green Tea', 'tea', '120.00'], ['Black Tea', 'tea', '90.00'], ['Chanachur', 'snacks', '40.00']] as $i => [$name, $category, $price]) {
            $product = $this->makeProduct($this->t['unit']->id, $name, [['SKU'.$i, $price]], ['category_id' => $this->ids[$category], 'brand_id' => $i === 2 ? $this->ids['pran'] : null]);
            $this->publish($product['id']);
        }
    }

    /**
     * @param  list<array<string, mixed>>  $elements
     * @return array<string, mixed>
     */
    private static function page(array $elements): array
    {
        return ['schema_version' => 1, 'sections' => [[
            'id' => 's_main', 'type' => 'section',
            'columns' => [['id' => 'c_main', 'width' => ['base' => 100], 'elements' => $elements]],
        ]]];
    }

    private function create(string $key, string $from = 'blank'): string
    {
        return $this->postJson(self::DOCS, ['kind' => 'page', 'key' => $key, 'title' => $key, 'from' => $from])->assertCreated()->json('data.id');
    }

    /**
     * @param  array<string, mixed>  $content
     */
    private function save(string $id, array $content): TestResponse
    {
        $revision = $this->getJson(self::DOCS."/{$id}")->assertOk()->json('data.draft_revision');

        return $this->putJson(self::DOCS."/{$id}/draft", ['revision' => $revision, 'content' => $content]);
    }

    /**
     * @return list<string>
     */
    private static function codes(TestResponse $response): array
    {
        return array_column($response->json('error.details.errors') ?? [], 'code');
    }

    private function staff(array $permissions): User
    {
        $organization = $this->t['organization'];

        return $this->createUserWithRole($organization, $this->inTenant($organization, function () use ($permissions) {
            $role = Role::query()->create(['name' => 'Editor '.Str::random(4)]);
            $role->permissions()->sync($permissions);

            return $role;
        }));
    }

    public function test_every_store_page_starts_from_its_starter_and_publishes_with_its_main_part(): void
    {
        foreach (ElementRegistry::TEMPLATES as $template) {
            $id = $this->create("template:{$template}", 'starter');
            $document = $this->getJson(self::DOCS."/{$id}")->assertOk()->json('data');
            $this->assertSame($template, $document['template']);
            $this->assertNull($document['path']);
            $types = [];
            array_walk_recursive($document['content'], function ($value, $key) use (&$types) {
                if ($key === 'type') {
                    $types[] = $value;
                }
            });
            $this->assertContains(ElementRegistry::TEMPLATE_CORE[$template], $types, $template);
            $this->postJson(self::DOCS."/{$id}/publish")->assertOk()->assertJsonPath('data.published.number', 1);
        }

        $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'template:shop', 'title' => 'Twice'])->assertStatus(409)
            ->assertJsonPath('error.code', 'DOCUMENT_EXISTS')->assertJsonPath('error.message', 'This store page already has a design.');
        $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'landing:sale', 'title' => 'Sale', 'from' => 'starter'])->assertUnprocessable()->assertJsonValidationErrors('from', 'error.details');
        $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'template:checkout', 'title' => 'Checkout'])->assertUnprocessable()->assertJsonValidationErrors('key', 'error.details');
        $this->postJson(self::DOCS, ['kind' => 'zone', 'key' => 'template:shop', 'title' => 'Zone'])->assertUnprocessable();

        $list = array_column($this->getJson(self::DOCS)->assertOk()->json('data'), null, 'key');
        $this->assertSame('shop', $list['template:shop']['template']);
        $this->assertSame('http://berry.test/shop?preview=draft', $list['template:shop']['preview_url']);
        $this->assertNull($list['template:order']['preview_url']);
        $this->assertNull($list['home']['template'] ?? null);
    }

    public function test_the_main_part_is_held_once_in_its_own_template_and_needed_to_publish(): void
    {
        $shop = $this->create('template:shop');
        $listing = ['id' => 'e_list', 'type' => 'product_listing', 'props' => ['scope' => 'current']];

        // Twice → refused on save, with the second one named.
        $twice = $this->save($shop, self::page([$listing, ['id' => 'e_list2', 'type' => 'product_listing', 'props' => ['scope' => 'current']]]))->assertUnprocessable();
        $this->assertSame(['TEMPLATE_CORE_DUPLICATE'], self::codes($twice));
        $this->assertSame('e_list2', $twice->json('error.details.errors.0.node_id'));

        // Other templates' main parts, a listing of other products and another page's fields.
        $wrong = $this->save($shop, self::page([
            ['id' => 'e_post', 'type' => 'blog_post_body'],
            ['id' => 'e_order', 'type' => 'order_summary'],
            ['id' => 'e_all', 'type' => 'product_listing', 'props' => ['scope' => 'all']],
            ['id' => 'e_text', 'type' => 'dynamic_text', 'props' => ['field' => 'category.name']],
        ]))->assertUnprocessable();
        $this->assertSame(['ELEMENT_NOT_ALLOWED', 'ELEMENT_NOT_ALLOWED', null, 'FIELD_NOT_AVAILABLE'], array_map(fn (array $e) => $e['code'] ?? null, $wrong->json('error.details.errors')));
        $this->assertStringContainsString('cannot be used in this store page', $wrong->json('error.details.errors.0.message'));
        $this->assertSame('sections.0.columns.0.elements.2.props.scope', $wrong->json('error.details.errors.2.path'));
        // No search & sharing settings on templates.
        $this->save($shop, ['seo' => ['title' => 'Mine']] + self::page([$listing]))->assertUnprocessable();

        // Without the main part: saved, flagged by the page check, refused on publish.
        $this->save($shop, self::page([['id' => 'e_title', 'type' => 'heading', 'props' => ['text' => 'Shop', 'level' => 1]]]))->assertOk();
        $check = $this->postJson(self::DOCS."/{$shop}/check")->assertOk()->json('data');
        $this->assertSame('TEMPLATE_CORE_MISSING', $check['issues'][0]['code']);
        $this->assertSame(['error', null, 'product_listing'], [$check['issues'][0]['severity'], $check['issues'][0]['node_id'], $check['issues'][0]['details']['element']]);
        $this->postJson(self::DOCS."/{$shop}/publish")->assertUnprocessable()->assertJsonPath('error.code', 'TEMPLATE_CORE_MISSING')
            ->assertJsonPath('error.details.element', 'product_listing');

        // A hidden main part (itself, or its section) can't be published either.
        $this->save($shop, self::page([$listing + ['hidden' => true]]))->assertOk();
        $issue = $this->postJson(self::DOCS."/{$shop}/check")->assertOk()->json('data.issues.0');
        $this->assertSame(['TEMPLATE_CORE_MISSING', 'e_list', 'error'], [$issue['code'], $issue['node_id'], $issue['severity']]);
        $this->postJson(self::DOCS."/{$shop}/publish")->assertUnprocessable()->assertJsonPath('error.code', 'TEMPLATE_CORE_MISSING')
            ->assertJsonPath('error.message', 'This store page\'s main part is hidden. Show it before publishing.')->assertJsonPath('error.details.node_id', 'e_list');
        $hiddenSection = self::page([$listing]);
        $hiddenSection['sections'][0]['hidden'] = true;
        $this->save($shop, $hiddenSection)->assertOk();
        $this->postJson(self::DOCS."/{$shop}/publish")->assertUnprocessable()->assertJsonPath('error.code', 'TEMPLATE_CORE_MISSING');
        // Scheduled for later: refused as well when the snapshot goes live.
        $this->postJson(self::DOCS."/{$shop}/schedule", ['publish_at' => now()->addHour()->toIso8601String()])->assertSuccessful();
        $this->travel(2)->hours();
        $this->artisan('storefront:publish-scheduled')->assertSuccessful();
        $this->assertNull($this->getJson(self::DOCS."/{$shop}")->json('data.published'));
        $this->travelBack();
        // Shown only to some visitors: a warning, and it publishes (the owner decides).
        $this->save($shop, self::page([$listing + ['audience' => ['rules' => [['kind' => 'language', 'in' => ['bn']]]]]]))->assertOk();
        $this->assertSame('TEMPLATE_CORE_CONDITIONAL', $this->postJson(self::DOCS."/{$shop}/check")->json('data.issues.0.code'));
        $this->postJson(self::DOCS."/{$shop}/publish")->assertOk();

        // The order page: page fields, store fields, globals and sticky sections work.
        $order = $this->create('template:order');
        $saved = $this->save($order, self::page([
            ['id' => 'e_hi', 'type' => 'dynamic_text', 'props' => ['field' => 'order.customer_first_name', 'tag' => 'h1', 'prefix' => 'Thanks,', 'fallback' => 'Thanks!', 'format' => 'default'],
                'translations' => ['bn' => ['prefix' => 'ধন্যবাদ,']]],
            ['id' => 'e_phone', 'type' => 'dynamic_text', 'props' => ['field' => 'store.phone']],
            ['id' => 'e_order', 'type' => 'order_summary', 'props' => ['show_items' => false]],
        ]))->assertOk()->json('data.content.sections.0.columns.0.elements');
        $this->assertSame(['field' => 'order.customer_first_name', 'tag' => 'h1', 'prefix' => 'Thanks,', 'suffix' => '', 'fallback' => 'Thanks!', 'format' => 'default'], $saved[0]['props']);
        $this->assertSame(['bn' => ['prefix' => 'ধন্যবাদ,']], $saved[0]['translations']);
        $this->assertSame(['show_timeline' => true, 'show_items' => false, 'show_address' => true, 'show_delivery' => true], $saved[2]['props']);
        $this->postJson(self::DOCS."/{$order}/publish")->assertOk();
    }

    public function test_published_templates_are_announced_served_and_switched_back_to_the_standard_page(): void
    {
        $shop = $this->create('template:shop', 'starter');
        $notFound = $this->create('template:not_found', 'starter');
        $this->postJson(self::DOCS."/{$shop}/publish")->assertOk();

        $this->asVisitor();
        $flags = $this->getJson('http://berry.test/api/v1/store/bootstrap')->assertOk()->json('data.builder.templates');
        $this->assertSame(['shop' => true, 'category' => false, 'brand' => false, 'search' => false, 'blog_post' => false, 'order' => false, 'not_found' => false], $flags);
        $payload = $this->getJson('http://berry.test/api/v1/store/builder/templates/shop')->assertOk()->json('data');
        $this->assertSame('template:shop', $payload['document']['key']);
        $this->assertSame('product_listing', $payload['sections'][1]['columns'][0]['elements'][0]['type']);
        $this->getJson('http://berry.test/api/v1/store/builder/templates/not_found')->assertNotFound()->assertJsonPath('error.code', 'PAGE_NOT_FOUND');
        $this->getJson('http://berry.test/api/v1/store/builder/templates/checkout')->assertNotFound();
        // The draft preview needs staff.
        $this->getJson('http://berry.test/api/v1/store/builder/templates/not_found?preview=draft')->assertNotFound();

        $this->actingAsUser($this->t['admin']);
        $this->getJson('http://berry.test/api/v1/store/builder/templates/not_found?preview=draft')->assertOk()
            ->assertHeader('Cache-Control', 'no-store, private')->assertJsonPath('data.document.key', 'template:not_found');
        $this->postJson(self::DOCS."/{$notFound}/unpublish")->assertStatus(409)->assertJsonPath('error.code', 'NOTHING_PUBLISHED');
        $home = $this->create('landing:sale');
        $this->postJson(self::DOCS."/{$home}/unpublish")->assertUnprocessable()->assertJsonPath('error.code', 'NOT_A_TEMPLATE');

        // Only publishers may switch back.
        $this->actingAsUser($this->staff(['storefront.view', 'storefront.manage']));
        $this->postJson(self::DOCS."/{$shop}/unpublish")->assertForbidden();

        $this->actingAsUser($this->t['admin']);
        $this->postJson(self::DOCS."/{$shop}/schedule", ['publish_at' => now()->addDay()->toIso8601String()])->assertSuccessful();
        $document = $this->postJson(self::DOCS."/{$shop}/unpublish")->assertOk()->json('data');
        $this->assertNull($document['published']);
        $this->assertNull($document['schedule']);
        $this->assertNotEmpty($document['content']['sections']);
        $this->assertSame(1, DB::table('audit_logs')->where('action', 'storefront.builder_unpublished')->count());
        $this->assertCount(1, $this->getJson(self::DOCS."/{$shop}/versions")->assertOk()->json('data'));

        $this->asVisitor();
        $this->assertFalse($this->getJson('http://berry.test/api/v1/store/bootstrap')->json('data.builder.templates.shop'));
        $this->getJson('http://berry.test/api/v1/store/builder/templates/shop')->assertNotFound();
    }

    public function test_product_listings_resolve_their_scope_and_the_listing_api_takes_several_categories(): void
    {
        $this->catalog();
        $page = $this->create('landing:tea');
        $element = fn (array $props) => ['id' => 'e_list', 'type' => 'product_listing', 'props' => $props];

        // Scope `current` is only for store page templates; chosen ids are checked per organization.
        $this->assertSame('sections.0.columns.0.elements.0.props.scope', $this->save($page, self::page([$element(['scope' => 'current'])]))->assertUnprocessable()->json('error.details.errors.0.path'));
        $this->save($page, self::page([$element(['scope' => 'categories', 'category_ids' => []])]))->assertUnprocessable();
        $other = $this->provisionTenant('Other Shop');
        $foreign = $this->category($other['organization'], 'Foreign');
        $this->actingAsUser($this->t['admin']);
        $this->assertSame(['CATEGORY_NOT_FOUND'], self::codes($this->save($page, self::page([$element(['scope' => 'categories', 'category_ids' => [$foreign]])]))->assertUnprocessable()));

        $saved = $this->save($page, self::page([$element([
            'scope' => 'categories', 'category_ids' => [$this->ids['snacks'], $this->ids['hidden'], $this->ids['tea']], 'brand_ids' => [$this->ids['pran']],
            'per_page' => 12, 'columns' => ['desktop' => 4, 'tablet' => 2, 'mobile' => 1], 'pagination' => 'load_more', 'sort_default' => 'price_asc',
            'filters' => ['brand' => false],
        ])]))->assertOk()->json('data.content.sections.0.columns.0.elements.0.props');
        $this->assertSame([], $saved['brand_ids']);
        $this->assertSame(['price' => true, 'brand' => false, 'category' => true, 'attributes' => true, 'availability' => true, 'on_sale' => true], $saved['filters']);
        $this->assertSame(['desktop' => 4, 'tablet' => 2, 'mobile' => 1], $saved['columns']);
        $bad = $this->save($page, self::page([$element(['per_page' => 20, 'columns' => ['desktop' => 6], 'sort_default' => 'newest'])]))->assertUnprocessable();
        $this->assertSame(['per_page', 'columns.desktop', 'sort_default'], array_map(fn (array $e) => substr($e['path'], strlen('sections.0.columns.0.elements.0.props.')), $bad->json('error.details.errors')));

        $this->postJson(self::DOCS."/{$page}/publish")->assertOk();
        $this->asVisitor();
        $payload = $this->getJson('http://berry.test/api/v1/store/builder/pages/tea')->assertOk()->json('data');
        // The visible categories' slugs, in the chosen order.
        $this->assertSame(['category_slugs' => ['snacks', 'tea'], 'brand_slugs' => []], $payload['data']['e_list']);

        $names = fn (string $query) => array_column($this->getJson("http://berry.test/api/v1/store/products?{$query}")->assertOk()->json('data'), 'name');
        $this->assertEqualsCanonicalizing(['Green Tea', 'Black Tea', 'Chanachur'], $names('categories[]=snacks&categories[]=tea'));
        $this->assertEqualsCanonicalizing(['Chanachur'], $names('categories=snacks,unknown,hidden'));
        $this->assertSame([], $names('categories=hidden'));
        $this->assertSame([], $names('categories=snacks&category=tea'));
        $this->assertSame(['Green Tea'], $names('categories=tea&q=green'));
        $this->getJson('http://berry.test/api/v1/store/products?categories[]='.implode('&categories[]=', range(1, 21)))->assertUnprocessable();

        // A listing whose categories are all hidden is left out publicly, kept (empty) in the draft.
        $this->actingAsUser($this->t['admin']);
        $this->save($page, self::page([$element(['scope' => 'categories', 'category_ids' => [$this->ids['hidden']]])]))->assertOk();
        $this->postJson(self::DOCS."/{$page}/publish")->assertOk();
        $draft = $this->getJson(self::DOCS."/{$page}/render")->assertOk()->json('data');
        $this->assertSame('empty', $draft['sections'][0]['columns'][0]['elements'][0]['state']);
        $this->asVisitor();
        $live = $this->getJson('http://berry.test/api/v1/store/builder/pages/tea')->assertOk()->json('data');
        $this->assertStringNotContainsString('e_list', (string) json_encode($live['sections']));
        $this->assertArrayNotHasKey('e_list', $live['data'] ?? []);
    }

    public function test_the_sample_context_follows_the_storefront_page_context(): void
    {
        $this->catalog();
        $this->publishTheme(['footer' => ['contact' => ['phone' => '+8801712345678', 'email' => 'hello@berry.test']]])->assertOk();

        $shop = $this->getJson(self::SAMPLE.'?template=shop')->assertOk()->assertHeader('Cache-Control', 'no-store, private')->json('data');
        $this->assertSame('shop', $shop['context']['template']);
        $this->assertSame(['name' => 'Berry Kids', 'phone' => '+8801712345678', 'email' => 'hello@berry.test', 'address' => null], $shop['context']['store']);
        $this->assertSame(3, $shop['sample']['listing']['meta']['total']);
        $this->assertArrayHasKey('facets', $shop['sample']['listing']);
        $this->assertNull($shop['choices']);

        // Default: the category with the most products; by id or slug; unknown or hidden → 404.
        $category = $this->getJson(self::SAMPLE.'?template=category')->assertOk()->json('data');
        $this->assertSame(['id' => $this->ids['tea'], 'slug' => 'tea', 'name' => 'Tea', 'description' => 'Fresh leaf tea.', 'product_count' => 2], $category['context']['category']);
        $this->assertSame(2, $category['sample']['listing']['meta']['total']);
        $this->assertSame('snacks', $this->getJson(self::SAMPLE.'?template=category&id='.$this->ids['snacks'])->assertOk()->json('data.context.category.slug'));
        $this->assertSame($this->ids['snacks'], $this->getJson(self::SAMPLE.'?template=category&id=SNACKS')->assertOk()->json('data.context.category.id'));
        $this->getJson(self::SAMPLE.'?template=category&id='.$this->ids['hidden'])->assertNotFound()->assertJsonPath('error.code', 'NOT_FOUND');

        $brand = $this->getJson(self::SAMPLE.'?template=brand')->assertOk()->json('data');
        $this->assertSame(['id' => $this->ids['pran'], 'slug' => 'pran', 'name' => 'Pran', 'description' => 'Local favourites', 'product_count' => 1], $brand['context']['brand']);
        $this->assertSame(['Chanachur'], array_column($brand['sample']['listing']['data'], 'name'));

        $search = $this->getJson(self::SAMPLE.'?template=search&id=tea')->assertOk()->json('data');
        $this->assertSame(['query' => 'tea', 'result_count' => 2], $search['context']['search']);
        $this->assertNotSame('', $this->getJson(self::SAMPLE.'?template=search')->assertOk()->json('data.context.search.query'));

        $this->getJson(self::SAMPLE.'?template=not_found')->assertOk()->assertJsonPath('data.sample', null);
        $this->getJson(self::SAMPLE.'?template=checkout')->assertUnprocessable();

        // Blog posts: the newest readable one by default, as GET /store/blog/{slug} shows it.
        $this->assertNull($this->getJson(self::SAMPLE.'?template=blog_post')->assertOk()->json('data.context.post'));
        $categoryId = $this->postJson('/api/v1/cms/blog-categories', ['name' => 'Recipes'])->assertCreated()->json('data.id');
        $this->postJson('/api/v1/cms/blog-posts', ['slug' => 'older', 'title' => 'Older', 'status' => 'published', 'published_at' => now()->subDays(2)->toIso8601String()])->assertCreated();
        $post = $this->postJson('/api/v1/cms/blog-posts', ['slug' => 'mango-lassi', 'title' => 'Mango lassi', 'status' => 'published', 'excerpt' => 'Cool down.', 'category_id' => $categoryId, 'body_html' => '<p>'.str_repeat('word ', 400).'</p>'])->assertCreated()->json('data');
        $this->postJson('/api/v1/cms/blog-posts', ['slug' => 'draft', 'title' => 'Draft', 'status' => 'draft'])->assertCreated();
        $blog = $this->getJson(self::SAMPLE.'?template=blog_post')->assertOk()->json('data');
        $this->assertSame([$post['id'], 'mango-lassi', 'Mango lassi', 'Cool down.', 'Recipes', 2], [
            $blog['context']['post']['id'], $blog['context']['post']['slug'], $blog['context']['post']['title'],
            $blog['context']['post']['excerpt'], $blog['context']['post']['category'], $blog['context']['post']['reading_time'],
        ]);
        $this->assertStringContainsString('word', $blog['sample']['post']['body_html']);
        $this->assertSame(['slug' => 'older', 'title' => 'Older'], $blog['sample']['post']['prev']);
        $this->assertArrayNotHasKey('id', $blog['sample']['post']);
        $this->assertSame('older', $this->getJson(self::SAMPLE.'?template=blog_post&id=older')->assertOk()->json('data.context.post.slug'));
        $this->getJson(self::SAMPLE.'?template=blog_post&id=draft')->assertNotFound();

        // Another store's records are not found.
        $other = $this->openStore('Other Shop', 'other.test');
        $this->getJson(self::SAMPLE.'?template=category&id='.$this->ids['tea'])->assertNotFound();
        $this->getJson(self::SAMPLE.'?template=blog_post&id=mango-lassi')->assertNotFound();
        $this->assertNull($this->getJson(self::SAMPLE.'?template=category')->assertOk()->json('data.context.category'));
        $this->assertNull($this->getJson(self::SAMPLE.'?template=category')->json('data.sample'));
        $this->assertSame('Other Shop', $this->getJson(self::SAMPLE.'?template=shop')->json('data.context.store.name'));
        unset($other);
    }

    public function test_the_section_library_works_on_store_pages(): void
    {
        $templates = $this->getJson('/api/v1/storefront/builder/templates?context=template')->assertOk()->json('data');
        $sections = array_values(array_filter($templates, fn (array $t) => $t['scope'] === 'section'));
        $this->assertNotEmpty($sections);
        $this->assertSame([], array_values(array_filter($templates, fn (array $t) => in_array($t['scope'], ['site', 'popup', 'page'], true))));
        foreach ($sections as $template) {
            $this->assertContains('page', $template['allowed_in'], $template['id']);
            $this->assertSame('template', $template['allowed_in'][array_key_last($template['allowed_in'])], $template['id']);
        }
        $plain = array_values(array_filter($sections, fn (array $t) => $t['requires'] === []))[0];
        $nodes = $this->postJson("/api/v1/storefront/builder/templates/{$plain['id']}/instantiate", ['context' => 'template'])->assertOk()->json('data.nodes');
        $this->assertNotEmpty($nodes);

        // Inserted into a store page, it saves like any section.
        $shop = $this->create('template:shop', 'starter');
        $content = $this->getJson(self::DOCS."/{$shop}")->json('data.content');
        $content['sections'] = [...$nodes, ...$content['sections']];
        $this->save($shop, $content)->assertOk();

        // A section saved before B14 (allowed_in without `template`) fits store pages too.
        $this->inTenant($this->t['organization'], fn () => DB::table('builder_templates')->insert([
            'id' => (string) Str::uuid(), 'organization_id' => $this->t['organization']->id, 'scope' => 'section', 'preset' => null, 'name' => 'Old band',
            'content' => json_encode(['context' => 'page', 'allowed_in' => ['page', 'cms', 'zone'], 'section' => $nodes[0]]), 'created_at' => now(), 'updated_at' => now(),
        ]));
        $mine = array_values(array_filter($this->getJson('/api/v1/storefront/builder/templates?context=template&source=mine')->assertOk()->json('data'), fn (array $t) => $t['name'] === 'Old band'));
        $this->assertSame(['page', 'cms', 'zone', 'template'], $mine[0]['allowed_in']);
        $this->postJson("/api/v1/storefront/builder/templates/{$mine[0]['id']}/instantiate", ['context' => 'template'])->assertOk();
        // Site parts and popups still don't.
        $site = array_values(array_filter($this->getJson('/api/v1/storefront/builder/templates')->json('data'), fn (array $t) => $t['scope'] === 'popup'))[0];
        $this->postJson("/api/v1/storefront/builder/templates/{$site['id']}/instantiate", ['context' => 'template'])->assertUnprocessable()->assertJsonPath('error.code', 'TEMPLATE_NOT_ALLOWED');
    }

    public function test_the_registry_describes_the_store_page_elements(): void
    {
        $meta = $this->getJson('/api/v1/storefront/builder/elements')->assertOk()->json('data');
        $byType = array_column($meta['types'], null, 'type');
        $this->assertSame(['page', 'cms', 'template'], $byType['product_listing']['allowed_in']);
        $this->assertSame(['template'], $byType['blog_post_body']['allowed_in']);
        $this->assertSame(['page', 'cms', 'header', 'footer', 'zone', 'template', 'popup'], $byType['dynamic_text']['allowed_in']);
        $this->assertSame(['prefix', 'suffix', 'fallback'], $byType['dynamic_text']['translatable']);
        $this->assertSame(['heading', 'text'], $byType['not_found_message']['translatable']);
        $this->assertSame(ElementRegistry::TEMPLATES, $meta['enums']['templates']);
        $this->assertSame(['store.name', 'store.phone', 'store.email', 'store.address'], $meta['enums']['template_fields']['store']);
        $this->assertSame(['search.query', 'search.result_count'], $meta['enums']['template_fields']['search']);
        $this->assertSame('order_summary', $meta['enums']['template_core']['order']);
        $this->assertSame([12, 24, 36, 48], $meta['enums']['product_listing_per_page']);
        $this->assertSame('scope in categories,brands', $meta['data_when']['product_listing']);
    }
}
