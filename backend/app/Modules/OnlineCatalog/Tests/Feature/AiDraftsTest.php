<?php

namespace App\Modules\OnlineCatalog\Tests\Feature;

use App\Modules\AI\Domain\Llm\StopReason;
use App\Modules\AI\Domain\Llm\TextBlock;
use App\Modules\AI\Infrastructure\Providers\FakeLanguageModel;
use App\Modules\AI\Tests\Support\InteractsWithAi;
use App\Modules\OnlineCatalog\Infrastructure\Jobs\WriteAiDrafts;
use App\Modules\OnlineCatalog\Infrastructure\Models\AiContentBatch;
use App\Modules\OnlineCatalog\Infrastructure\Models\AiContentDraft;
use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Infrastructure\Models\Role;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * AI2a §2: AI drafts — batches (chosen subjects or the ones lacking texts, limits, one at a time,
 * abandoned batches, AI off), the queued writer (one call per subject, failures, budget stop,
 * cancel), review (approve only the given fields through the listing save, never publishing,
 * stale detection and force, reject, bulk approve), pruning, permissions and isolation.
 */
class AiDraftsTest extends TestCase
{
    use BuildsOnlineCatalog, InteractsWithAi, InteractsWithTenancy, RefreshDatabase;

    private const BATCHES = '/api/v1/online-catalog/ai/batches';

    private const DRAFTS = '/api/v1/online-catalog/ai/drafts';

    /** @var array<string, mixed> */
    private array $t;

    private string $tee;

    private string $cap;

    protected function setUp(): void
    {
        parent::setUp();
        $this->t = $this->openStore('Berry Kids', 'berry.test');
        $this->tee = $this->makeProduct($this->t['unit']->id, 'Kids Tee', [['TEE', '450.00']])['id'];
        $this->publish($this->tee, ['short_description' => 'A tee.', 'seo_title' => 'Kids Tee']);
        $this->cap = $this->makeProduct($this->t['unit']->id, 'Sun Cap', [['CAP', '250.00']])['id'];
    }

    /**
     * @return array<string, mixed>
     */
    private function answer(string $name, array $languages = ['en']): array
    {
        $result = ['missing_info' => ['material']];
        foreach ($languages as $language) {
            $result[$language] = [
                'short_description' => "{$language}: short about {$name}.",
                'description' => ['paragraphs' => ["{$language}: all about {$name}."], 'bullets' => ['Soft']],
            ];
        }

        return $result;
    }

    private function start(array $body = []): TestResponse
    {
        return $this->postJson(self::BATCHES, $body + [
            'subject' => 'product',
            'ids' => [$this->tee, $this->cap],
            'fields' => ['short_description', 'description'],
            'languages' => ['en'],
            'tone' => 'friendly',
            'length' => 'short',
        ]);
    }

    /**
     * @return array<string, array<string, mixed>> drafts keyed by "<subject name>/<language>"
     */
    private function drafts(string $query = ''): array
    {
        $result = [];
        foreach ($this->getJson(self::DRAFTS.'?per_page=100'.$query)->assertOk()->json('data') as $draft) {
            $result[$draft['subject_name'].'/'.$draft['language']] = $draft;
        }

        return $result;
    }

