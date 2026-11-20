<?php

namespace App\Modules\OnlineCatalog\Tests\Feature;

use App\Modules\AI\Tests\Support\InteractsWithAi;
use App\Modules\Catalog\Infrastructure\Models\Category;
use App\Modules\OnlineCatalog\Application\Assistants\SuggestCategories;
use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\OnlineCatalog\Tests\Concerns\ScriptedAiJsonWriter;
use App\Modules\Shared\Application\Contracts\AiJsonWriter;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * AI2a: AI category suggestions — which products and facts the model gets (refs only, no ids,
 * no prices), mapping answers back, clamping, errors, applying through Products'
 * ProductCategoryAssignment (permission, audit, skips) and tenant isolation.
 */
class CategorySuggestionsTest extends TestCase
{
    use BuildsOnlineCatalog, InteractsWithAi, InteractsWithTenancy, RefreshDatabase;

    private const SUGGEST = '/api/v1/online-catalog/ai/category-suggestions';

    private const APPLY = '/api/v1/online-catalog/ai/category-suggestions/apply';

    /** @var array<string, mixed> */
    private array $t;

    private ScriptedAiJsonWriter $ai;

    private string $clothing;

    private string $tshirts;

    private string $kitchen;

    protected function setUp(): void
    {
        parent::setUp();
        $this->ai = new ScriptedAiJsonWriter;
        $this->app->instance(AiJsonWriter::class, $this->ai);
        $this->t = $this->openStore('Berry Kids', 'berry.test');
        $org = $this->t['organization'];
        $this->clothing = $this->category($org, 'Clothing');
        $this->tshirts = $this->category($org, 'T-shirts', $this->clothing);
        $this->kitchen = $this->category($org, 'Kitchen');
        $this->category($org, 'Old stuff', null, false);
    }

    /**
     * @return array<string, mixed>
     */
    private function product(string $name, array $attributes = []): array
    {
        return $this->makeProduct($this->t['unit']->id, $name, [['SKU-'.Str::random(6), '450.00']], $attributes);
    }

    /**
     * The refs the model was given: product ref => name, category ref => path.
     *
     * @return array{products: array<string, string>, categories: array<string, string>}
     */
    private function refsSent(int $call = 0): array
    {
        $prompt = $this->ai->calls[$call]['prompt'];
        preg_match('/Categories \(JSON\): (.*)\n\nProducts \(JSON\): (.*)$/s', $prompt, $m);
        $categories = json_decode($m[1], true);
        $products = json_decode($m[2], true);

        return [
            'products' => array_column($products, 'name', 'ref'),
            'categories' => array_column($categories, 'path', 'ref'),
        ];
    }

    private function refOf(array $map, string $value): string
    {
        return (string) array_search($value, $map, true);
    }

