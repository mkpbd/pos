<?php

namespace App\Modules\OnlineCatalog\Tests\Feature;

use App\Modules\AI\Tests\Support\InteractsWithAi;
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
 * AI2a: bundle ideas from the nightly co-purchase scores (live products only, hand-picked pairs
 * left out, top 3), describing a bundle with AI (names and categories only, Bangla when the
 * store offers it, clamped) and adding a bundle to "frequently bought together" through
 * SaveRelatedProducts; permissions and tenant isolation.
 */
class BundleIdeasTest extends TestCase
{
    use BuildsOnlineCatalog, InteractsWithAi, InteractsWithTenancy, RefreshDatabase;

    private const IDEAS = '/api/v1/online-catalog/bundle-ideas';

    private const DESCRIBE = '/api/v1/online-catalog/bundle-ideas/describe';

    private const APPLY = '/api/v1/online-catalog/bundle-ideas/apply';

    /** @var array<string, mixed> */
    private array $t;

    private ScriptedAiJsonWriter $ai;

    /** @var array<string, string> name => product id */
    private array $p = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->ai = new ScriptedAiJsonWriter;
        $this->app->instance(AiJsonWriter::class, $this->ai);
        $this->t = $this->openStore('Berry Kids', 'berry.test');
        $toys = $this->category($this->t['organization'], 'Toys');
        $blocks = $this->category($this->t['organization'], 'Blocks', $toys);
        foreach (['Rattle', 'Bib', 'Bottle', 'Blanket', 'Socks', 'Lego set', 'Draft only'] as $i => $name) {
            $product = $this->makeProduct($this->t['unit']->id, $name, [['SKU-'.$i, '777.00']], $name === 'Lego set' ? ['category_id' => $blocks] : []);
            $this->p[$name] = $product['id'];
            if ($name !== 'Draft only') {
                $this->publish($product['id']);
            }
        }
    }

    /**
     * Co-purchase scores as the nightly run stores them (both directions) and the run.
     *
     * @param  list<array{0: string, 1: string, 2: int}>  $pairs  names and score
     */
    private function affinities(array $pairs, ?string $organizationId = null, ?array $ids = null): void
    {
        $org = $organizationId ?? $this->t['organization']->id;
        $ids ??= $this->p;
        foreach ($pairs as [$a, $b, $score]) {
            foreach ([[$a, $b], [$b, $a]] as [$x, $y]) {
                DB::table('product_affinities')->insert(['organization_id' => $org, 'product_id' => $ids[$x], 'related_product_id' => $ids[$y], 'score' => $score, 'computed_at' => now()]);
            }
        }
        DB::table('product_affinity_runs')->upsert([['organization_id' => $org, 'local_date' => '2026-11-19', 'pairs' => count($pairs) * 2, 'computed_at' => now()]], ['organization_id'], ['local_date', 'pairs', 'computed_at']);
    }

    /**
     * @param  array<string, mixed>  $item
     * @return list<string>
     */
    private function names(array $item): array
    {
        return array_column($item['products'], 'name');
    }

    public function test_empty_before_the_nightly_run(): void
    {
        $this->getJson(self::IDEAS)->assertOk()
            ->assertJsonPath('data', [])
            ->assertJsonPath('meta.last_run', null)
            ->assertJsonPath('meta.pagination.total', 0);
    }

    public function test_ideas_from_co_purchases(): void
    {
        $this->affinities([
            ['Rattle', 'Bib', 5], ['Rattle', 'Bottle', 4], ['Rattle', 'Blanket', 3], ['Rattle', 'Socks', 2],
            ['Rattle', 'Draft only', 9], ['Lego set', 'Socks', 7],
        ]);
        // Bib is already hand-picked for Rattle; Socks is archived later.
        $this->putJson("/api/v1/online-catalog/products/{$this->p['Rattle']}/related", ['related' => [], 'frequently_bought' => [$this->p['Bib']]])->assertOk();

        $response = $this->getJson(self::IDEAS)->assertOk();
        $this->assertSame('2026-11-19', $response->json('meta.last_run'));
        $this->assertNotNull($response->json('meta.computed_at'));
        $data = $response->json('data');

        // Ordered by the best pair's score, then name: Lego set (7), Socks (7), Bib (5), Bottle (4), Rattle (4: Bib is picked)…
        $anchors = array_column(array_column($data, 'anchor'), 'name');
        $this->assertSame('Lego set', $anchors[0]);
        $rattle = $data[array_search('Rattle', $anchors, true)];
        $this->assertSame(['Bottle', 'Blanket', 'Socks'], $this->names($rattle));
        $this->assertSame(['id' => $this->p['Bottle'], 'name' => 'Bottle', 'image_url' => null, 'score' => 4, 'orders_together' => 4], $rattle['products'][0]);
        $this->assertSame(1, $rattle['frequently_bought_count']);
        // The draft (unpublished) product is never an anchor or a partner.
        $this->assertNotContains('Draft only', $anchors);
        $this->assertSame(['Rattle'], $this->names($data[array_search('Bottle', $anchors, true)]));
        $this->assertSame(['Lego set', 'Socks', 'Bib', 'Bottle', 'Rattle', 'Blanket'], $anchors);
        $this->assertSame(6, $response->json('meta.pagination.total'));

        $this->getJson(self::IDEAS.'?search=lEGo')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.anchor.name', 'Lego set');

        // An archived product drops out.
        $this->deleteJson("/api/v1/products/{$this->p['Socks']}")->assertSuccessful();
        $data = $this->getJson(self::IDEAS)->assertOk()->json('data');
        $anchors = array_column(array_column($data, 'anchor'), 'name');
        $this->assertNotContains('Socks', $anchors);
        $this->assertNotContains('Lego set', $anchors);
    }

    public function test_describe_with_ai(): void
    {
        $this->ai->answer([
            'title' => '**Lego** & <i>rattle</i> playtime pack — '.str_repeat('fun ', 30),
            'pitch' => 'Build and shake.',
            'bn' => ['title' => 'খেলার সেট', 'pitch' => 'একসাথে কিনুন।'],
        ]);

        $data = $this->postJson(self::DESCRIBE, ['anchor_id' => $this->p['Lego set'], 'product_ids' => [$this->p['Rattle']]])->assertOk()->json('data');

        $this->assertLessThanOrEqual(60, mb_strlen($data['title']));
        $this->assertStringStartsWith('Lego & rattle playtime pack', $data['title']);
        $this->assertStringEndsNotWith(' ', $data['title']);
        $this->assertSame('Build and shake.', $data['pitch']);
        $this->assertSame(['bn' => ['title' => 'খেলার সেট', 'pitch' => 'একসাথে কিনুন।']], $data['translations']);

        $call = $this->ai->calls[0];
        $this->assertSame('bundle_ideas', $call['feature']);
        $this->assertStringContainsString('"name":"Lego set","category":"Toys › Blocks"', $call['prompt']);
        $this->assertStringContainsString('Rattle', $call['prompt']);
        foreach (['777', $this->p['Lego set'], $this->p['Rattle']] as $secret) {
            $this->assertStringNotContainsString($secret, $call['prompt'].$call['system']);
        }
        $this->assertSame(['title', 'pitch', 'bn'], $call['schema']['required']);
        $this->assertTrue(DB::table('audit_logs')->where('action', 'online_catalog.ai_bundle_described')->exists());
        $this->assertSame(0, DB::table('related_products')->count());

        // Bangla off: English only.
        $this->patchJson('/api/v1/storefront/settings', ['bangla_enabled' => false])->assertOk();
        $this->ai->answer(['title' => 'Play pack', 'pitch' => 'Together.']);
        $this->postJson(self::DESCRIBE, ['anchor_id' => $this->p['Lego set'], 'product_ids' => [$this->p['Rattle']]])
            ->assertOk()->assertJsonPath('data', ['title' => 'Play pack', 'pitch' => 'Together.', 'translations' => []]);
        $this->assertSame(['title', 'pitch'], $this->ai->calls[1]['schema']['required']);
        $this->assertStringNotContainsString('"bn"', $this->ai->calls[1]['system']);
    }

    public function test_describe_errors(): void
    {
        $this->postJson(self::DESCRIBE, ['anchor_id' => (string) Str::uuid(), 'product_ids' => [$this->p['Rattle']]])->assertNotFound();
        $this->postJson(self::DESCRIBE, ['anchor_id' => $this->p['Rattle'], 'product_ids' => [(string) Str::uuid()]])
            ->assertStatus(422)->assertJsonPath('error.code', 'PRODUCT_NOT_FOUND');
        $this->postJson(self::DESCRIBE, ['anchor_id' => $this->p['Rattle'], 'product_ids' => [$this->p['Rattle']]])->assertUnprocessable();
        $this->postJson(self::DESCRIBE, ['anchor_id' => $this->p['Rattle'], 'product_ids' => [$this->p['Bib'], $this->p['Bottle'], $this->p['Socks'], $this->p['Blanket']]])->assertUnprocessable();
        $this->assertSame([], $this->ai->calls);

        foreach (['disabled', 'budget_exceeded', 'refused', 'invalid'] as $status) {
            $this->ai->status($status);
            $this->postJson(self::DESCRIBE, ['anchor_id' => $this->p['Rattle'], 'product_ids' => [$this->p['Bib']]])
                ->assertStatus(422)->assertJsonPath('error.code', 'AI_UNAVAILABLE')->assertJsonPath('error.details.reason', $status);
        }
        $this->ai->answer(['title' => '  ', 'pitch' => 'x', 'bn' => ['title' => '', 'pitch' => '']]);
        $this->postJson(self::DESCRIBE, ['anchor_id' => $this->p['Rattle'], 'product_ids' => [$this->p['Bib']]])
            ->assertStatus(422)->assertJsonPath('error.details.reason', 'empty');
    }

    public function test_add_to_frequently_bought_together(): void
    {
        $rattle = $this->p['Rattle'];
        $this->putJson("/api/v1/online-catalog/products/{$rattle}/related", ['related' => [$this->p['Socks']], 'frequently_bought' => [$this->p['Bib']]])->assertOk();

        $data = $this->postJson(self::APPLY, ['anchor_id' => $rattle, 'product_ids' => [$this->p['Bib'], $this->p['Bottle'], $this->p['Blanket']]])->assertOk()->json('data');

        $this->assertSame($rattle, $data['anchor_id']);
        $this->assertSame([$this->p['Bottle'], $this->p['Blanket']], $data['added']);
        $this->assertSame(['Bib', 'Bottle', 'Blanket'], array_column($data['frequently_bought'], 'name'));
        // The "related" list is kept.
        $this->assertSame([$this->p['Socks']], DB::table('related_products')->where('product_id', $rattle)->where('kind', 'related')->pluck('related_product_id')->all());
        $this->assertTrue(DB::table('audit_logs')->where('action', 'online_catalog.related_products.saved')->exists());

        // Nothing new: nothing changes.
        $this->postJson(self::APPLY, ['anchor_id' => $rattle, 'product_ids' => [$this->p['Bib']]])->assertOk()->assertJsonPath('data.added', []);

        // Errors.
        $this->postJson(self::APPLY, ['anchor_id' => $rattle, 'product_ids' => [$rattle]])->assertUnprocessable();
        $this->postJson(self::APPLY, ['anchor_id' => (string) Str::uuid(), 'product_ids' => [$this->p['Bib']]])->assertNotFound();
        $this->postJson(self::APPLY, ['anchor_id' => $rattle, 'product_ids' => [(string) Str::uuid()]])
            ->assertStatus(422)->assertJsonPath('error.code', 'PRODUCT_NOT_FOUND');

        // At most 12 picks.
        $more = [];
        foreach (range(1, 10) as $i) {
            $more[] = $this->makeProduct($this->t['unit']->id, "Extra {$i}", [['EXTRA-'.$i, '5.00']])['id'];
        }
        $this->postJson(self::APPLY, ['anchor_id' => $rattle, 'product_ids' => $more])
            ->assertStatus(422)->assertJsonPath('error.code', 'TOO_MANY_PICKS')->assertJsonPath('error.details.room', 9);
        $this->postJson(self::APPLY, ['anchor_id' => $rattle, 'product_ids' => array_slice($more, 0, 9)])->assertOk()->assertJsonCount(12, 'data.frequently_bought');
    }

    public function test_permissions_and_isolation(): void
    {
        $this->affinities([['Rattle', 'Bib', 5]]);
        $org = $this->t['organization'];

        $this->actingAsUser($this->createUserWithRole($org, SystemRole::Cashier));
        $this->getJson(self::IDEAS)->assertForbidden();
        $this->postJson(self::DESCRIBE, ['anchor_id' => $this->p['Rattle'], 'product_ids' => [$this->p['Bib']]])->assertForbidden();
        $this->postJson(self::APPLY, ['anchor_id' => $this->p['Rattle'], 'product_ids' => [$this->p['Bib']]])->assertForbidden();

        $this->actingAsUser($this->createUserWithRole($org, SystemRole::OnlineStoreManager));
        $this->getJson(self::IDEAS)->assertOk()->assertJsonCount(2, 'data');
        $this->postJson(self::APPLY, ['anchor_id' => $this->p['Rattle'], 'product_ids' => [$this->p['Bib']]])->assertOk();
        // Now hand-picked: the Rattle → Bib idea is gone, Bib → Rattle stays.
        $this->getJson(self::IDEAS)->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.anchor.name', 'Bib');

        // Another shop sees none of it and cannot touch our products.
        $other = $this->openStore('Other Shop', 'other.test');
        $theirs = $this->makeProduct($other['unit']->id, 'Their thing', [['THEIR-1', '10.00']]);
        $this->getJson(self::IDEAS)->assertOk()->assertJsonPath('data', [])->assertJsonPath('meta.last_run', null);
        $this->postJson(self::DESCRIBE, ['anchor_id' => $this->p['Rattle'], 'product_ids' => [$this->p['Bib']]])->assertNotFound();
        $this->postJson(self::DESCRIBE, ['anchor_id' => $theirs['id'], 'product_ids' => [$this->p['Bib']]])
            ->assertStatus(422)->assertJsonPath('error.code', 'PRODUCT_NOT_FOUND');
        $this->postJson(self::APPLY, ['anchor_id' => $this->p['Rattle'], 'product_ids' => [$theirs['id']]])->assertNotFound();
        $this->postJson(self::APPLY, ['anchor_id' => $theirs['id'], 'product_ids' => [$this->p['Bib']]])
            ->assertStatus(422)->assertJsonPath('error.code', 'PRODUCT_NOT_FOUND');
        $this->assertSame([], $this->ai->calls);
    }

    public function test_describe_end_to_end_through_the_ai_module(): void
    {
        $this->app->forgetInstance(AiJsonWriter::class);
        $fake = $this->fakeAi();
        $this->patchJson('/api/v1/ai/settings', ['enabled' => true])->assertOk();
        $fake->answerJson(['title' => 'Baby basics', 'pitch' => 'Everything for bath time.', 'bn' => ['title' => 'শিশুর সেট', 'pitch' => 'স্নানের সময়ের জন্য।']]);

        $this->postJson(self::DESCRIBE, ['anchor_id' => $this->p['Rattle'], 'product_ids' => [$this->p['Bib']]])
            ->assertOk()->assertJsonPath('data.title', 'Baby basics')->assertJsonPath('data.translations.bn.title', 'শিশুর সেট');
        $this->assertSame('ok', DB::table('ai_requests')->where('feature', 'bundle_ideas')->value('status'));
    }
}