    public function test_a_batch_writes_drafts_that_staff_approve_field_by_field(): void
    {
        $fake = $this->fakeAi()->answerJson($this->answer('Kids Tee', ['en', 'bn']))->answerJson($this->answer('Sun Cap', ['en', 'bn']));

        // The queue runs synchronously in tests: the drafts are written before the response.
        $batch = $this->start(['languages' => ['en', 'bn'], 'notes' => 'For summer.'])->assertCreated()
            ->assertJsonPath('data.subject', 'product')
            ->assertJsonPath('data.criteria', ['missing' => null, 'ids' => [$this->tee, $this->cap]])
            ->assertJsonPath('data.status', 'done')
            ->assertJsonPath('data.total', 2)
            ->assertJsonPath('data.done', 2)
            ->assertJsonPath('data.failed', 0)
            ->assertJsonPath('data.progress_percent', 100)
            ->assertJsonPath('data.drafts.pending', 4)
            ->json('data');
        $this->assertSame(2, $fake->callCount());
        $this->assertStringContainsString('For summer.', $fake->requests[0]['conversation']->messages[0]->text());
        $this->assertSame(2, DB::table('ai_requests')->where('feature', 'catalog_drafts')->count());
        $this->getJson(self::BATCHES.'/'.$batch['id'])->assertOk()->assertJsonPath('data.drafts.pending', 4);
        $this->getJson(self::BATCHES)->assertOk()->assertJsonPath('data.0.id', $batch['id'])->assertJsonPath('meta.pagination.total', 1);

        $drafts = $this->drafts('&batch_id='.$batch['id']);
        $this->assertCount(4, $drafts);
        $tee = $drafts['Kids Tee/en'];
        $this->assertSame(['product', $this->tee, 'pending', false], [$tee['subject'], $tee['subject_id'], $tee['status'], $tee['stale']]);
        $this->assertSame(['proposed' => 'en: short about Kids Tee.', 'current' => 'A tee.', 'changed' => false], $tee['fields']['short_description']);
        $this->assertSame(['proposed' => '<p>en: all about Kids Tee.</p><ul><li>Soft</li></ul>', 'current' => null, 'changed' => false], $tee['fields']['description']);
        $this->assertSame(['material'], $tee['missing_info']);
        $this->assertCount(2, $this->drafts('&search=sun'));
        $this->assertCount(2, $this->drafts('&search=SUN%20C'));

        // Approve the English draft: only the given field, edited by staff; the rest stays.
        $this->postJson(self::DRAFTS."/{$tee['id']}/approve", ['fields' => ['description' => '<p>Edited by staff.</p><script>alert(1)</script>']])->assertOk()
            ->assertJsonPath('data.status', 'approved')
            ->assertJsonPath('data.reviewed_by', $this->t['admin']->id);
        $this->getJson("/api/v1/online-catalog/products/{$this->tee}")->assertOk()
            ->assertJsonPath('data.listing.description_html', '<p>Edited by staff.</p>')
            ->assertJsonPath('data.listing.short_description', 'A tee.')
            ->assertJsonPath('data.listing.is_published', true);
        $this->postJson(self::DRAFTS."/{$tee['id']}/approve", ['fields' => ['description' => 'Again']])->assertStatus(409)->assertJsonPath('error.code', 'DRAFT_NOT_PENDING');

        // Bangla goes to the translation; a product never listed gets a listing that is not published.
        $this->postJson(self::DRAFTS."/{$drafts['Sun Cap/bn']['id']}/approve", ['fields' => ['short_description' => $drafts['Sun Cap/bn']['fields']['short_description']['proposed']]])->assertOk();
        $cap = $this->getJson("/api/v1/online-catalog/products/{$this->cap}")->assertOk();
        $cap->assertJsonPath('data.listing.exists', true)
            ->assertJsonPath('data.listing.is_published', false)
            ->assertJsonPath('data.listing.short_description', null)
            ->assertJsonPath('data.listing.translations.bn.short_description', 'bn: short about Sun Cap.');

        // Validation: only the draft's fields, within the listing's limits.
        $this->postJson(self::DRAFTS."/{$drafts['Sun Cap/en']['id']}/approve", ['fields' => ['seo_title' => 'Nope']])->assertUnprocessable()->assertJsonValidationErrors('fields', 'error.details');
        $this->postJson(self::DRAFTS."/{$drafts['Sun Cap/en']['id']}/approve", ['fields' => ['short_description' => str_repeat('a', 501)]])->assertUnprocessable()->assertJsonValidationErrors('fields.short_description', 'error.details');
        $this->postJson(self::DRAFTS."/{$drafts['Sun Cap/en']['id']}/approve", ['fields' => []])->assertUnprocessable();

        // Stale: the text changed after the draft was written → 409 unless forced.
        $this->putJson("/api/v1/online-catalog/products/{$this->cap}", ['is_published' => false, 'is_featured' => false, 'short_description' => 'Typed by hand.'])->assertOk();
        $this->assertTrue($this->drafts()['Sun Cap/en']['stale']);
        $this->assertSame('Typed by hand.', $this->drafts()['Sun Cap/en']['fields']['short_description']['current']);
        $this->postJson(self::DRAFTS."/{$drafts['Sun Cap/en']['id']}/approve", ['fields' => ['short_description' => 'AI text', 'description' => '<p>AI</p>']])
            ->assertStatus(409)->assertJsonPath('error.code', 'DRAFT_STALE')->assertJsonPath('error.details.fields', ['short_description']);
        $this->postJson(self::DRAFTS."/{$drafts['Sun Cap/en']['id']}/approve", ['fields' => ['short_description' => 'AI text'], 'force' => true])->assertOk();
        $this->getJson("/api/v1/online-catalog/products/{$this->cap}")->assertJsonPath('data.listing.short_description', 'AI text');

        // Reject.
        $this->postJson(self::DRAFTS."/{$drafts['Kids Tee/bn']['id']}/reject")->assertOk()->assertJsonPath('data.status', 'rejected');
        $this->postJson(self::DRAFTS."/{$drafts['Kids Tee/bn']['id']}/reject")->assertStatus(409);
        $this->getJson(self::BATCHES.'/'.$batch['id'])->assertJsonPath('data.drafts', ['pending' => 0, 'approved' => 3, 'rejected' => 1, 'failed' => 0, 'stale' => 0]);
        $this->assertCount(1, $this->drafts('&status=rejected'));

        // Audited without texts.
        $this->assertSame(3, DB::table('audit_logs')->where('action', 'online_catalog.ai_draft_approved')->count());
        $this->assertStringNotContainsString('about Sun Cap', (string) json_encode(DB::table('audit_logs')->where('action', 'like', 'online_catalog.ai_%')->get()));
    }