    public function test_suggests_categories_for_products_without_one_from_refs_only(): void
    {
        $tee = $this->makeProduct($this->t['unit']->id, 'Cotton tee', [['TEE-S', '450.00', ['Size' => 'S']]], [
            'options' => [['name' => 'Size', 'values' => ['S']]],
            'brand_id' => $this->brand($this->t['organization'], 'Aarong'),
        ]);
        $pan = $this->product('Non-stick frying pan');
        $this->product('Already sorted', ['category_id' => $this->kitchen]);
        $this->product('Hidden one', ['is_active' => false]);
        DB::table('products')->where('id', $tee['id'])->update(['created_at' => now()->subHour()]);

        $this->ai->reply(function () {
            $refs = $this->refsSent();

            return ['status' => 'ok', 'data' => ['suggestions' => [
                ['product' => $this->refOf($refs['products'], 'Cotton tee'), 'category' => $this->refOf($refs['categories'], 'Clothing › T-shirts'), 'confidence' => 'high', 'reason' => 'A <b>cotton</b> tee is a **T-shirt**. '.str_repeat('Really a shirt. ', 30)],
                ['product' => $this->refOf($refs['products'], 'Non-stick frying pan'), 'category' => 'none', 'confidence' => 'medium', 'reason' => 'Nothing fits.'],
                ['product' => 'p99', 'category' => 'c1', 'confidence' => 'high', 'reason' => 'Made up'],
            ]]];
        });

        $data = $this->postJson(self::SUGGEST)->assertOk()->json('data');

        $this->assertSame(3, $data['categories_considered']);
        // Newest first; the categorised and the inactive product are left out.
        $this->assertSame([$pan['id'], $tee['id']], array_column(array_column($data['suggestions'], 'product'), 'id'));
        $byName = array_column($data['suggestions'], null, 'reason');
        $teeRow = $data['suggestions'][1];
        $this->assertSame(['id' => $this->tshirts, 'path' => 'Clothing › T-shirts'], $teeRow['category']);
        $this->assertSame('high', $teeRow['confidence']);
        $this->assertLessThanOrEqual(SuggestCategories::MAX_REASON, mb_strlen($teeRow['reason']));
        $this->assertStringStartsWith('A cotton tee is a T-shirt.', $teeRow['reason']);
        $this->assertStringNotContainsString('<', $teeRow['reason']);
        $this->assertNull($data['suggestions'][0]['category']);
        $this->assertSame('low', $data['suggestions'][0]['confidence']);
        $this->assertArrayHasKey('Nothing fits.', $byName);

        // What the model saw: refs, names, brand and options; no ids, prices or inactive categories.
        $call = $this->ai->calls[0];
        $this->assertSame('category_suggestions', $call['feature']);
        $this->assertSame($this->t['admin']->id, $call['user_id']);
        $this->assertSame((string) $this->t['organization']->id, $call['organization_id']);
        $this->assertStringContainsString('Aarong', $call['prompt']);
        $this->assertStringContainsString('"Size"', $call['prompt']);
        foreach ([$tee['id'], $pan['id'], $this->tshirts, $this->clothing, '450', 'Old stuff', 'Already sorted', 'Hidden one'] as $secret) {
            $this->assertStringNotContainsString($secret, $call['prompt'].$call['system']);
        }
        $this->assertSame(['Clothing', 'Clothing › T-shirts', 'Kitchen'], array_values($this->refsSent()['categories']));
        $items = $call['schema']['properties']['suggestions']['items'];
        $this->assertSame(['c1', 'c2', 'c3', 'none'], $items['properties']['category']['enum']);
        $this->assertSame(['p1', 'p2'], $items['properties']['product']['enum']);
        $this->assertFalse($items['additionalProperties']);

        // Nothing changed; the audit keeps counts only.
        $this->assertNull(DB::table('products')->where('id', $tee['id'])->value('category_id'));
        $audit = DB::table('audit_logs')->where('action', 'online_catalog.ai_categories_suggested')->first();
        $this->assertSame(['products' => 2, 'suggested' => 1], json_decode($audit->context, true));
    }

    public function test_chosen_products_and_their_current_category(): void
    {
        $a = $this->product('Steel ladle', ['category_id' => $this->kitchen]);
        $this->product('Other');
        $this->ai->answer(['suggestions' => [['product' => 'p1', 'category' => 'c3', 'confidence' => 'bogus', 'reason' => 'Cooking tool']]]);

        $data = $this->postJson(self::SUGGEST, ['product_ids' => [$a['id']]])->assertOk()->json('data');

        $this->assertCount(1, $data['suggestions']);
        $this->assertSame(['id' => $this->kitchen, 'path' => 'Kitchen'], $data['suggestions'][0]['category']);
        $this->assertSame('low', $data['suggestions'][0]['confidence']);
        $this->assertStringContainsString('"current_category":"c3"', $this->ai->calls[0]['prompt']);
    }

