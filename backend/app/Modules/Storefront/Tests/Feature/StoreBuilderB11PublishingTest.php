<?php

namespace App\Modules\Storefront\Tests\Feature;

use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Storefront\Infrastructure\Notifications\BuilderPublishingNotification;
use App\Modules\Users\Infrastructure\Models\Role;
use App\Modules\Users\Infrastructure\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * B11: publish later (builder documents and the theme), draft checkpoints and named versions,
 * version render and compare, and the approval workflow — permissions, notifications, audit and
 * isolation. PostgreSQL.
 */
class StoreBuilderB11PublishingTest extends TestCase
{
    use BuildsOnlineCatalog, InteractsWithTenancy, RefreshDatabase;

    private const DOCS = '/api/v1/storefront/builder/documents';

    private const REVIEWS = '/api/v1/storefront/builder/reviews';

    /** @var array<string, mixed> */
    private array $t;

    protected function setUp(): void
    {
        parent::setUp();
        $this->t = $this->openStore('Berry Kids', 'berry.test');
    }

    /**
     * @param  list<array<string, mixed>>  $elements
     * @return array<string, mixed>
     */
    private static function page(array $elements, string $section = 's_main'): array
    {
        return ['schema_version' => 1, 'sections' => [['id' => $section, 'type' => 'section', 'columns' => [['id' => 'c_main', 'width' => ['base' => 100], 'elements' => $elements]]]]];
    }

    private static function heading(string $text, string $id = 'e_title'): array
    {
        return ['id' => $id, 'type' => 'heading', 'props' => ['text' => $text]];
    }

    private function save(string $id, array $content): TestResponse
    {
        $revision = $this->getJson(self::DOCS."/{$id}")->assertOk()->json('data.draft_revision');

        return $this->putJson(self::DOCS."/{$id}/draft", ['revision' => $revision, 'content' => $content]);
    }