    public function test_approving_category_and_brand_drafts_never_shows_them(): void
    {
        $this->fakeAi();
        $kids = $this->category($this->t['organization'], 'Kids');
        $brand = $this->brand($this->t['organization'], 'Aarong');

        $this->start(['subject' => 'category', 'ids' => [$kids], 'fields' => ['description', 'seo_title']])->assertCreated()->assertJsonPath('data.fields', ['description', 'seo_title']);
        $this->start(['subject' => 'brand', 'ids' => [$brand], 'fields' => ['description']])->assertCreated();
        $drafts = $this->drafts();

        $this->postJson(self::DRAFTS."/{$drafts['Kids/en']['id']}/approve", ['fields' => ['seo_title' => 'Kids clothing']])->assertOk();
        $this->getJson("/api/v1/online-catalog/categories/{$kids}")->assertOk()
            ->assertJsonPath('data.listing.exists', true)
            ->assertJsonPath('data.listing.is_visible', false)
            ->assertJsonPath('data.listing.seo_title', 'Kids clothing')
            ->assertJsonPath('data.listing.description_html', null);

        $this->assertSame("Sample paragraphs\n\n• Sample bullets", $drafts['Aarong/en']['fields']['description']['proposed']);
        $this->postJson(self::DRAFTS.'/approve-many', ['ids' => [$drafts['Aarong/en']['id']]])->assertOk()->assertJsonPath('data.approved', [$drafts['Aarong/en']['id']]);
        $this->getJson("/api/v1/online-catalog/brands/{$brand}")->assertOk()
            ->assertJsonPath('data.listing.is_visible', false)
            ->assertJsonPath('data.listing.description', "Sample paragraphs\n\n• Sample bullets");

        // An existing visible listing stays visible.
        $this->listCategory($kids, ['is_visible' => true]);
        $this->start(['subject' => 'category', 'ids' => [$kids], 'fields' => ['seo_description']])->assertCreated();
        $draft = collect($this->getJson(self::DRAFTS.'?status=pending')->json('data'))->firstWhere('subject_id', $kids);
        $this->postJson(self::DRAFTS."/{$draft['id']}/approve", ['fields' => ['seo_description' => 'Clothes for kids.']])->assertOk();
        $this->getJson("/api/v1/online-catalog/categories/{$kids}")->assertJsonPath('data.listing.is_visible', true)->assertJsonPath('data.listing.seo_description', 'Clothes for kids.');
    }