    public function test_nothing_to_suggest_and_errors(): void
    {
        // No product without a category: no model call.
        $this->postJson(self::SUGGEST)->assertOk()->assertJsonPath('data.suggestions', [])->assertJsonPath('data.categories_considered', 3);
        $this->assertSame([], $this->ai->calls);

        $p = $this->product('Mystery box');
        $this->postJson(self::SUGGEST, ['product_ids' => array_fill(0, 21, $p['id'])])->assertUnprocessable();
        $this->postJson(self::SUGGEST, ['product_ids' => [(string) Str::uuid()]])
            ->assertStatus(422)->assertJsonPath('error.code', 'PRODUCT_NOT_FOUND');

        foreach (['disabled', 'budget_exceeded', 'unavailable', 'refused', 'empty', 'invalid'] as $status) {
            $this->ai->status($status);
            $this->postJson(self::SUGGEST)->assertStatus(422)
                ->assertJsonPath('error.code', 'AI_UNAVAILABLE')->assertJsonPath('error.details.reason', $status);
        }
        // An answer that names no known product is not usable.
        $this->ai->answer(['suggestions' => [['product' => 'p7', 'category' => 'c1', 'confidence' => 'high', 'reason' => 'x']]]);
        $this->postJson(self::SUGGEST)->assertStatus(422)->assertJsonPath('error.details.reason', 'empty');
        $this->ai->answer(['nope' => true]);
        $this->postJson(self::SUGGEST)->assertStatus(422)->assertJsonPath('error.details.reason', 'invalid');

        // Too many categories for one call.
        $this->inTenant($this->t['organization'], function () {
            foreach (range(1, SuggestCategories::MAX_CATEGORIES - 2) as $i) {
                Category::query()->create(['name' => "Cat {$i}"]);
            }
        });
        $this->postJson(self::SUGGEST)->assertStatus(422)->assertJsonPath('error.code', 'TOO_MANY_CATEGORIES')
            ->assertJsonPath('error.details.limit', 400)->assertJsonPath('error.details.count', 401);
    }

    public function test_no_categories(): void
    {
        $t = $this->openStore('Empty Shop', 'empty.test');
        $this->makeProduct($t['unit']->id, 'Thing', [['T-1', '10.00']]);
        $this->postJson(self::SUGGEST)->assertStatus(422)->assertJsonPath('error.code', 'NO_CATEGORIES');
    }

    public function test_apply_moves_products_audits_and_skips(): void
    {
        $tee = $this->product('Cotton tee');
        $pan = $this->product('Pan', ['category_id' => $this->kitchen]);
        $inactiveCategory = DB::table('categories')->where('name', 'Old stuff')->value('id');

        $data = $this->postJson(self::APPLY, ['items' => [
            ['product_id' => $tee['id'], 'category_id' => $this->tshirts],
            ['product_id' => $pan['id'], 'category_id' => $this->kitchen],
            ['product_id' => (string) Str::uuid(), 'category_id' => $this->kitchen],
        ]])->assertOk()->json('data');

        $this->assertSame([$tee['id']], $data['applied']);
        $this->assertSame([
            ['product_id' => $pan['id'], 'reason' => 'unchanged'],
            ['product_id' => $data['skipped'][1]['product_id'], 'reason' => 'product_not_found'],
        ], $data['skipped']);
        $this->assertSame($this->tshirts, DB::table('products')->where('id', $tee['id'])->value('category_id'));
        $audit = DB::table('audit_logs')->where('action', 'product.updated')->where('subject_id', $tee['id'])->first();
        $this->assertSame(['category_id' => null], json_decode($audit->old_values, true));
        $this->assertSame(['category_id' => $this->tshirts], json_decode($audit->new_values, true));
        $this->assertSame('ai_category_suggestions', json_decode($audit->context, true)['source']);

        // Inactive or unknown categories are skipped.
        $this->postJson(self::APPLY, ['items' => [['product_id' => $pan['id'], 'category_id' => $inactiveCategory]]])
            ->assertOk()->assertJsonPath('data.skipped.0.reason', 'category_not_found');
        $this->assertSame($this->kitchen, DB::table('products')->where('id', $pan['id'])->value('category_id'));

        $this->postJson(self::APPLY, ['items' => []])->assertUnprocessable();
        $this->postJson(self::APPLY, ['items' => array_fill(0, 21, ['product_id' => $tee['id'], 'category_id' => $this->kitchen])])->assertUnprocessable();
        $this->postJson(self::APPLY, ['items' => [
            ['product_id' => $tee['id'], 'category_id' => $this->kitchen],
            ['product_id' => $tee['id'], 'category_id' => $this->clothing],
        ]])->assertUnprocessable();
    }

