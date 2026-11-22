<?php

namespace App\Modules\Storefront\Tests\Feature;

use App\Modules\AI\Tests\Support\InteractsWithAi;
use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\OnlineCatalog\Tests\Concerns\ScriptedAiJsonWriter;
use App\Modules\Promotions\Tests\Concerns\BuildsPromotions;
use App\Modules\Reviews\Application\Contracts\ReviewShowcase;
use App\Modules\Shared\Application\Contracts\AiJsonWriter;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Storefront\Application\Builder\PrepareBuilderContent;
use App\Modules\Storefront\Application\Builder\Templates\BuilderTemplateLibrary;
use App\Modules\Storefront\Domain\Builder\BuilderDocumentSchema;
use App\Modules\Storefront\Domain\Builder\Wizard\WizardOptions;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;
use App\Modules\Users\Infrastructure\Models\Role;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * B21: "Build my page in 1 minute" — every page type × goal makes a valid draft from the shipped
 * templates (never published), the empty home page first then landing pages, chosen products
 * and categories of the organization only (isolation), the best-seller / newest fallback and
 * NOTHING_TO_SHOW, the running sale's promotions, the store's contact details, languages, the
 * look (motion theme), the AI rewrite (scripted: on / failing / over budget / off, and through
 * the AI module's gate), the audit, permissions and the registry.
 */
class StoreBuilderB21WizardTest extends TestCase
{
    use BuildsOnlineCatalog, BuildsPromotions, InteractsWithAi, InteractsWithTenancy, RefreshDatabase;

    private const WIZARD = '/api/v1/storefront/builder/wizard';

    private const DOCS = '/api/v1/storefront/builder/documents';

    /** @var array<string, mixed> */
    private array $t;

    private ScriptedAiJsonWriter $ai;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('public');
        Queue::fake();
        Date::setTestNow('2026-11-22T10:00:00+06:00');
        $this->t = $this->openStore('Berry Kids', 'berry.test');
        $this->ai = new ScriptedAiJsonWriter;
        $this->app->instance(AiJsonWriter::class, $this->ai);
    }

    /**
     * A product of the store (live = listed online).
     *
     * @param  array<string, mixed>  $tenant
     */
    private function product(string $name, ?string $categoryId = null, bool $live = true, ?array $tenant = null): string
    {
        $tenant ??= $this->t;
        $product = $this->makeProduct($tenant['unit']->id, $name, [[strtoupper(Str::random(8)), '350.00']], $categoryId === null ? [] : ['category_id' => $categoryId]);
        if ($live) {
            $this->publish($product['id']);
        }

        return $product['id'];
    }

    private function visibleCategory(string $name, ?array $tenant = null): string
    {
        $tenant ??= $this->t;
        $id = $this->category($tenant['organization'], $name);
        $this->listCategory($id);

        return $id;
    }

    /**
     * @param  array<string, mixed>  $input
     */
    private function wizard(array $input = []): TestResponse
    {
        return $this->postJson(self::WIZARD, $input + [
            'page_type' => 'home',
            'title' => 'Winter collection',
            'goal' => 'orders',
            'look' => 'current',
            'language' => 'both',
        ]);
    }

    private function document(string $id): BuilderDocument
    {
        return BuilderDocument::query()->withoutGlobalScopes()->findOrFail($id);
    }

    /**
     * Every element of a draft (inner rows included), in reading order.
     *
     * @param  array<string, mixed>  $draft
     * @return list<array<string, mixed>>
     */
    private function elements(array $draft): array
    {
        $result = [];
        BuilderDocumentSchema::walk($draft, function (array $node, string $path, string $kind) use (&$result) {
            if ($kind === 'element') {
                $result[] = $node;
            }
        });

        return $result;
    }

    /**
     * @param  array<string, mixed>  $draft
     * @return list<array<string, mixed>>
     */
    private function ofType(array $draft, string $type): array
    {
        return array_values(array_filter($this->elements($draft), fn (array $e) => $e['type'] === $type));
    }

    /**
     * @param  list<string>  $permissions
     */
    private function staff(array $permissions): User
    {
        return $this->staffWith($permissions);
    }

    /**
     * A Reviews read contract answering with the given approved reviews; records the product ids
     * it was asked about.
     *
     * @param  list<array<string, mixed>>  $approved
     */
    private function reviews(array $approved): object
    {
        $fake = new class($approved) implements ReviewShowcase
        {
            /** @var list<list<string>> */
            public array $asked = [];

            /** @param  list<array<string, mixed>>  $approved */
            public function __construct(private readonly array $approved) {}

            public function approved(array $productIds, int $minRating, string $order, int $limit, int $bodyMax): array
            {
                $this->asked[] = $productIds;

                return array_values(array_filter($this->approved, fn (array $r) => in_array($r['product_id'], $productIds, true) && $r['rating'] >= $minRating));
            }

            public function ratingCounts(array $productIds): array
            {
                $count = count(array_filter($this->approved, fn (array $r) => in_array($r['product_id'], $productIds, true)));

                return ['1' => 0, '2' => 0, '3' => 0, '4' => 0, '5' => $count];
            }
        };
        $this->app->instance(ReviewShowcase::class, $fake);

        return $fake;
    }

    /**
     * The names in the shipped testimonials template's sample reviews.
     *
     * @return list<string>
     */
    private function sampleNames(): array
    {
        $names = [];
        $content = app(BuilderTemplateLibrary::class)->content('neutral-testimonials');
        array_walk_recursive($content, function (mixed $value, mixed $key) use (&$names) {
            if ($key === 'name' && is_string($value)) {
                $names[] = $value;
            }
        });

        return $names;
    }

    /**
     * @param  list<string>  $permissions
     */
    private function staffWith(array $permissions): User
    {
        $organization = $this->t['organization'];

        return $this->createUserWithRole($organization, $this->inTenant($organization, function () use ($permissions) {
            $role = Role::query()->create(['name' => 'Wizard user '.Str::random(6)]);
            $role->permissions()->sync($permissions);

            return $role;
        }));
    }

    public function test_every_page_type_and_goal_builds_a_valid_draft_from_the_shipped_templates(): void
    {
        $toys = $this->visibleCategory('Toys');
        $this->product('Wooden train', $toys);
        $this->product('Rag doll');
        $library = app(BuilderTemplateLibrary::class);
        $prepare = app(PrepareBuilderContent::class);
        $sampleNames = $this->sampleNames();
        $this->assertNotEmpty($sampleNames);
        $hero = ['home' => 'page-new-collection', 'sale' => 'page-sale-landing', 'product_launch' => 'page-new-collection', 'about' => 'page-about', 'festival' => 'festival-winter-sale-hero', 'contact' => 'page-about'];

        $calls = 0;
        foreach (WizardOptions::PAGE_TYPES as $pageType) {
            foreach (WizardOptions::GOALS as $goal) {
                if (++$calls % 20 === 0) {
                    $this->travel(61)->seconds();
                }
                $data = $this->wizard(['page_type' => $pageType, 'goal' => $goal, 'title' => "{$pageType} {$goal}", 'look' => 'calm'])
                    ->assertCreated()->json('data');
                $context = "{$pageType} × {$goal}";

                $this->assertSame(['used' => false, 'status' => 'not_requested'], $data['ai'], $context);
                $this->assertSame($hero[$pageType], $data['sections'][0]['template'], $context);
                foreach ($data['sections'] as $section) {
                    $this->assertNotNull($library->find($section['template']), $context);
                    $this->assertNotSame('', $section['label']);
                    $this->assertNotSame('', $section['label_bn']);
                }
                $this->assertSame($pageType === 'festival' ? 'winter-sale' : null, $data['festival']['key'] ?? null, $context);
                $this->assertSame($pageType === 'home' && $calls === 1 ? 'home' : 'landing', $data['target'], $context);

                // A valid draft (the save rules again), never published.
                $document = $this->document($data['document']['id']);
                $this->assertNull($document->published_version_id, $context);
                $this->assertSame($data['document']['key'], $document->key);
                $this->assertCount(count($data['sections']), $document->draft['sections'], $context);
                $this->assertCount(count($document->draft['sections']), $this->inTenant($this->t['organization'], fn () => $prepare($document->draft, 'page'))['sections'], $context);
                $this->assertSame('calm', $document->draft['motion_theme'] ?? null, $context);
                // The page check finds nothing wrong (no broken links, gone records or unsold products).
                $check = $this->postJson(self::DOCS."/{$document->id}/check")->assertOk()->json('data');
                $this->assertSame(0, $check['counts']['error'], $context.': '.json_encode($check['issues']));

                // What the goal is for shows on the page.
                $types = array_column($this->elements($document->draft), 'type');
                // Never sample testimonials with made-up names; no review wall without real reviews.
                $this->assertNotContains('testimonials', $types, $context);
                $this->assertNotContains('review_wall', $types, $context);
                $json = (string) json_encode($document->draft, JSON_UNESCAPED_UNICODE);
                foreach ($sampleNames as $name) {
                    $this->assertStringNotContainsString($name, $json, $context);
                }
                match ($goal) {
                    'order_form' => $this->assertContains('order_form', $types, $context),
                    'phone_numbers' => $this->assertContains('form', $types, $context),
                    'tell_story' => $this->assertContains('scroll_story', $types, $context),
                    'show_collection' => $this->assertContains('product_carousel', $types, $context),
                    'orders' => $this->assertTrue(in_array('product_grid', $types, true) || in_array('cta', $types, true), $context),
                };
            }
        }

        $this->assertSame(30, BuilderDocument::query()->count());
        $this->assertSame(0, BuilderDocument::query()->whereNotNull('published_version_id')->count());
        $this->assertSame(30, DB::table('audit_logs')->where('action', 'storefront.builder_wizard')->count());
    }

    public function test_the_empty_home_page_first_then_new_landing_pages(): void
    {
        $this->product('Wooden train');
        $home = $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'home', 'title' => 'Home', 'from' => 'blank'])->assertCreated()->json('data.id');

        $data = $this->wizard(['title' => 'Summer sale'])->assertCreated()->json('data');
        $this->assertSame(['home', $home, 'home'], [$data['target'], $data['document']['id'], $data['document']['key']]);
        $this->assertSame(1, $this->document($home)->draft_revision);
        $this->assertNotSame([], $this->document($home)->draft['sections']);

        // The home page has content now: a landing page with an address from the title.
        $second = $this->wizard(['title' => 'Summer sale'])->assertCreated()->json('data');
        $this->assertSame(['landing', 'landing:summer-sale'], [$second['target'], $second['document']['key']]);
        $this->assertSame('landing:summer-sale-2', $this->wizard(['page_type' => 'sale', 'title' => 'Summer sale!'])->assertCreated()->json('data.document.key'));
        $this->assertSame('landing:sale-page', $this->wizard(['page_type' => 'sale', 'title' => 'ঈদের সেল'])->assertCreated()->json('data.document.key'));
        $this->assertSame('landing:eid', $this->wizard(['page_type' => 'sale', 'title' => 'Eid', 'slug' => 'eid'])->assertCreated()->json('data.document.key'));

        // A chosen address that is taken.
        $this->wizard(['page_type' => 'sale', 'title' => 'Eid again', 'slug' => 'eid'])->assertStatus(409)
            ->assertJsonPath('error.code', 'DOCUMENT_EXISTS')->assertJsonPath('error.details.key', 'landing:eid');
        $this->wizard(['slug' => 'home'])->assertStatus(422)->assertJsonPath('error.code', 'VALIDATION_FAILED');
        $this->wizard(['slug' => 'Not Valid'])->assertStatus(422)->assertJsonValidationErrors(['slug'], 'error.details');
        $this->assertSame(5, BuilderDocument::query()->count());

        // Nothing is published; the audit has counts only.
        $this->assertSame(0, BuilderDocument::query()->whereNotNull('published_version_id')->count());
        $context = json_decode((string) DB::table('audit_logs')->where('action', 'storefront.builder_wizard')->where('subject_id', BuilderDocument::query()->where('key', 'landing:eid')->value('id'))->value('context'), true);
        $this->assertEqualsCanonicalizing(['page_type', 'goal', 'look', 'language', 'target', 'sections', 'categories', 'products', 'product_source', 'ai'], array_keys($context));
        $this->assertSame(['sale', 'landing', 'new_arrivals', 'not_requested'], [$context['page_type'], $context['target'], $context['product_source'], $context['ai']]);

        // A home page that was published is never overwritten.
        $this->postJson(self::DOCS."/{$home}/publish")->assertOk();
        $this->postJson(self::DOCS."/{$home}/discard")->assertOk();
        $this->assertSame('landing', $this->wizard(['title' => 'Again'])->assertCreated()->json('data.target'));
    }

    public function test_chosen_products_and_categories_are_the_stores_own(): void
    {
        $toys = $this->visibleCategory('Toys');
        $books = $this->visibleCategory('Books');
        $train = $this->product('Wooden train', $toys);
        $doll = $this->product('Rag doll', $toys);
        $story = $this->product('Story book', $books);
        $hidden = $this->product('Not online', $toys, false);
        $other = $this->openStore('Mango Mart', 'mango.test');
        $theirs = $this->product('Their mango', null, true, $other);
        $theirCategory = $this->visibleCategory('Their fruit', $other);
        $this->actingAsUser($this->t['admin']);

        $this->wizard(['product_ids' => [$train, $theirs]])->assertStatus(422)
            ->assertJsonPath('error.code', 'VALIDATION_FAILED')->assertJsonValidationErrors(['product_ids'], 'error.details');
        $this->wizard(['product_ids' => [$hidden]])->assertStatus(422)->assertJsonValidationErrors(['product_ids'], 'error.details');
        $this->wizard(['category_ids' => [$theirCategory]])->assertStatus(422)
            ->assertJsonPath('error.code', 'VALIDATION_FAILED')->assertJsonValidationErrors(['category_ids'], 'error.details');
        $this->wizard(['product_ids' => array_map(fn () => (string) Str::uuid(), range(1, 9))])->assertStatus(422)->assertJsonValidationErrors(['product_ids'], 'error.details');
        $this->wizard(['category_ids' => array_map(fn () => (string) Str::uuid(), range(1, 5))])->assertStatus(422)->assertJsonValidationErrors(['category_ids'], 'error.details');
        $this->assertSame(0, BuilderDocument::query()->count());

        // Chosen products: hand-picked in the chosen order; the order form sells the first one.
        $data = $this->wizard(['page_type' => 'product_launch', 'goal' => 'order_form', 'product_ids' => [$doll, $train]])->assertCreated()->json('data');
        $this->assertSame(['source' => 'chosen', 'count' => 2], $data['products']);
        $draft = $this->document($data['document']['id'])->draft;
        $this->assertSame($doll, $this->ofType($draft, 'order_form')[0]['props']['product_id']);
        $this->assertSame($doll, $this->ofType($draft, 'product_spotlight')[0]['props']['product_id']);
        // The launch banner's button opens the product's page.
        $this->assertSame('/product/'.DB::table('product_listings')->where('product_id', $doll)->value('slug'), $this->ofType($draft, 'button')[0]['props']['link']['url']);

        $data = $this->wizard(['product_ids' => [$doll, $train], 'category_ids' => [$books, $toys]])->assertCreated()->json('data');
        $draft = $this->document($data['document']['id'])->draft;
        $grid = $this->ofType($draft, 'product_grid')[0]['props'];
        $this->assertSame('manual', $grid['config']['source']);
        $this->assertSame([$doll, $train], array_column($grid['items'], 'item_id'));
        $strip = $this->ofType($draft, 'category_strip')[0]['props'];
        $this->assertSame(['manual', [$books, $toys]], [$strip['config']['source'], array_column($strip['items'], 'item_id')]);

        // Chosen categories without products: the first one's products, the second in the carousel.
        $data = $this->wizard(['goal' => 'show_collection', 'category_ids' => [$toys, $books], 'title' => 'Toys'])->assertCreated()->json('data');
        $this->assertSame('category', $data['products']['source']);
        $draft = $this->document($data['document']['id'])->draft;
        $this->assertSame(['category', $toys], [$this->ofType($draft, 'product_grid')[0]['props']['config']['source'], $this->ofType($draft, 'product_grid')[0]['props']['config']['category_id']]);
        $this->assertSame($books, $this->ofType($draft, 'product_carousel')[0]['props']['config']['category_id']);
        $this->assertSame('Toys', $this->ofType($draft, 'product_grid')[0]['props']['title']);
        $this->assertStringNotContainsString($theirs, (string) json_encode($draft));
        unset($story);

        // The other store sees none of these drafts.
        $this->actingAsUser($other['admin']);
        $this->assertSame([], $this->getJson(self::DOCS)->assertOk()->json('data'));
    }

    public function test_best_sellers_then_newest_products_and_nothing_to_show(): void
    {
        $this->wizard()->assertStatus(422)->assertJsonPath('error.code', 'NOTHING_TO_SHOW')->assertJsonPath('error.details.reason', 'no_live_products');
        $this->wizard(['page_type' => 'product_launch', 'goal' => 'order_form'])->assertStatus(422)->assertJsonPath('error.code', 'NOTHING_TO_SHOW');
        $this->product('Not online yet', null, false);
        $this->wizard(['page_type' => 'sale'])->assertStatus(422)->assertJsonPath('error.code', 'NOTHING_TO_SHOW');
        $this->assertSame(0, BuilderDocument::query()->count());

        // Pages that need no products are fine without them.
        $about = $this->wizard(['page_type' => 'about', 'goal' => 'tell_story'])->assertCreated()->json('data');
        $this->assertSame(['source' => 'none', 'count' => 0], $about['products']);
        $this->wizard(['page_type' => 'contact', 'goal' => 'phone_numbers'])->assertCreated()->assertJsonPath('data.products.source', 'none');

        // No sales yet: the newest products.
        $train = $this->product('Wooden train');
        $doll = $this->product('Rag doll');
        $data = $this->wizard(['title' => 'New in'])->assertCreated()->json('data');
        $this->assertSame(['source' => 'new_arrivals', 'count' => 2], $data['products']);
        $grid = $this->ofType($this->document($data['document']['id'])->draft, 'product_grid')[0]['props'];
        $this->assertSame(['new_arrivals', 'New arrivals'], [$grid['config']['source'], $grid['title']]);

        // Best sellers once something sells.
        DB::table('product_stats')->insert(['product_id' => $doll, 'organization_id' => $this->t['organization']->id, 'units_sold_30d' => 5, 'units_sold_total' => 9, 'refreshed_at' => now()]);
        $data = $this->wizard(['title' => 'Favourites'])->assertCreated()->json('data');
        $this->assertSame(['source' => 'best_sellers', 'count' => 1], $data['products']);
        $grid = $this->ofType($this->document($data['document']['id'])->draft, 'product_grid')[0]['props'];
        $this->assertSame(['best_sellers', 'Best sellers'], [$grid['config']['source'], $grid['title']]);
        // The order form sells the best seller when nothing is chosen.
        $data = $this->wizard(['page_type' => 'product_launch', 'goal' => 'order_form', 'title' => 'Doll'])->assertCreated()->json('data');
        $this->assertContains($this->ofType($this->document($data['document']['id'])->draft, 'order_form')[0]['props']['product_id'], [$doll, $train]);
    }

    public function test_texts_follow_the_language(): void
    {
        $this->product('Wooden train');

        $draft = $this->document($this->wizard(['language' => 'both', 'title' => 'Both'])->assertCreated()->json('data.document.id'))->draft;
        $heading = $this->ofType($draft, 'heading')[0];
        $this->assertContains($heading['props']['text'], ['Welcome to Berry Kids', 'Berry Kids — shop online']);
        $this->assertContains($heading['translations']['bn']['text'], ['Berry Kids-এ স্বাগতম', 'Berry Kids — অনলাইনে কেনাকাটা']);
        $this->assertStringContainsString('Berry Kids', $this->ofType($draft, 'text')[0]['props']['html']);
        $this->assertSame('/shop', $this->ofType($draft, 'button')[0]['props']['link']['url']);

        $draft = $this->document($this->wizard(['language' => 'en', 'title' => 'English'])->assertCreated()->json('data.document.id'))->draft;
        $this->assertStringNotContainsString('"bn"', (string) json_encode($draft));

        // Bangla: the base texts are Bangla — the wizard's and the templates' own.
        $draft = $this->document($this->wizard(['language' => 'bn', 'title' => 'Bangla'])->assertCreated()->json('data.document.id'))->draft;
        $this->assertContains($this->ofType($draft, 'heading')[0]['props']['text'], ['Berry Kids-এ স্বাগতম', 'Berry Kids — অনলাইনে কেনাকাটা']);
        $this->assertSame('নতুন এসেছে', $this->ofType($draft, 'product_grid')[0]['props']['title']);
        $headings = array_map(fn (array $h) => $h['props']['text'], $this->ofType($draft, 'heading'));
        $this->assertContains('কেন Berry Kids থেকে কিনবেন', $headings);
        // The why-us template's own Bangla heading became the base text.
        $this->assertContains('দ্রুত ডেলিভারি', $headings);
        $this->assertNotContains('Fast delivery', $headings);
    }

    public function test_the_look_sets_a_motion_theme_and_the_page_top_stays_still(): void
    {
        $this->product('Wooden train');
        $draft = $this->document($this->wizard(['look' => 'current', 'title' => 'Still'])->assertCreated()->json('data.document.id'))->draft;
        $this->assertArrayNotHasKey('motion_theme', $draft);

        $draft = $this->document($this->wizard(['look' => 'lively', 'title' => 'Lively'])->assertCreated()->json('data.document.id'))->draft;
        $this->assertSame('lively', $draft['motion_theme']);
        $first = $draft['sections'][0];
        $this->assertSame('none', $first['style']['base']['motion']['entrance'] ?? 'none');
        $this->assertArrayNotHasKey('scroll', $first['style']['base']);
        $this->assertSame('rise', $draft['sections'][1]['style']['base']['scroll']['effect']);
        $this->assertArrayNotHasKey('motion', $this->ofType(['sections' => [$first]], 'heading')[0]['style']['base'] ?? []);
        // The hero has a picture: its heading appears word by word.
        $this->assertSame('reveal_words', $this->ofType(['sections' => [$first]], 'heading')[0]['props']['text_effect']['type']);
        $this->assertSame('pop', $this->ofType($draft, 'button')[0]['style']['base']['hover']['effect']);

        $draft = $this->document($this->wizard(['look' => 'festive', 'title' => 'Festive'])->assertCreated()->json('data.document.id'))->draft;
        $this->assertSame('festive', $draft['motion_theme']);
        $this->assertSame('glare', $this->ofType($draft, 'product_grid')[0]['props']['card_hover']);
        $this->assertSame('shine', $this->ofType($draft, 'button')[0]['style']['base']['motion']['loop']);
    }

    public function test_a_sale_page_shows_the_running_flash_sale_and_coupon_only_while_they_run(): void
    {
        $train = $this->product('Wooden train');
        $templates = fn (array $data) => array_column($data['sections'], 'template');

        $data = $this->wizard(['page_type' => 'sale', 'title' => 'Sale one'])->assertCreated()->json('data');
        $this->assertNotContains('classic-flash-sale', $templates($data));
        $this->assertNotContains('landing-eid-sale', $templates($data));

        $coupon = $this->makePromotion($this->t['organization'], ['name' => 'Welcome', 'type' => 'percent', 'value' => '10', 'trigger' => 'coupon']);
        $this->makeCoupon($this->t['organization'], $coupon, 'WELCOME10');
        $this->postJson('/api/v1/promotions', ['name' => 'Train flash sale', 'type' => 'percent', 'value' => '10', 'scope' => 'products', 'target_ids' => [$train],
            'trigger' => 'automatic', 'show_countdown' => true, 'ends_at' => now()->addDays(2)->toIso8601String()])->assertCreated();

        $data = $this->wizard(['page_type' => 'sale', 'title' => 'Sale two'])->assertCreated()->json('data');
        $this->assertSame(['page-sale-landing', 'classic-flash-sale', 'landing-eid-sale'], array_slice($templates($data), 0, 3));
        $draft = $this->document($data['document']['id'])->draft;
        $discount = $this->ofType($draft, 'discount')[0];
        $this->assertSame([$coupon->id, 'An extra treat for you'], [$discount['props']['promotion_id'], $discount['props']['title']]);
        $this->assertCount(1, $this->ofType($draft, 'hot_deals'));
        // The sale banner's own "Up to 30 % off" never stays: no invented discounts.
        $this->assertStringNotContainsString('30 %', (string) json_encode($draft, JSON_UNESCAPED_UNICODE));
        $this->assertSame('Sale two', $this->ofType($draft, 'cta')[0]['props']['title']);

        // A festival page: the pack's own texts and a countdown to the end of its campaign.
        $data = $this->wizard(['page_type' => 'festival', 'festival' => 'victory-day', 'title' => 'Victory Day offers'])->assertCreated()->json('data');
        $this->assertSame(['key' => 'victory-day', 'name' => 'Victory Day', 'name_bn' => 'বিজয় দিবস'], $data['festival']);
        $this->assertSame('festival-victory-day-hero', $data['sections'][0]['template']);
        // The pack's own heading stays (no countdown in this pack).
        $this->assertStringNotContainsString('Victory Day offers', (string) json_encode($this->ofType($this->document($data['document']['id'])->draft, 'heading')[0]));
        $data = $this->wizard(['page_type' => 'festival', 'festival' => 'winter-sale', 'title' => 'Winter sale'])->assertCreated()->json('data');
        $countdown = $this->ofType($this->document($data['document']['id'])->draft, 'countdown')[0]['props'];
        $this->assertSame('2027-01-29T23:59:59+06:00', $countdown['ends_at']);
    }

    public function test_the_review_wall_shows_real_reviews_only_when_the_store_has_some(): void
    {
        $train = $this->product('Wooden train');
        $other = $this->openStore('Mango Mart', 'mango.test');
        $theirs = $this->product('Their mango', null, true, $other);
        $this->actingAsUser($this->t['admin']);
        $review = fn (string $productId, int $rating) => ['id' => (string) Str::uuid(), 'product_id' => $productId, 'author' => 'Real S.', 'rating' => $rating, 'title' => null, 'body' => 'Real words', 'created_at' => now()->toIso8601String()];

        // Only a 3-star review (the wall shows 4 stars and more) and another store's review.
        $fake = $this->reviews([$review($train, 3), $review($theirs, 5)]);
        foreach (['home', 'product_launch', 'about'] as $pageType) {
            $data = $this->wizard(['page_type' => $pageType, 'title' => "No reviews {$pageType}"])->assertCreated()->json('data');
            $this->assertNotContains('neutral-review-wall', array_column($data['sections'], 'template'), $pageType);
            $this->assertNotContains('review_wall', array_column($this->elements($this->document($data['document']['id'])->draft), 'type'), $pageType);
        }
        // Asked about this store's live products only.
        $this->assertSame([$train], $fake->asked[0]);

        $this->reviews([$review($train, 5)]);
        $data = $this->wizard(['title' => 'With reviews'])->assertCreated()->json('data');
        $this->assertContains('neutral-review-wall', array_column($data['sections'], 'template'));
        $this->assertContains('Real reviews from your customers', array_column($data['sections'], 'label'));
        $draft = $this->document($data['document']['id'])->draft;
        $wall = $this->ofType($draft, 'review_wall');
        $this->assertCount(1, $wall);
        $props = $wall[0]['props'];
        $this->assertSame(['latest', null, 4, 6, true, 'What customers say'], [$props['source'], $props['product_id'] ?? null, $props['min_rating'], $props['limit'], $props['show_summary'], $props['title']]);
        $this->assertSame('ক্রেতারা যা বলেন', $wall[0]['translations']['bn']['title']);
        $this->assertNotContains('testimonials', array_column($this->elements($draft), 'type'));
        $check = $this->postJson(self::DOCS."/{$data['document']['id']}/check")->assertOk()->json('data');
        $this->assertSame(0, $check['counts']['error']);

        // Bangla only: the heading in Bangla, no translation left.
        $draft = $this->document($this->wizard(['title' => 'Bangla reviews', 'language' => 'bn'])->assertCreated()->json('data.document.id'))->draft;
        $this->assertSame('ক্রেতারা যা বলেন', $this->ofType($draft, 'review_wall')[0]['props']['title']);
        $this->assertArrayNotHasKey('bn', $this->ofType($draft, 'review_wall')[0]['translations'] ?? []);
    }

    public function test_a_contact_page_shows_the_stores_own_contact_details(): void
    {
        $draft = $this->document($this->wizard(['page_type' => 'contact', 'goal' => 'phone_numbers', 'title' => 'Contact us'])->assertCreated()->json('data.document.id'))->draft;
        $this->assertCount(1, $this->ofType($draft, 'contact_block'));
        $this->assertCount(0, $this->ofType($draft, 'map'));
        $this->assertStringNotContainsString('Dhanmondi', (string) json_encode($draft, JSON_UNESCAPED_UNICODE));
        $this->assertSame('Contact us', $this->ofType($draft, 'heading')[0]['props']['text']);
        $this->assertSame('Leave your number — we will call you', $this->ofType($draft, 'form')[1]['props']['title']);
    }

    public function test_ai_rewrites_the_texts_from_store_facts_only(): void
    {
        $train = $this->product('Wooden train');
        $this->ai->reply(function (array $call) {
            $keys = $call['schema']['properties']['texts']['required'];
            $texts = [];
            foreach ($keys as $key) {
                $texts[$key] = ['en' => str_ends_with($key, '_heading') ? str_repeat('Long heading ', 40) : "AI {$key}", 'bn' => "এআই {$key}"];
            }

            return ['status' => 'ok', 'data' => ['texts' => $texts]];
        });
        $data = $this->wizard(['use_ai' => true, 'product_ids' => [$train], 'title' => 'Toy time'])->assertCreated()->json('data');
        $this->assertSame(['used' => true, 'status' => 'ok'], $data['ai']);

        $call = $this->ai->calls[0];
        $this->assertSame('builder_wizard', $call['feature']);
        $this->assertSame($this->t['admin']->id, $call['user_id']);
        $this->assertStringContainsString('Berry Kids', $call['prompt']);
        $this->assertStringContainsString('Wooden train', $call['prompt']);
        $this->assertStringNotContainsString('350', $call['prompt']);
        $this->assertStringContainsString('Never write prices', $call['system']);

        $draft = $this->document($data['document']['id'])->draft;
        $heading = $this->ofType($draft, 'heading')[0];
        $this->assertLessThanOrEqual(200, mb_strlen($heading['props']['text']));
        $this->assertStringStartsWith('Long heading', $heading['props']['text']);
        $this->assertSame('এআই s1_heading', $heading['translations']['bn']['text']);
        $this->assertSame('AI s1_button', $this->ofType($draft, 'button')[0]['props']['label']);
        $this->assertSame('<p>AI s1_text</p>', $this->ofType($draft, 'text')[0]['props']['html']);

        // English only: one text per key.
        $this->ai->reply(fn (array $call) => ['status' => 'ok', 'data' => ['texts' => array_fill_keys($call['schema']['properties']['texts']['required'], 'Plain <b>English</b>')]]);
        $draft = $this->document($this->wizard(['use_ai' => true, 'language' => 'en', 'title' => 'English AI'])->assertCreated()->json('data.document.id'))->draft;
        $this->assertSame(['type' => 'string'], $this->ai->calls[1]['schema']['properties']['texts']['properties']['s1_heading']);
        $this->assertSame('Plain English', $this->ofType($draft, 'heading')[0]['props']['text']);
    }

    public function test_ai_off_failing_or_over_budget_keeps_the_built_in_texts(): void
    {
        $this->product('Wooden train');
        foreach (['invalid' => 'failed', 'unavailable' => 'failed', 'refused' => 'failed', 'budget_exceeded' => 'budget_exceeded', 'disabled' => 'disabled'] as $status => $expected) {
            $this->ai->status($status);
            $data = $this->wizard(['use_ai' => true, 'title' => "Try {$status}"])->assertCreated()->json('data');
            $this->assertSame(['used' => false, 'status' => $expected], $data['ai'], $status);
            $this->assertContains($this->ofType($this->document($data['document']['id'])->draft, 'heading')[0]['props']['text'], ['Welcome to Berry Kids', 'Berry Kids — shop online']);
        }
        // An answer with nothing usable.
        $this->ai->answer(['texts' => ['s1_heading' => ['en' => '  ', 'bn' => '']]]);
        $this->assertSame('failed', $this->wizard(['use_ai' => true, 'title' => 'Empty'])->assertCreated()->json('data.ai.status'));
        // Not asked: no call.
        $calls = count($this->ai->calls);
        $this->wizard(['use_ai' => false, 'title' => 'No AI'])->assertCreated()->assertJsonPath('data.ai.status', 'not_requested');
        $this->assertCount($calls, $this->ai->calls);
    }

    public function test_ai_through_the_ai_modules_gate_and_budget(): void
    {
        $this->app->forgetInstance(AiJsonWriter::class);
        $fake = $this->fakeAi();
        $this->product('Wooden train');

        $this->patchJson('/api/v1/ai/settings', ['enabled' => false])->assertOk();
        $this->wizard(['use_ai' => true, 'title' => 'Off'])->assertCreated()->assertJsonPath('data.ai', ['used' => false, 'status' => 'disabled']);
        $this->patchJson('/api/v1/ai/settings', ['enabled' => true])->assertOk();

        $fake->answerJson(['texts' => ['s1_heading' => ['en' => 'Toys that last', 'bn' => 'টেকসই খেলনা']]]);
        $data = $this->wizard(['use_ai' => true, 'title' => 'On'])->assertCreated()->json('data');
        $this->assertSame(['used' => true, 'status' => 'ok'], $data['ai']);
        $heading = $this->ofType($this->document($data['document']['id'])->draft, 'heading')[0];
        $this->assertSame(['Toys that last', 'টেকসই খেলনা'], [$heading['props']['text'], $heading['translations']['bn']['text']]);
        $this->assertSame('ok', DB::table('ai_requests')->where('feature', 'builder_wizard')->value('status'));

        $fake->fail();
        $this->wizard(['use_ai' => true, 'title' => 'Broken'])->assertCreated()->assertJsonPath('data.ai.status', 'failed');
    }

    public function test_permissions_validation_and_the_registry(): void
    {
        $this->product('Wooden train');
        $this->wizard(['page_type' => 'blog'])->assertStatus(422)->assertJsonValidationErrors(['page_type'], 'error.details');
        $this->wizard(['goal' => 'likes', 'look' => 'wild', 'language' => 'fr', 'title' => str_repeat('a', 81)])->assertStatus(422)
            ->assertJsonValidationErrors(['goal', 'look', 'language', 'title'], 'error.details');
        $this->wizard(['festival' => 'christmas'])->assertStatus(422)->assertJsonValidationErrors(['festival'], 'error.details');

        $registry = $this->getJson('/api/v1/storefront/builder/elements')->assertOk()->json('data');
        $this->assertSame(WizardOptions::PAGE_TYPES, $registry['enums']['wizard_page_types']);
        $this->assertSame(WizardOptions::GOALS, $registry['enums']['wizard_goals']);
        $this->assertSame(['current', 'calm', 'lively', 'festive'], $registry['enums']['wizard_looks']);
        $this->assertSame(['en', 'bn', 'both'], $registry['enums']['wizard_languages']);
        $this->assertSame('tell_story', $registry['enums']['wizard_default_goals']['about']);
        $this->assertSame(['title' => 80, 'categories' => 4, 'products' => 8], $registry['limits']['wizard']);

        $this->actingAsUser($this->staff(['storefront.view']));
        $this->wizard()->assertForbidden();
        $this->actingAsUser($this->staff(['storefront.view', 'storefront.manage']));
        $this->wizard()->assertCreated();
        $this->app['auth']->forgetGuards();
        $this->wizard()->assertUnauthorized();
        $this->assertSame(1, BuilderDocument::query()->withoutGlobalScopes()->count());
    }
}