    public function test_batches_by_missing_texts_and_their_limits(): void
    {
        $this->start()->assertUnprocessable()->assertJsonPath('error.code', 'AI_UNAVAILABLE')->assertJsonPath('error.details.reason', 'disabled');
        $fake = $this->fakeAi();

        // Validation and limits.
        $this->start(['missing' => ['description']])->assertUnprocessable()->assertJsonValidationErrors('ids', 'error.details');
        $this->postJson(self::BATCHES, ['subject' => 'product', 'fields' => ['description'], 'languages' => ['en']])->assertUnprocessable()->assertJsonValidationErrors(['ids', 'missing'], 'error.details');
        $this->start(['ids' => array_map(fn () => (string) Str::uuid(), range(1, 201))])
            ->assertUnprocessable()->assertJsonPath('error.code', 'BATCH_TOO_LARGE')->assertJsonPath('error.details.limit', 200);
        $this->start(['ids' => [(string) Str::uuid()]])->assertNotFound();
        $this->start(['subject' => 'brand', 'ids' => [$this->tee], 'fields' => ['short_description']])->assertUnprocessable()->assertJsonPath('error.code', 'NOTHING_TO_WRITE');

        // Missing descriptions: both products (the Tee has a short description but no description).
        $this->postJson(self::BATCHES, ['subject' => 'product', 'missing' => ['description'], 'fields' => ['description'], 'languages' => ['en']])->assertCreated()
            ->assertJsonPath('data.criteria', ['missing' => ['description'], 'ids' => [$this->tee, $this->cap]])
            ->assertJsonPath('data.status', 'done');
        // Subjects with drafts waiting for review are not picked again.
        $this->postJson(self::BATCHES, ['subject' => 'product', 'missing' => ['description'], 'fields' => ['description'], 'languages' => ['en']])
            ->assertUnprocessable()->assertJsonPath('error.code', 'NOTHING_TO_WRITE');
        // SEO: the Tee has an SEO title but no SEO description; Bangla: neither has Bangla texts.
        AiContentDraft::query()->update(['status' => 'rejected']);
        $this->postJson(self::BATCHES, ['subject' => 'product', 'missing' => ['seo'], 'fields' => ['seo_title'], 'languages' => ['en']])->assertCreated()
            ->assertJsonPath('data.total', 2);
        AiContentDraft::query()->update(['status' => 'rejected']);
        $this->putJson("/api/v1/online-catalog/products/{$this->tee}", ['is_published' => true, 'is_featured' => false, 'translations' => ['bn' => ['seo_title' => 'টি']]])->assertOk();
        $this->postJson(self::BATCHES, ['subject' => 'product', 'missing' => ['bangla'], 'fields' => ['seo_title'], 'languages' => ['en', 'bn']])->assertCreated()
            ->assertJsonPath('data.criteria.ids', [$this->cap]);
        $this->postJson(self::BATCHES, ['subject' => 'product', 'missing' => ['bangla'], 'fields' => ['seo_title'], 'languages' => ['en']])
            ->assertUnprocessable()->assertJsonPath('error.code', 'NOTHING_TO_WRITE');
        $this->assertSame(5, $fake->callCount());

        // One batch at a time; a batch without progress for an hour no longer blocks.
        $running = AiContentBatch::query()->create([
            'organization_id' => $this->t['organization']->id, 'subject' => 'product', 'criteria' => ['missing' => null, 'ids' => [$this->tee]], 'fields' => ['description'], 'languages' => ['en'],
            'tone' => 'friendly', 'length' => 'short', 'total' => 1, 'status' => 'running',
        ]);
        $this->start()->assertStatus(409)->assertJsonPath('error.code', 'BATCH_RUNNING')->assertJsonPath('error.details.batch_id', $running->id);
        AiContentBatch::query()->whereKey($running->id)->update(['updated_at' => now()->subMinutes(61)]);
        $this->start()->assertCreated()->assertJsonPath('data.status', 'done');
        $this->assertSame('cancelled', $running->fresh()->status);
    }