    public function test_permissions(): void
    {
        $tee = $this->product('Cotton tee');
        $org = $this->t['organization'];
        $apply = ['items' => [['product_id' => $tee['id'], 'category_id' => $this->tshirts]]];

        // The online store manager may ask but not move products (products.manage).
        $this->actingAsUser($this->createUserWithRole($org, SystemRole::OnlineStoreManager));
        $this->ai->answer(['suggestions' => [['product' => 'p1', 'category' => 'c2', 'confidence' => 'high', 'reason' => 'Tee']]]);
        $this->postJson(self::SUGGEST)->assertOk();
        $this->postJson(self::APPLY, $apply)->assertForbidden();

        // Products staff without the online store cannot use either.
        $this->actingAsUser($this->createUserWithRole($org, SystemRole::InventoryManager));
        $this->postJson(self::SUGGEST)->assertForbidden();
        $this->postJson(self::APPLY, $apply)->assertForbidden();
        $this->assertNull(DB::table('products')->where('id', $tee['id'])->value('category_id'));
        $this->assertCount(1, $this->ai->calls);
    }

    public function test_tenant_isolation(): void
    {
        $ours = $this->product('Cotton tee');
        $other = $this->openStore('Other Shop', 'other.test');
        $theirCategory = $this->category($other['organization'], 'Their T-shirts');
        $theirs = $this->makeProduct($other['unit']->id, 'Their tee', [['THEIR-1', '10.00']]);

        // Signed in as the other shop: our product and category are unknown.
        $this->postJson(self::SUGGEST, ['product_ids' => [$ours['id']]])->assertStatus(422)->assertJsonPath('error.code', 'PRODUCT_NOT_FOUND');
        $this->postJson(self::APPLY, ['items' => [['product_id' => $ours['id'], 'category_id' => $theirCategory]]])
            ->assertOk()->assertJsonPath('data.skipped.0.reason', 'product_not_found');
        $this->postJson(self::APPLY, ['items' => [['product_id' => $theirs['id'], 'category_id' => $this->tshirts]]])
            ->assertOk()->assertJsonPath('data.skipped.0.reason', 'category_not_found');

        // Their model call sees only their products and categories.
        $this->ai->answer(['suggestions' => [['product' => 'p1', 'category' => 'c1', 'confidence' => 'high', 'reason' => 'Tee']]]);
        $data = $this->postJson(self::SUGGEST)->assertOk()->json('data');
        $this->assertSame([$theirs['id']], array_column(array_column($data['suggestions'], 'product'), 'id'));
        $this->assertSame(['id' => $theirCategory, 'path' => 'Their T-shirts'], $data['suggestions'][0]['category']);
        $this->assertStringNotContainsString('Cotton tee', $this->ai->calls[0]['prompt']);
        $this->assertStringNotContainsString('Clothing', $this->ai->calls[0]['prompt']);
        $this->assertNull(DB::table('products')->where('id', $ours['id'])->value('category_id'));
        $this->assertNull(DB::table('products')->where('id', $theirs['id'])->value('category_id'));
    }

    public function test_end_to_end_through_the_ai_module(): void
    {
        // The real Shared AiJsonWriter (gate, budget, usage row) with a scripted model.
        $this->app->forgetInstance(AiJsonWriter::class);
        $fake = $this->fakeAi();
        $this->product('Cotton tee');

        $this->patchJson('/api/v1/ai/settings', ['enabled' => false])->assertOk();
        $this->postJson(self::SUGGEST)->assertStatus(422)->assertJsonPath('error.details.reason', 'disabled');
        $this->patchJson('/api/v1/ai/settings', ['enabled' => true])->assertOk();

        $fake->answerJson(['suggestions' => [['product' => 'p1', 'category' => 'c2', 'confidence' => 'high', 'reason' => 'A tee']]]);
        $this->postJson(self::SUGGEST)->assertOk()->assertJsonPath('data.suggestions.0.category.id', $this->tshirts);
        $this->assertSame('ok', DB::table('ai_requests')->where('feature', 'category_suggestions')->value('status'));
    }
}