    private function home(string $text = 'Version one'): string
    {
        $home = $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'home', 'title' => 'Home'])->assertCreated()->json('data.id');
        $this->save($home, self::page([self::heading($text)]))->assertOk();

        return $home;
    }

    private function liveHeading(): ?string
    {
        $this->app['auth']->forgetGuards();
        $text = $this->getJson('http://berry.test/api/v1/store/builder/pages/home')->json('data.sections.0.columns.0.elements.0.props.text');

        return $text;
    }

    /**
     * @param  list<string>  $permissions
     */
    private function staff(array $permissions, string $name = 'Editor'): User
    {
        $organization = $this->t['organization'];

        return $this->createUserWithRole($organization, $this->inTenant($organization, function () use ($permissions, $name) {
            $role = Role::query()->create(['name' => $name]);
            $role->permissions()->sync($permissions);

            return $role;
        }));
    }

    private function runScheduler(): void
    {
        $this->artisan('storefront:publish-scheduled')->assertSuccessful();
    }

    private function inAnHour(int $hours = 1): string
    {
        return CarbonImmutable::now()->addHours($hours)->toIso8601String();
    }

    public function test_publish_later_publishes_the_snapshot_once_as_the_scheduler(): void
    {
        $admin = $this->t['admin'];
        $home = $this->home('Eid look');

        $this->postJson(self::DOCS."/{$home}/schedule", ['publish_at' => CarbonImmutable::now()->subMinute()->toIso8601String()])
            ->assertUnprocessable()->assertJsonValidationErrors(['publish_at' => 'Choose a time in the future.'], 'error.details');
        $this->postJson(self::DOCS."/{$home}/schedule", ['publish_at' => CarbonImmutable::now()->addDays(400)->toIso8601String()])
            ->assertUnprocessable()->assertJsonValidationErrors(['publish_at' => 'Choose a time within the next year.'], 'error.details');
        $this->deleteJson(self::DOCS."/{$home}/schedule")->assertStatus(409)->assertJsonPath('error.code', 'NOTHING_SCHEDULED');

        $first = $this->postJson(self::DOCS."/{$home}/schedule", ['publish_at' => $this->inAnHour(3), 'note' => 'First plan'])->assertOk()->json('data.schedule.id');
        $schedule = $this->postJson(self::DOCS."/{$home}/schedule", ['publish_at' => $this->inAnHour(), 'note' => 'Eid launch'])->assertOk()
            ->assertJsonPath('data.schedule.status', 'pending')
            ->assertJsonPath('data.schedule.note', 'Eid launch')
            ->assertJsonPath('data.schedule.created_by.id', $admin->id)
            ->assertJsonPath('data.schedule.draft_changed', false)
            ->assertJsonPath('data.schedule.failure', null)
            ->json('data.schedule');
        $this->assertNotSame($first, $schedule['id']);
        $this->assertDatabaseHas('builder_schedules', ['id' => $first, 'status' => 'cancelled']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'storefront.builder_schedule_cancelled']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'storefront.builder_publish_scheduled']);

        // The draft changes afterwards: the snapshot still goes live.
        $this->save($home, self::page([self::heading('Later edit')]))->assertOk();
        $this->getJson(self::DOCS)->assertJsonPath('data.0.schedule.id', $schedule['id'])->assertJsonPath('data.0.schedule.draft_changed', true);

        // Not due yet.
        $this->runScheduler();
        $this->assertDatabaseHas('builder_schedules', ['id' => $schedule['id'], 'status' => 'pending']);

        $this->travel(2)->hours();
        $this->runScheduler();
        $this->runScheduler();
        $this->assertSame('Eid look', $this->liveHeading());

        $this->actingAsUser($admin);
        $versions = $this->getJson(self::DOCS."/{$home}/versions")->assertOk()->json('data');
        $this->assertCount(1, $versions);
        $this->assertSame(['version', 1, 'scheduled', 'Eid launch', $admin->id], [$versions[0]['kind'], $versions[0]['number'], $versions[0]['via'], $versions[0]['note'], $versions[0]['created_by']['id']]);
        $this->assertDatabaseHas('builder_schedules', ['id' => $schedule['id'], 'status' => 'done', 'version_id' => $versions[0]['id']]);
        $this->getJson(self::DOCS."/{$home}")->assertJsonPath('data.schedule', null)
            ->assertJsonPath('data.content.sections.0.columns.0.elements.0.props.text', 'Later edit')
            ->assertJsonPath('data.has_unpublished_changes', true);
        $audit = DB::table('audit_logs')->where('action', 'storefront.builder_published')->first();
        $this->assertSame($admin->id, $audit->user_id);
        $this->assertEquals(['note' => 'Eid launch', 'via' => 'scheduled', 'schedule_id' => $schedule['id']], json_decode($audit->context, true));

        // Cancelling.
        $this->postJson(self::DOCS."/{$home}/schedule", ['publish_at' => $this->inAnHour()])->assertOk();
        $this->deleteJson(self::DOCS."/{$home}/schedule")->assertOk()->assertJsonPath('data.schedule', null);
        $this->travel(2)->hours();
        $this->runScheduler();
        $this->actingAsUser($admin);
        $this->assertCount(1, $this->getJson(self::DOCS."/{$home}/versions")->json('data'));

        // Scheduling needs storefront.publish.
        $this->actingAsUser($this->staff(['storefront.view', 'storefront.manage']));
        $this->postJson(self::DOCS."/{$home}/schedule", ['publish_at' => $this->inAnHour()])->assertForbidden();
        $this->deleteJson(self::DOCS."/{$home}/schedule")->assertForbidden();
    }

    public function test_a_scheduled_publish_fails_with_the_reason_when_records_are_gone(): void
    {
        $admin = $this->t['admin'];
        $category = $this->category($this->t['organization'], 'Toys');
        $home = $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'home', 'title' => 'Home'])->assertCreated()->json('data.id');
        $this->save($home, self::page([self::heading('Toys'), ['id' => 'e_cat', 'type' => 'category_card', 'props' => ['category_id' => $category]]]))->assertOk();
        $schedule = $this->postJson(self::DOCS."/{$home}/schedule", ['publish_at' => $this->inAnHour()])->assertOk()->json('data.schedule.id');

        DB::table('categories')->where('id', $category)->delete();
        $this->travel(2)->hours();
        $this->runScheduler();

        $this->assertDatabaseHas('builder_schedules', ['id' => $schedule, 'status' => 'failed']);
        $this->actingAsUser($admin);
        $failed = $this->getJson(self::DOCS."/{$home}")->assertOk()
            ->assertJsonPath('data.published', null)
            ->assertJsonPath('data.schedule.status', 'failed')
            ->assertJsonPath('data.schedule.failure.code', 'DOCUMENT_INVALID')
            ->json('data.schedule.failure');
        $this->assertSame([['e_cat', 'CATEGORY_NOT_FOUND', [$category]]], array_map(fn (array $e) => [$e['node_id'], $e['code'], $e['ids']], $failed['errors']));
        $this->assertSame(0, DB::table('builder_versions')->where('document_id', $home)->count());
        $this->assertDatabaseHas('audit_logs', ['action' => 'storefront.builder_schedule_failed', 'user_id' => $admin->id]);

        $notification = DB::table('notifications')->where('type', BuilderPublishingNotification::SCHEDULE_FAILED)->first();
        $this->assertSame($admin->id, $notification->notifiable_id);
        $data = json_decode($notification->data, true);
        $this->assertSame(['/storefront/builder/'.$home, $home, $schedule], [$data['url'], $data['document_id'], $data['schedule_id']]);

        // A later publish clears the failed badge.
        $this->save($home, self::page([self::heading('Fixed')]))->assertOk();
        $this->travel(1)->minutes();
        $this->postJson(self::DOCS."/{$home}/publish")->assertOk()->assertJsonPath('data.schedule', null);
    }

    public function test_publishing_now_can_cancel_the_pending_schedule(): void
    {
        $home = $this->home('Old snapshot');
        $this->postJson(self::DOCS."/{$home}/schedule", ['publish_at' => $this->inAnHour()])->assertOk();
        $this->save($home, self::page([self::heading('Typo fixed')]))->assertOk();

        // Without the flag the schedule stays (backward compatible).
        $this->postJson(self::DOCS."/{$home}/publish")->assertOk()->assertJsonPath('data.schedule.status', 'pending');
        $this->postJson(self::DOCS."/{$home}/publish", ['cancel_schedule' => 'yes'])->assertUnprocessable();
        $this->postJson(self::DOCS."/{$home}/publish", ['cancel_schedule' => true])->assertOk()
            ->assertJsonPath('data.schedule', null)->assertJsonPath('data.published.number', 2);
        $this->assertDatabaseHas('audit_logs', ['action' => 'storefront.builder_schedule_cancelled']);
        $this->assertSame('published_now', json_decode((string) DB::table('audit_logs')->where('action', 'storefront.builder_schedule_cancelled')->value('context'), true)['reason']);
        $this->travel(2)->hours();
        $this->runScheduler();
        $this->assertSame('Typo fixed', $this->liveHeading());

        // Approve now with the flag.
        $this->actingAsUser($this->t['admin']);
        $this->postJson(self::DOCS."/{$home}/schedule", ['publish_at' => $this->inAnHour()])->assertOk();
        $review = $this->postJson(self::DOCS."/{$home}/reviews")->assertCreated()->json('data.id');
        $this->postJson(self::REVIEWS."/{$review}/approve", ['cancel_schedule' => true])->assertOk()->assertJsonPath('data.document.schedule', null);
        $this->assertSame(0, DB::table('builder_schedules')->where('document_id', $home)->where('status', 'pending')->count());

        // The theme too.
        $this->postJson('/api/v1/storefront/theme/presets/vegan/apply')->assertOk();
        $this->postJson('/api/v1/storefront/theme/schedule', ['publish_at' => $this->inAnHour()])->assertOk();
        $this->postJson('/api/v1/storefront/theme/publish', ['cancel_schedule' => true])->assertOk()->assertJsonPath('data.schedule', null);
    }

    public function test_the_theme_can_be_published_later(): void
    {
        $live = $this->getJson('/api/v1/storefront/theme')->json('data.settings');
        $this->deleteJson('/api/v1/storefront/theme/schedule')->assertStatus(409)->assertJsonPath('error.code', 'NOTHING_SCHEDULED');
        $this->postJson('/api/v1/storefront/theme/presets/vegan/apply')->assertOk();
        $draft = $this->getJson('/api/v1/storefront/theme/draft')->json('data.settings');
        $this->assertNotSame($live, $draft);

        $this->postJson('/api/v1/storefront/theme/schedule', ['publish_at' => $this->inAnHour(), 'note' => 'Green week'])->assertOk()
            ->assertJsonPath('data.schedule.status', 'pending')
            ->assertJsonPath('data.schedule.note', 'Green week');
        $this->postJson('/api/v1/storefront/theme/presets/kids/apply')->assertOk()->assertJsonPath('data.schedule.draft_changed', true);

        $this->travel(2)->hours();
        $this->runScheduler();
        $this->actingAsUser($this->t['admin']);
        $this->assertSame($draft, $this->getJson('/api/v1/storefront/theme')->json('data.settings'));
        $this->getJson('/api/v1/storefront/theme/draft')->assertJsonPath('data.schedule', null)->assertJsonPath('data.settings.preset', 'kids');
        $this->getJson('/api/v1/storefront/theme/versions')->assertJsonPath('data.0.via', 'scheduled')->assertJsonPath('data.0.note', 'Green week');

        $this->actingAsUser($this->staff(['storefront.view', 'storefront.manage']));
        $this->postJson('/api/v1/storefront/theme/schedule', ['publish_at' => $this->inAnHour()])->assertForbidden();
    }

    public function test_checkpoints_names_render_and_compare(): void
    {
        $home = $this->home('Version one');
        $this->postJson(self::DOCS."/{$home}/publish", ['note' => 'Launch'])->assertOk();
        $v1 = $this->getJson(self::DOCS."/{$home}/versions")->json('data.0.id');

        $this->save($home, self::page([self::heading('Version two'), ['id' => 'e_btn', 'type' => 'button', 'props' => ['label' => 'Shop', 'link' => ['url' => '/shop']]]]))->assertOk();
        $checkpoint = $this->postJson(self::DOCS."/{$home}/checkpoints", ['name' => 'Before the sale'])->assertCreated()->json('data');
        $this->assertSame(['checkpoint', null, 'Before the sale', null, null], [$checkpoint['kind'], $checkpoint['number'], $checkpoint['name'], $checkpoint['published_at'], $checkpoint['via']]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'storefront.builder_checkpoint_saved']);

        $this->assertSame([$v1], array_column($this->getJson(self::DOCS."/{$home}/versions")->json('data'), 'id'));
        $all = $this->getJson(self::DOCS."/{$home}/versions?include=checkpoints")->assertOk()->json('data');
        $this->assertEqualsCanonicalizing([$v1, $checkpoint['id']], array_column($all, 'id'));
        $this->getJson(self::DOCS."/{$home}/versions?include=everything")->assertUnprocessable();

        // Names.
        $this->patchJson(self::DOCS."/{$home}/versions/{$v1}", ['name' => '  Spring look  '])->assertOk()->assertJsonPath('data.name', 'Spring look')->assertJsonPath('data.number', 1);
        $this->patchJson(self::DOCS."/{$home}/versions/{$v1}", ['name' => str_repeat('x', 81)])->assertUnprocessable();
        $this->patchJson(self::DOCS."/{$home}/versions/{$v1}", [])->assertUnprocessable();
        $this->assertDatabaseHas('audit_logs', ['action' => 'storefront.builder_version_renamed']);
        $this->deleteJson(self::DOCS."/{$home}/versions/{$v1}")->assertStatus(409)->assertJsonPath('error.code', 'VERSION_NOT_DELETABLE');

        // Render a version and a checkpoint.
        $this->getJson(self::DOCS."/{$home}/versions/{$v1}/render")->assertOk()
            ->assertJsonPath('data.sections.0.columns.0.elements.0.props.text', 'Version one')
            ->assertJsonPath('data.document.version', 1)
            ->assertJsonPath('data.snapshot', ['kind' => 'version', 'id' => $v1, 'number' => 1, 'name' => 'Spring look']);
        $this->getJson(self::DOCS."/{$home}/versions/{$checkpoint['id']}/render")->assertOk()
            ->assertJsonPath('data.sections.0.columns.0.elements.1.props.label', 'Shop');

        // Compare live → draft.
        $this->save($home, self::page([['id' => 'e_btn', 'type' => 'button', 'props' => ['label' => 'Shop now', 'link' => ['url' => '/shop']], 'style' => ['base' => ['color' => '#112233']]], self::heading('Version three')]))->assertOk();
        $diff = $this->getJson(self::DOCS."/{$home}/compare")->assertOk()->json('data');
        $this->assertSame(['kind' => 'live', 'id' => $v1, 'number' => 1, 'name' => 'Spring look'], $diff['from']);
        $this->assertSame('draft', $diff['to']['kind']);
        $this->assertSame([['id' => 'e_btn', 'type' => 'button', 'kind' => 'element', 'parent_id' => 'c_main', 'label' => 'Shop now']], $diff['added']);
        $this->assertSame([], $diff['removed']);
        $this->assertSame([['node_id' => 'e_title', 'type' => 'heading', 'fields' => [['field' => 'props.text', 'before' => 'Version one', 'after' => 'Version three']]]], $diff['changed']);
        // A node inserted before another does not move it.
        $this->assertSame([], $diff['moved']);

        // Checkpoint → draft: the button's label and style changed.
        $diff = $this->getJson(self::DOCS."/{$home}/compare?from={$checkpoint['id']}&to=draft")->assertOk()->json('data');
        $btn = collect($diff['changed'])->firstWhere('node_id', 'e_btn');
        $this->assertSame([['field' => 'style', 'before' => null, 'after' => null], ['field' => 'props.label', 'before' => 'Shop', 'after' => 'Shop now']], $btn['fields']);
        $this->getJson(self::DOCS."/{$home}/compare?from=01900000-0000-7000-8000-000000000001")->assertNotFound()->assertJsonPath('error.code', 'VERSION_NOT_FOUND');
        $this->getJson(self::DOCS."/{$home}/compare?from=yesterday")->assertUnprocessable();

        // Restore the checkpoint, then delete it.
        $this->postJson(self::DOCS."/{$home}/versions/{$checkpoint['id']}/restore")->assertOk()
            ->assertJsonPath('data.content.sections.0.columns.0.elements.0.props.text', 'Version two');
        $this->deleteJson(self::DOCS."/{$home}/versions/{$checkpoint['id']}")->assertNoContent();
        $this->assertDatabaseHas('audit_logs', ['action' => 'storefront.builder_checkpoint_deleted']);
        $this->assertDatabaseMissing('builder_versions', ['id' => $checkpoint['id']]);

        // Twenty checkpoints at most: the oldest unnamed one makes room; all named → 422.
        $first = $this->postJson(self::DOCS."/{$home}/checkpoints")->assertCreated()->json('data.id');
        $this->travel(1)->seconds();
        for ($i = 2; $i <= 20; $i++) {
            $this->postJson(self::DOCS."/{$home}/checkpoints", ['name' => "Copy {$i}"])->assertCreated();
        }
        $this->postJson(self::DOCS."/{$home}/checkpoints", ['name' => 'Copy 21'])->assertCreated();
        $this->assertDatabaseMissing('builder_versions', ['id' => $first]);
        $this->postJson(self::DOCS."/{$home}/checkpoints", ['name' => 'Copy 22'])->assertUnprocessable()->assertJsonPath('error.code', 'CHECKPOINT_LIMIT');
        $this->assertSame(20, DB::table('builder_versions')->where('document_id', $home)->where('kind', 'checkpoint')->count());

        // Viewers read but cannot save checkpoints or names.
        $this->actingAsUser($this->staff(['storefront.view'], 'Viewer'));
        $this->getJson(self::DOCS."/{$home}/compare")->assertOk();
        $this->getJson(self::DOCS."/{$home}/versions/{$v1}/render")->assertOk();
        $this->postJson(self::DOCS."/{$home}/checkpoints")->assertForbidden();
        $this->patchJson(self::DOCS."/{$home}/versions/{$v1}", ['name' => 'x'])->assertForbidden();
    }

    public function test_review_submit_send_back_and_approve_now(): void
    {
        $admin = $this->t['admin'];
        $home = $this->home('First try');
        $editor = $this->staff(['storefront.view', 'storefront.manage']);

        $this->actingAsUser($editor);
        $this->postJson(self::DOCS."/{$home}/publish")->assertForbidden();
        $review = $this->postJson(self::DOCS."/{$home}/reviews", ['note' => 'New spring banner'])->assertCreated()
            ->assertJsonPath('data.status', 'pending')
            ->assertJsonPath('data.note', 'New spring banner')
            ->assertJsonPath('data.submitted_by.id', $editor->id)
            ->assertJsonPath('data.document.id', $home)
            ->assertJsonPath('data.draft_changed', false)
            ->json('data');
        $this->assertDatabaseHas('audit_logs', ['action' => 'storefront.builder_review_submitted', 'user_id' => $editor->id]);
        $submitted = DB::table('notifications')->where('type', BuilderPublishingNotification::REVIEW_SUBMITTED)->get();
        $this->assertSame([$admin->id], $submitted->pluck('notifiable_id')->all());
        $this->assertSame('/storefront/pages?review='.$review['id'], json_decode($submitted[0]->data, true)['url']);
        $this->getJson(self::DOCS."/{$home}")->assertJsonPath('data.review.id', $review['id'])->assertJsonPath('data.review.status', 'pending');
        $this->postJson(self::REVIEWS."/{$review['id']}/approve")->assertForbidden();
        $this->postJson(self::REVIEWS."/{$review['id']}/send-back", ['comment' => 'x'])->assertForbidden();

        // The editor keeps working: the review warns, the snapshot stays.
        $this->save($home, self::page([self::heading('Second try')]))->assertOk();

        $this->actingAsUser($admin);
        $inbox = $this->getJson(self::REVIEWS)->assertOk()->json('data');
        $this->assertSame([[$review['id'], true]], array_map(fn (array $r) => [$r['id'], $r['draft_changed']], $inbox));
        $opened = $this->getJson(self::REVIEWS."/{$review['id']}")->assertOk()->json('data');
        $this->assertSame('First try', $opened['render']['sections'][0]['columns'][0]['elements'][0]['props']['text']);
        $this->assertSame(['kind' => 'review', 'id' => $review['id'], 'number' => null, 'name' => null], $opened['render']['snapshot']);
        $this->assertSame('live', $opened['changes']['from']['kind']);
        $this->assertSame(['s_main', 'c_main', 'e_title'], array_column($opened['changes']['added'], 'id'));
        $this->assertSame($home, $opened['document']['id']);

        $this->postJson(self::REVIEWS."/{$review['id']}/send-back", [])->assertUnprocessable()->assertJsonValidationErrors(['comment' => 'Write what needs to change.'], 'error.details');
        $this->postJson(self::REVIEWS."/{$review['id']}/send-back", ['comment' => 'Use the Eid photo'])->assertOk()
            ->assertJsonPath('data.review.status', 'sent_back')
            ->assertJsonPath('data.review.comment', 'Use the Eid photo')
            ->assertJsonPath('data.review.decided_by.id', $admin->id)
            ->assertJsonPath('data.document.review.status', 'sent_back');
        $this->postJson(self::REVIEWS."/{$review['id']}/approve")->assertStatus(409)->assertJsonPath('error.code', 'REVIEW_NOT_PENDING')->assertJsonPath('error.details.status', 'sent_back');
        $back = DB::table('notifications')->where('type', BuilderPublishingNotification::REVIEW_SENT_BACK)->first();
        $this->assertSame($editor->id, $back->notifiable_id);
        $this->assertStringContainsString('Use the Eid photo', json_decode($back->data, true)['message']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'storefront.builder_review_sent_back']);

        // Resubmitted, approved now: the snapshot goes live.
        $this->actingAsUser($editor);
        $second = $this->postJson(self::DOCS."/{$home}/reviews")->assertCreated()->json('data.id');
        $this->save($home, self::page([self::heading('Third try')]))->assertOk();
        $this->actingAsUser($admin);
        $this->postJson(self::REVIEWS."/{$second}/approve", ['note' => 'Looks good'])->assertOk()
            ->assertJsonPath('data.review.status', 'approved')
            ->assertJsonPath('data.review.version.number', 1)
            ->assertJsonPath('data.document.published.number', 1)
            ->assertJsonPath('data.document.review', null);
        $this->assertSame('Second try', $this->liveHeading());
        $this->actingAsUser($admin);
        $this->getJson(self::DOCS."/{$home}/versions")->assertJsonPath('data.0.via', 'review')->assertJsonPath('data.0.note', 'Looks good');
        $this->assertSame($editor->id, DB::table('notifications')->where('type', BuilderPublishingNotification::REVIEW_APPROVED)->value('notifiable_id'));
        $this->assertDatabaseHas('audit_logs', ['action' => 'storefront.builder_review_approved']);
        $this->getJson(self::REVIEWS.'?status=all')->assertJsonCount(2, 'data');
        $this->getJson(self::REVIEWS)->assertJsonCount(0, 'data');
        $this->getJson(self::REVIEWS.'?status=maybe')->assertUnprocessable();
    }

    public function test_review_approved_for_later_replacing_and_withdrawing(): void
    {
        $admin = $this->t['admin'];
        $home = $this->home('Snapshot');
        $editor = $this->staff(['storefront.view', 'storefront.manage']);
        $other = $this->staff(['storefront.view', 'storefront.manage'], 'Other editor');

        $this->actingAsUser($editor);
        $old = $this->postJson(self::DOCS."/{$home}/reviews")->assertCreated()->json('data.id');
        $review = $this->postJson(self::DOCS."/{$home}/reviews", ['note' => 'Second'])->assertCreated()->json('data.id');
        $this->assertDatabaseHas('builder_reviews', ['id' => $old, 'status' => 'withdrawn']);

        $this->actingAsUser($other);
        $this->postJson(self::REVIEWS."/{$review}/withdraw")->assertForbidden()->assertJsonPath('error.code', 'REVIEW_NOT_YOURS');

        $this->actingAsUser($admin);
        $this->postJson(self::REVIEWS."/{$review}/approve", ['publish_at' => CarbonImmutable::now()->subHour()->toIso8601String()])->assertUnprocessable();
        $approved = $this->postJson(self::REVIEWS."/{$review}/approve", ['publish_at' => $this->inAnHour()])->assertOk()
            ->assertJsonPath('data.review.status', 'approved')
            ->assertJsonPath('data.review.version', null)
            ->assertJsonPath('data.review.schedule.status', 'pending')
            ->assertJsonPath('data.review.schedule.review_id', $review)
            ->assertJsonPath('data.review.schedule.note', 'Second')
            ->assertJsonPath('data.document.schedule.review_id', $review)
            ->json('data.review');
        $this->assertNull($this->getJson(self::DOCS."/{$home}")->json('data.published'));
        $this->assertStringContainsString('scheduled time', json_decode(DB::table('notifications')->where('type', BuilderPublishingNotification::REVIEW_APPROVED)->value('data'), true)['message']);

        $this->travel(2)->hours();
        $this->runScheduler();
        $this->assertSame('Snapshot', $this->liveHeading());
        $this->actingAsUser($admin);
        $this->getJson(self::REVIEWS."/{$review}")->assertJsonPath('data.review.version.number', 1)
            ->assertJsonPath('data.review.schedule.status', 'done');
        $this->assertDatabaseHas('builder_schedules', ['id' => $approved['schedule']['id'], 'created_by' => $admin->id, 'status' => 'done']);

        // The submitter withdraws their own.
        $this->actingAsUser($editor);
        $third = $this->postJson(self::DOCS."/{$home}/reviews")->assertCreated()->json('data.id');
        $this->postJson(self::REVIEWS."/{$third}/withdraw")->assertOk()->assertJsonPath('data.review.status', 'withdrawn')->assertJsonPath('data.document.review', null);
        $this->postJson(self::REVIEWS."/{$third}/withdraw")->assertStatus(409);

        // An emptied page cannot be sent.
        $landing = $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'landing:empty', 'title' => 'Empty'])->assertCreated()->json('data.id');
        $this->postJson(self::DOCS."/{$landing}/reviews")->assertUnprocessable()->assertJsonPath('error.code', 'DOCUMENT_EMPTY');

        // Viewers cannot submit or read the inbox.
        $this->actingAsUser($this->staff(['storefront.view'], 'Viewer'));
        $this->postJson(self::DOCS."/{$home}/reviews")->assertForbidden();
        $this->getJson(self::REVIEWS)->assertForbidden();
    }

    public function test_approving_fails_cleanly_when_records_are_gone(): void
    {
        $category = $this->category($this->t['organization'], 'Toys');
        $home = $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'home', 'title' => 'Home'])->assertCreated()->json('data.id');
        $this->save($home, self::page([['id' => 'e_cat', 'type' => 'category_card', 'props' => ['category_id' => $category]]]))->assertOk();
        $review = $this->postJson(self::DOCS."/{$home}/reviews")->assertCreated()->json('data.id');
        DB::table('categories')->where('id', $category)->delete();

        $this->postJson(self::REVIEWS."/{$review}/approve")->assertUnprocessable()->assertJsonPath('error.code', 'DOCUMENT_INVALID');
        $this->assertDatabaseHas('builder_reviews', ['id' => $review, 'status' => 'pending', 'version_id' => null]);
        $this->assertSame(0, DB::table('builder_versions')->where('document_id', $home)->count());
    }

    public function test_publishing_data_is_isolated_between_organizations(): void
    {
        $home = $this->home('Ours');
        $this->postJson(self::DOCS."/{$home}/publish")->assertOk();
        $version = $this->getJson(self::DOCS."/{$home}/versions")->json('data.0.id');
        $checkpoint = $this->postJson(self::DOCS."/{$home}/checkpoints", ['name' => 'Ours'])->assertCreated()->json('data.id');
        $review = $this->postJson(self::DOCS."/{$home}/reviews")->assertCreated()->json('data.id');
        $this->postJson(self::DOCS."/{$home}/schedule", ['publish_at' => $this->inAnHour()])->assertOk();

        $other = $this->openStore('Other Shop', 'other.test');
        $theirs = $this->home('Theirs');
        $this->getJson(self::REVIEWS.'?status=all')->assertOk()->assertJsonCount(0, 'data');
        $this->getJson(self::REVIEWS."/{$review}")->assertNotFound();
        $this->postJson(self::REVIEWS."/{$review}/approve")->assertNotFound();
        $this->postJson(self::REVIEWS."/{$review}/send-back", ['comment' => 'no'])->assertNotFound();
        $this->postJson(self::REVIEWS."/{$review}/withdraw")->assertNotFound();
        $this->postJson(self::DOCS."/{$home}/schedule", ['publish_at' => $this->inAnHour()])->assertNotFound();
        $this->deleteJson(self::DOCS."/{$home}/schedule")->assertNotFound();
        $this->postJson(self::DOCS."/{$home}/checkpoints")->assertNotFound();
        $this->postJson(self::DOCS."/{$home}/reviews")->assertNotFound();
        $this->getJson(self::DOCS."/{$home}/compare")->assertNotFound();
        $this->getJson(self::DOCS."/{$home}/versions/{$version}/render")->assertNotFound();
        // Our version ids through their own document.
        $this->getJson(self::DOCS."/{$theirs}/versions/{$checkpoint}/render")->assertNotFound();
        $this->patchJson(self::DOCS."/{$theirs}/versions/{$version}", ['name' => 'x'])->assertNotFound();
        $this->deleteJson(self::DOCS."/{$theirs}/versions/{$checkpoint}")->assertNotFound();
        $this->getJson(self::DOCS."/{$theirs}/compare?from={$version}")->assertNotFound();
        $this->getJson(self::DOCS)->assertJsonPath('data.0.schedule', null)->assertJsonPath('data.0.review', null);
        $this->assertSame(0, DB::table('notifications')->where('notifiable_id', $other['admin']->id)->count());

        // The scheduler publishes each organization's own schedule only.
        $this->travel(2)->hours();
        $this->runScheduler();
        $this->assertSame('Ours', $this->liveHeading());
        $this->assertSame(0, DB::table('builder_versions')->where('document_id', $theirs)->count());
    }
}