    public function test_failures_budget_stop_and_cancel(): void
    {
        $products = [$this->tee, $this->cap];
        foreach (['Bag', 'Shoe', 'Sock'] as $name) {
            $products[] = $this->makeProduct($this->t['unit']->id, $name, [[strtoupper($name), '10.00']])['id'];
        }
        $this->fakeAi()
            ->answerJson($this->answer('Kids Tee'))
            ->fail()
            ->refuse()
            ->answerJson($this->answer('Bag'));
        // 120 + 0 + 50 tokens are below the budget, the fourth call crosses it, the fifth is refused.
        $this->patchJson('/api/v1/ai/settings', ['monthly_token_budget' => 250])->assertOk();

        $batch = $this->start(['ids' => $products])->assertCreated()
            ->assertJsonPath('data.status', 'budget_stopped')
            ->assertJsonPath('data.done', 2)
            ->assertJsonPath('data.failed', 2)
            ->assertJsonPath('data.progress_percent', 80)
            ->assertJsonPath('data.drafts', ['pending' => 2, 'approved' => 0, 'rejected' => 0, 'failed' => 2, 'stale' => 0])
            ->json('data');
        $failed = $this->drafts('&status=failed');
        $this->assertSame(['unavailable', 'refused'], [$failed['Sun Cap/en']['error'], $failed['Bag/en']['error']]);
        $this->postJson(self::DRAFTS."/{$failed['Bag/en']['id']}/approve", ['fields' => ['description' => 'x']])->assertStatus(409)->assertJsonPath('error.code', 'DRAFT_NOT_PENDING');
        $this->postJson(self::BATCHES."/{$batch['id']}/cancel")->assertStatus(409)->assertJsonPath('error.code', 'BATCH_NOT_RUNNING');

        // Cancelled while writing: the subject being written finishes, the rest are not started.
        $this->patchJson('/api/v1/ai/settings', ['monthly_token_budget' => 0])->assertOk();
        $fake = $this->fakeAi()->reply(function () {
            AiContentBatch::query()->where('status', 'running')->update(['status' => 'cancelled']);

            return FakeLanguageModel::completion([new TextBlock((string) json_encode($this->answer('Kids Tee')))], StopReason::EndTurn, 10, 10);
        });
        $this->start(['ids' => $products])->assertCreated()->assertJsonPath('data.status', 'cancelled')->assertJsonPath('data.done', 1);
        $this->assertSame(1, $fake->callCount());

        // Cancel through the API before the worker starts.
        $queued = AiContentBatch::query()->create([
            'organization_id' => $this->t['organization']->id, 'subject' => 'product', 'criteria' => ['missing' => null, 'ids' => [$this->tee]], 'fields' => ['description'], 'languages' => ['en'],
            'tone' => 'friendly', 'length' => 'short', 'total' => 1, 'status' => 'queued',
        ]);
        $this->postJson(self::BATCHES."/{$queued->id}/cancel")->assertOk()->assertJsonPath('data.status', 'cancelled');
        (new WriteAiDrafts($queued->id))->handle(app(TenantContext::class));
        $this->assertSame(1, $fake->callCount());
        $this->assertSame(0, $queued->drafts()->count());
    }

    public function test_bulk_approval_skips_stale_and_reviewed_drafts(): void
    {
        $this->fakeAi()->answerJson($this->answer('Kids Tee'))->answerJson($this->answer('Sun Cap'));
        $this->start()->assertCreated();
        $drafts = $this->drafts();
        $this->putJson("/api/v1/online-catalog/products/{$this->tee}", ['is_published' => true, 'is_featured' => false, 'short_description' => 'Changed.'])->assertOk();
        $missing = (string) Str::uuid();

        $this->postJson(self::DRAFTS.'/approve-many', ['ids' => [$drafts['Kids Tee/en']['id'], $drafts['Sun Cap/en']['id'], $missing]])->assertOk()
            ->assertJsonPath('data.approved', [$drafts['Sun Cap/en']['id']])
            ->assertJsonPath('data.skipped', [
                ['id' => $drafts['Kids Tee/en']['id'], 'reason' => 'stale'],
                ['id' => $missing, 'reason' => 'not_found'],
            ]);
        $this->getJson("/api/v1/online-catalog/products/{$this->cap}")
            ->assertJsonPath('data.listing.short_description', 'en: short about Sun Cap.')
            ->assertJsonPath('data.listing.description_html', '<p>en: all about Sun Cap.</p><ul><li>Soft</li></ul>')
            ->assertJsonPath('data.listing.is_published', false);
        $this->assertSame('stale', $this->drafts('&status=stale')['Kids Tee/en']['status']);
        $this->getJson("/api/v1/online-catalog/products/{$this->tee}")->assertJsonPath('data.listing.short_description', 'Changed.');

        $this->postJson(self::DRAFTS.'/approve-many', ['ids' => [$drafts['Sun Cap/en']['id']]])->assertOk()
            ->assertJsonPath('data.skipped.0.reason', 'not_pending');
        $this->postJson(self::DRAFTS.'/approve-many', ['ids' => array_map(fn () => (string) Str::uuid(), range(1, 101))])->assertUnprocessable();
        // A stale draft can still be approved on purpose.
        $this->postJson(self::DRAFTS."/{$drafts['Kids Tee/en']['id']}/approve", ['fields' => ['short_description' => 'Chosen.'], 'force' => true])->assertOk();
    }

