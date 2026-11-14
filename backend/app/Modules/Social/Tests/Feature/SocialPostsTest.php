<?php

namespace App\Modules\Social\Tests\Feature;

use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Social\Application\Actions\PublishSocialPost;
use App\Modules\Social\Application\Actions\SocialPostWorkflow;
use App\Modules\Social\Infrastructure\Jobs\PublishSocialPostJob;
use App\Modules\Social\Infrastructure\Meta\SandboxMetaGraphClient;
use App\Modules\Social\Infrastructure\Models\SocialPost;
use App\Modules\Social\Infrastructure\Models\SocialPostResult;
use App\Modules\Social\Tests\Concerns\BuildsSocial;
use App\Modules\Users\Domain\Roles\SystemRole;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * P2b: social posts in sandbox mode — drafts, schedules, publishing with per-target results and
 * short links, failures and retries, the scheduler's once-only claims, recovery of interrupted
 * targets, permissions and tenant isolation. No network call is made.
 */
class SocialPostsTest extends TestCase
{
    use BuildsSocial, RefreshDatabase;

    /** @var array<string, mixed> */
    private array $shop;

    protected function setUp(): void
    {
        parent::setUp();
        Http::preventStrayRequests();
        $this->shop = $this->socialShop();
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    private function draft(array $overrides = []): array
    {
        return $this->postJson('/api/v1/social/posts', $overrides + [
            'caption' => 'Our softest polo yet ✨ #polo #summer',
            'targets' => ['facebook', 'instagram'],
            'image_ids' => [$this->shop['shirt_images'][0]],
            'product_id' => $this->shop['shirt']['id'],
        ])->assertCreated()->json('data');
    }

    public function test_drafts_are_created_with_a_default_product_link_and_validated(): void
    {
        $post = $this->draft();
        $this->assertSame(['draft', ['facebook', 'instagram'], '/product/polo-shirt'], [$post['status'], $post['targets'], $post['link_url']]);
        $this->assertSame([$this->shop['shirt_images'][0]], $post['image_ids']);
        $this->assertSame('product_image', $post['media'][0]['kind']);
        $this->assertStringStartsWith('/storage/', $post['media'][0]['url']);
        $this->assertSame(['id' => $this->shop['shirt']['id'], 'name' => 'Polo Shirt'], $post['product']);
        $this->assertSame(['edit', 'publish', 'delete'], $post['allowed_actions']);
        $this->assertSame([
            ['target' => 'facebook', 'status' => 'pending', 'remote_id' => null, 'permalink' => null, 'error' => null, 'short_link' => null, 'published_at' => null, 'sandbox' => false],
            ['target' => 'instagram', 'status' => 'pending', 'remote_id' => null, 'permalink' => null, 'error' => null, 'short_link' => null, 'published_at' => null, 'sandbox' => false],
        ], $post['results']);
        $this->assertSame($this->shop['tenant']['admin']->id, $post['created_by']['id']);

        // Media library photos come after product photos.
        $media = $this->postJson('/api/v1/media', ['file' => UploadedFile::fake()->image('banner.jpg', 800, 600)])->assertCreated()->json('data.id');
        $mixed = $this->draft(['image_ids' => $this->shop['shirt_images'], 'media_ids' => [$media], 'link_url' => '/p/eid-sale', 'targets' => ['facebook']]);
        $this->assertSame(['product_image', 'product_image', 'media'], array_column($mixed['media'], 'kind'));
        $this->assertSame('/p/eid-sale', $mixed['link_url']);

        // Shape and ownership.
        $this->postJson('/api/v1/social/posts', ['caption' => '', 'targets' => []])->assertStatus(422)->assertJsonValidationErrors(['caption', 'targets'], 'error.details');
        $this->postJson('/api/v1/social/posts', ['caption' => str_repeat('a', 2201), 'targets' => ['tiktok']])->assertStatus(422)->assertJsonValidationErrors(['caption', 'targets.0'], 'error.details');
        $this->postJson('/api/v1/social/posts', ['caption' => 'x', 'targets' => ['facebook'], 'image_ids' => [(string) Str::uuid()]])->assertStatus(422)->assertJsonValidationErrors('image_ids', 'error.details');
        $this->postJson('/api/v1/social/posts', ['caption' => 'x', 'targets' => ['facebook'], 'media_ids' => [(string) Str::uuid()]])->assertStatus(422)->assertJsonValidationErrors('media_ids', 'error.details');
        $this->postJson('/api/v1/social/posts', ['caption' => 'x', 'targets' => ['facebook'], 'product_id' => (string) Str::uuid()])->assertStatus(422)->assertJsonValidationErrors('product_id', 'error.details');
        $this->postJson('/api/v1/social/posts', ['caption' => 'x', 'targets' => ['facebook'], 'campaign_id' => (string) Str::uuid()])->assertStatus(422)->assertJsonValidationErrors('campaign_id', 'error.details');
        foreach (['https://evil.test/x', '//evil.test', 'p/eid'] as $bad) {
            $this->postJson('/api/v1/social/posts', ['caption' => 'x', 'targets' => ['facebook'], 'link_url' => $bad])->assertStatus(422)->assertJsonValidationErrors('link_url', 'error.details');
        }
        $eleven = array_map(fn () => (string) Str::uuid(), range(1, 11));
        $this->postJson('/api/v1/social/posts', ['caption' => 'x', 'targets' => ['facebook'], 'image_ids' => array_slice($eleven, 0, 6), 'media_ids' => array_slice($eleven, 6)])
            ->assertStatus(422)->assertJsonValidationErrors('media_ids', 'error.details');
        $this->postJson('/api/v1/social/posts', ['caption' => 'x', 'targets' => ['facebook'], 'scheduled_at' => now()->subMinute()->toIso8601String()])
            ->assertStatus(422)->assertJsonValidationErrors('scheduled_at', 'error.details');

        // Lists and filters.
        $this->getJson('/api/v1/social/posts')->assertOk()->assertJsonPath('meta.pagination.total', 2);
        $this->getJson('/api/v1/social/posts?target=instagram')->assertJsonPath('meta.pagination.total', 1);
        $this->getJson('/api/v1/social/posts?search=SOFTEST')->assertJsonPath('meta.pagination.total', 2);
        $this->getJson('/api/v1/social/posts?status=published')->assertJsonPath('meta.pagination.total', 0);
        $this->getJson('/api/v1/social/posts?product_id='.$this->shop['shirt']['id'])->assertJsonPath('meta.pagination.total', 2);
    }

    public function test_scheduling_and_publishing_need_a_connected_account_and_instagram_rules(): void
    {
        $post = $this->draft();
        $this->postJson("/api/v1/social/posts/{$post['id']}/publish")->assertStatus(422)->assertJsonPath('error.code', 'SOCIAL_NOT_CONNECTED');
        $this->patchJson("/api/v1/social/posts/{$post['id']}", ['scheduled_at' => now()->addDay()->toIso8601String()])->assertStatus(422)->assertJsonPath('error.code', 'SOCIAL_NOT_CONNECTED');
        $this->assertSame('draft', SocialPost::query()->withoutGlobalScopes()->findOrFail($post['id'])->status->value);

        $this->connectSandbox();
        $noPhoto = $this->draft(['image_ids' => []]);
        $this->postJson("/api/v1/social/posts/{$noPhoto['id']}/publish")->assertStatus(422)->assertJsonPath('error.code', 'INSTAGRAM_IMAGE_REQUIRED');
        $tags = $this->draft(['caption' => implode(' ', array_map(fn ($i) => "#tag{$i}", range(1, 31)))]);
        $this->postJson("/api/v1/social/posts/{$tags['id']}/publish")->assertStatus(422)->assertJsonPath('error.code', 'INSTAGRAM_TOO_MANY_HASHTAGS');
        // A Facebook-only post without photos is a link post.
        $this->patchJson("/api/v1/social/posts/{$noPhoto['id']}", ['targets' => ['facebook']])->assertOk();
        $this->postJson("/api/v1/social/posts/{$noPhoto['id']}/publish")->assertOk()->assertJsonPath('data.status', 'published');

        // Demo Page 2 has no Instagram account.
        $this->postJson('/api/v1/social/accounts/select', ['page_id' => SandboxMetaGraphClient::SECOND_PAGE_ID])->assertOk()->assertJsonPath('data.instagram', null);
        $this->postJson("/api/v1/social/posts/{$post['id']}/publish")->assertStatus(422)->assertJsonPath('error.code', 'INSTAGRAM_NOT_CONNECTED');
    }

    public function test_publishing_in_the_sandbox_records_results_and_short_links_per_target(): void
    {
        $this->connectSandbox();
        $campaign = $this->postJson('/api/v1/marketing/campaigns', ['name' => 'Eid', 'utm_campaign' => 'eid-2026'])->assertCreated()->json('data');
        $post = $this->draft(['campaign_id' => $campaign['id']]);

        $published = $this->postJson("/api/v1/social/posts/{$post['id']}/publish")->assertOk()->json('data');
        $this->assertSame('published', $published['status']);
        $this->assertNotNull($published['published_at']);
        $this->assertSame([], $published['allowed_actions']);
        $this->assertSame(['id' => $campaign['id'], 'name' => 'Eid'], $published['campaign']);
        foreach ($published['results'] as $result) {
            $this->assertSame('published', $result['status']);
            $this->assertTrue($result['sandbox']);
            $this->assertNull($result['error']);
            $this->assertNotNull($result['remote_id']);
            $this->assertStringStartsWith(SandboxMetaGraphClient::PERMALINK_BASE.'/'.$result['target'].'/', $result['permalink']);
            $this->assertMatchesRegularExpression('#^http://berry\.test/go/[a-z0-9]{6}$#', $result['short_link']['url']);
        }
        $links = DB::table('short_links')->orderBy('utm_source')->get(['target_path', 'utm_source', 'utm_medium', 'utm_campaign', 'campaign_id']);
        $this->assertSame([
            ['/product/polo-shirt', 'facebook', 'social', 'eid-2026', $campaign['id']],
            ['/product/polo-shirt', 'instagram', 'social', 'eid-2026', $campaign['id']],
        ], $links->map(fn ($l) => [$l->target_path, $l->utm_source, $l->utm_medium, $l->utm_campaign, $l->campaign_id])->all());

        // Published posts cannot change, publish again, be cancelled, retried or deleted.
        $this->patchJson("/api/v1/social/posts/{$post['id']}", ['caption' => 'Changed'])->assertStatus(422)->assertJsonPath('error.code', 'INVALID_STATUS_TRANSITION');
        $this->postJson("/api/v1/social/posts/{$post['id']}/publish")->assertStatus(422)->assertJsonPath('error.code', 'INVALID_STATUS_TRANSITION');
        $this->postJson("/api/v1/social/posts/{$post['id']}/retry")->assertStatus(422)->assertJsonPath('error.code', 'INVALID_STATUS_TRANSITION');
        $this->deleteJson("/api/v1/social/posts/{$post['id']}")->assertStatus(422)->assertJsonPath('error.code', 'INVALID_STATUS_TRANSITION');
        $this->assertSame(1, DB::table('audit_logs')->where('action', 'social.post_publish_requested')->count());

        // Without a campaign the tag is "social".
        $plain = $this->draft(['targets' => ['facebook']]);
        $this->postJson("/api/v1/social/posts/{$plain['id']}/publish")->assertOk();
        $this->assertSame(1, DB::table('short_links')->where('utm_source', 'facebook')->where('utm_campaign', 'social')->whereNull('campaign_id')->count());
    }

    public function test_a_sandbox_failure_can_be_edited_and_retried_without_posting_twice(): void
    {
        $this->connectSandbox();
        $post = $this->draft(['caption' => 'Testing #fail-test']);
        $failed = $this->postJson("/api/v1/social/posts/{$post['id']}/publish")->assertOk()->json('data');
        $this->assertSame('failed', $failed['status']);
        $this->assertSame(['edit', 'retry', 'delete'], $failed['allowed_actions']);
        $this->assertSame('SANDBOX_FAILURE', $failed['results'][0]['error']['code']);
        $this->assertStringContainsString('#fail-test', $failed['results'][1]['error']['message']);

        // Retrying with the same caption fails again; edited, it goes out.
        $this->postJson("/api/v1/social/posts/{$post['id']}/retry")->assertOk()->assertJsonPath('data.status', 'failed');
        $edited = $this->patchJson("/api/v1/social/posts/{$post['id']}", ['caption' => 'All good now'])->assertOk()->json('data');
        $this->assertSame(['draft', 'pending', 'pending'], [$edited['status'], $edited['results'][0]['status'], $edited['results'][1]['status']]);
        $this->postJson("/api/v1/social/posts/{$post['id']}/publish")->assertOk()->assertJsonPath('data.status', 'published');

        // A published target is never claimed again.
        $result = SocialPostResult::query()->withoutGlobalScopes()->where('post_id', $post['id'])->where('target', 'facebook')->firstOrFail();
        $remoteId = $result->remote_id;
        $attempts = $result->attempts;
        $this->inTenant($this->shop['tenant']['organization'], function () use ($post) {
            SocialPost::query()->whereKey($post['id'])->update(['status' => 'publishing']);
            (new PublishSocialPostJob($post['id'], $this->shop['tenant']['organization']->id))->handle(app(TenantContext::class), app(PublishSocialPost::class));
        });
        $result->refresh();
        $this->assertSame([$remoteId, $attempts, 'published'], [$result->remote_id, $result->attempts, $result->status->value]);
        $this->assertSame('published', SocialPost::query()->withoutGlobalScopes()->findOrFail($post['id'])->status->value);
    }

    public function test_scheduled_posts_are_published_once_by_the_scheduler(): void
    {
        $this->connectSandbox();
        $at = CarbonImmutable::now()->addHour()->startOfMinute();
        $post = $this->draft(['scheduled_at' => $at->toIso8601String()]);
        $this->assertSame(['scheduled', ['edit', 'publish', 'cancel', 'delete']], [$post['status'], $post['allowed_actions']]);
        $this->assertTrue(CarbonImmutable::parse($post['scheduled_at'])->equalTo($at));

        // Cancel and schedule again.
        $this->postJson("/api/v1/social/posts/{$post['id']}/cancel")->assertOk()->assertJsonPath('data.status', 'draft')->assertJsonPath('data.scheduled_at', null);
        $this->postJson("/api/v1/social/posts/{$post['id']}/cancel")->assertStatus(422)->assertJsonPath('error.code', 'INVALID_STATUS_TRANSITION');
        $this->patchJson("/api/v1/social/posts/{$post['id']}", ['scheduled_at' => $at->toIso8601String()])->assertOk()->assertJsonPath('data.status', 'scheduled');

        $this->artisan('social:publish-due')->assertSuccessful();
        $this->assertSame('scheduled', SocialPost::query()->withoutGlobalScopes()->findOrFail($post['id'])->status->value, 'Not due yet.');

        $this->travelTo($at->addMinute());
        Queue::fake();
        $this->artisan('social:publish-due')->assertSuccessful();
        $this->artisan('social:publish-due')->assertSuccessful();
        Queue::assertPushed(PublishSocialPostJob::class, 1);
        $this->assertSame('publishing', SocialPost::query()->withoutGlobalScopes()->findOrFail($post['id'])->status->value);
        // A second claim of the same post finds nothing to do.
        $this->assertFalse($this->inTenant($this->shop['tenant']['organization'], fn () => app(SocialPostWorkflow::class)->publishDue($post['id'])));

        // The worker publishes it.
        $job = Queue::pushed(PublishSocialPostJob::class)->first();
        $job->handle(app(TenantContext::class), app(PublishSocialPost::class));
        $this->assertSame('published', SocialPost::query()->withoutGlobalScopes()->findOrFail($post['id'])->status->value);
    }

    public function test_due_posts_that_cannot_go_out_fail_and_interrupted_targets_are_recovered(): void
    {
        $this->connectSandbox();
        $due = $this->draft(['scheduled_at' => now()->addMinutes(5)->toIso8601String()]);
        $this->deleteJson('/api/v1/social/accounts')->assertNoContent();
        $this->travel(10)->minutes();
        $this->artisan('social:publish-due')->assertSuccessful();
        $failed = $this->getJson("/api/v1/social/posts/{$due['id']}")->assertOk()->json('data');
        $this->assertSame(['failed', 'NOT_CONNECTED', 'NOT_CONNECTED'], [$failed['status'], $failed['results'][0]['error']['code'], $failed['results'][1]['error']['code']]);

        // A worker died after claiming Facebook; Instagram was never claimed.
        $this->connectSandbox();
        $post = $this->draft();
        $this->inTenant($this->shop['tenant']['organization'], function () use ($post) {
            SocialPost::query()->whereKey($post['id'])->update(['status' => 'publishing', 'publishing_started_at' => now()->subMinutes(30)]);
            SocialPostResult::query()->where('post_id', $post['id'])->where('target', 'facebook')->update(['status' => 'publishing', 'claimed_at' => now()->subMinutes(30), 'attempts' => 1]);
        });
        $this->artisan('social:publish-due')->assertSuccessful();
        $recovered = $this->getJson("/api/v1/social/posts/{$post['id']}")->json('data');
        $this->assertSame('partially_published', $recovered['status']);
        $this->assertSame(['failed', 'PUBLISH_INTERRUPTED'], [$recovered['results'][0]['status'], $recovered['results'][0]['error']['code']]);
        $this->assertSame('published', $recovered['results'][1]['status'], 'The unclaimed target was queued again.');
        $this->assertSame(['retry'], $recovered['allowed_actions']);

        // Retry publishes only the failed target.
        $instagram = $recovered['results'][1]['remote_id'];
        $retried = $this->postJson("/api/v1/social/posts/{$post['id']}/retry")->assertOk()->json('data');
        $this->assertSame(['published', 'published', 'published'], [$retried['status'], $retried['results'][0]['status'], $retried['results'][1]['status']]);
        $this->assertSame($instagram, $retried['results'][1]['remote_id']);
        $this->assertSame(1, DB::table('audit_logs')->where('action', 'social.post_retry_requested')->count());
    }

    public function test_deleting_cancelling_permissions_and_tenant_isolation(): void
    {
        $post = $this->draft();
        $this->deleteJson("/api/v1/social/posts/{$post['id']}")->assertNoContent();
        $this->assertSame(0, SocialPost::query()->withoutGlobalScopes()->count());
        $this->assertSame(0, SocialPostResult::query()->withoutGlobalScopes()->count());
        $this->assertSame(1, DB::table('audit_logs')->where('action', 'social.post_deleted')->count());
        $post = $this->draft();

        $cashier = $this->createUserWithRole($this->shop['tenant']['organization'], SystemRole::Cashier);
        $this->actingAsUser($cashier);
        $this->getJson('/api/v1/social/posts')->assertForbidden();
        $this->getJson('/api/v1/social/feeds')->assertForbidden();
        $this->getJson('/api/v1/social/settings')->assertForbidden();
        $this->get('/api/v1/social/meta/connect')->assertStatus(302)->assertHeader('Location', '/admin/marketing/social?error=session_expired');

        $manager = $this->createUserWithRole($this->shop['tenant']['organization'], SystemRole::OnlineStoreManager);
        $this->actingAsUser($manager);
        $this->getJson('/api/v1/social/posts')->assertOk()->assertJsonPath('meta.pagination.total', 1);
        $this->patchJson("/api/v1/social/posts/{$post['id']}", ['caption' => 'From the manager'])->assertOk();

        // Another store sees none of it and cannot touch it.
        $other = $this->openStore('Other Shop', 'other.test');
        $this->actingAsUser($other['admin']);
        $this->getJson('/api/v1/social/posts')->assertOk()->assertJsonPath('meta.pagination.total', 0);
        $this->getJson("/api/v1/social/posts/{$post['id']}")->assertNotFound();
        $this->patchJson("/api/v1/social/posts/{$post['id']}", ['caption' => 'x'])->assertNotFound();
        $this->postJson("/api/v1/social/posts/{$post['id']}/publish")->assertNotFound();
        $this->deleteJson("/api/v1/social/posts/{$post['id']}")->assertNotFound();
        // Its photos and products are not theirs either.
        $this->postJson('/api/v1/social/posts', ['caption' => 'x', 'targets' => ['facebook'], 'image_ids' => [$this->shop['shirt_images'][0]], 'product_id' => $this->shop['shirt']['id']])
            ->assertStatus(422)->assertJsonValidationErrors(['image_ids', 'product_id'], 'error.details');
        $this->getJson('/api/v1/social/accounts')->assertOk()->assertJsonPath('data.connected', false);
    }
}