    public function test_permissions_and_isolation(): void
    {
        $this->fakeAi();
        $batch = $this->start()->assertCreated()->json('data');
        $draft = $this->drafts()['Kids Tee/en'];

        $viewer = $this->createUserWithRole($this->t['organization'], $this->inTenant($this->t['organization'], function () {
            $role = Role::query()->create(['name' => 'Viewer '.Str::random(4)]);
            $role->permissions()->sync(['online_catalog.view']);

            return $role;
        }));
        $this->actingAsUser($viewer);
        $this->getJson(self::DRAFTS)->assertOk();
        $this->getJson(self::BATCHES."/{$batch['id']}")->assertOk();
        $this->start()->assertForbidden();
        $this->postJson(self::DRAFTS."/{$draft['id']}/approve", ['fields' => ['description' => 'x']])->assertForbidden();
        $this->postJson(self::DRAFTS."/{$draft['id']}/reject")->assertForbidden();
        $this->postJson(self::DRAFTS.'/approve-many', ['ids' => [$draft['id']]])->assertForbidden();
        $this->postJson(self::BATCHES."/{$batch['id']}/cancel")->assertForbidden();

        // Another store sees nothing and cannot touch them.
        $other = $this->openStore('Tiny Toes', 'tiny.test');
        $this->getJson(self::DRAFTS)->assertOk()->assertJsonCount(0, 'data');
        $this->getJson(self::BATCHES)->assertOk()->assertJsonCount(0, 'data');
        $this->getJson(self::BATCHES."/{$batch['id']}")->assertNotFound();
        $this->postJson(self::BATCHES."/{$batch['id']}/cancel")->assertNotFound();
        $this->postJson(self::DRAFTS."/{$draft['id']}/approve", ['fields' => ['description' => 'x']])->assertNotFound();
        $this->postJson(self::DRAFTS."/{$draft['id']}/reject")->assertNotFound();
        $this->postJson(self::DRAFTS.'/approve-many', ['ids' => [$draft['id']]])->assertOk()->assertJsonPath('data.skipped.0.reason', 'not_found');
        $this->start(['ids' => [$this->tee]])->assertNotFound();
        // Its own batch is not blocked by the first store's.
        $mine = $this->makeProduct($other['unit']->id, 'Toy', [['TOY', '5.00']])['id'];
        $this->start(['ids' => [$mine]])->assertCreated();
        $this->assertSame('pending', AiContentDraft::query()->withoutGlobalScopes()->whereKey($draft['id'])->value('status'));
    }

    public function test_old_drafts_are_pruned(): void
    {
        $this->fakeAi();
        $old = $this->start()->assertCreated()->json('data.id');
        DB::table('ai_content_drafts')->update(['created_at' => now()->subDays(31)]);
        DB::table('ai_content_batches')->update(['created_at' => now()->subDays(31)]);
        $recent = $this->start(['ids' => [$this->tee]])->assertCreated()->json('data.id');

        $this->artisan('online-catalog:prune-ai-drafts')->assertSuccessful();

        $this->assertSame([$recent], DB::table('ai_content_batches')->pluck('id')->all());
        $this->assertSame(1, DB::table('ai_content_drafts')->count());
        $this->assertNotSame($old, $recent);
    }
}
