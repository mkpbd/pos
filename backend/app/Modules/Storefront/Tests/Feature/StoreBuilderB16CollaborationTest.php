<?php

namespace App\Modules\Storefront\Tests\Feature;

use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Storefront\Infrastructure\Notifications\BuilderCollaborationNotification;
use App\Modules\Users\Infrastructure\Models\Role;
use App\Modules\Users\Infrastructure\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * B16: presence and the edit lock (423 on every draft-writing action of someone else, take-over,
 * ask to edit), comments pinned on the page (threads, replies, mentions, resolve, edit window,
 * delete), the activity log (audit entries + edit sessions, paged) — permissions, notifications,
 * audit and isolation. PostgreSQL.
 */
class StoreBuilderB16CollaborationTest extends TestCase
{
    use BuildsOnlineCatalog, InteractsWithTenancy, RefreshDatabase;

    private const DOCS = '/api/v1/storefront/builder/documents';

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
    private static function page(array $elements): array
    {
        return ['schema_version' => 1, 'sections' => [['id' => 's_main', 'type' => 'section', 'columns' => [['id' => 'c_main', 'width' => ['base' => 100], 'elements' => $elements]]]]];
    }

    /**
     * @return array<string, mixed>
     */
    private static function heading(string $text, string $id = 'e_title'): array
    {
        return ['id' => $id, 'type' => 'heading', 'props' => ['text' => $text]];
    }

    /**
     * @param  array<string, mixed>  $content
     */
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

    /**
     * @param  list<string>  $permissions
     */
    private function staff(array $permissions, string $name): User
    {
        $organization = $this->t['organization'];
        $user = $this->createUserWithRole($organization, $this->inTenant($organization, function () use ($permissions, $name) {
            $role = Role::query()->create(['name' => 'Role '.$name]);
            $role->permissions()->sync($permissions);

            return $role;
        }));
        User::query()->withoutGlobalScopes()->whereKey($user->id)->update(['name' => $name]);

        return $user->fresh();
    }

    private function beat(string $id, bool $editing = true): TestResponse
    {
        return $this->postJson(self::DOCS."/{$id}/presence", ['editing' => $editing]);
    }

    private function notifications(User $user, string $type): int
    {
        return DB::table('notifications')->where('notifiable_id', $user->id)->where('type', $type)->count();
    }

    public function test_one_editor_at_a_time_and_every_draft_write_of_someone_else_is_423(): void
    {
        $admin = $this->t['admin'];
        $home = $this->home();
        $landing = $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'landing:eid', 'title' => 'Eid sale'])->assertCreated()->json('data.id');
        $editor = $this->staff(['storefront.view', 'storefront.manage'], 'Rima');
        $publisher = $this->staff(['storefront.view', 'storefront.manage', 'storefront.publish'], 'Karim');
        $viewer = $this->staff(['storefront.view'], 'Viewer');

        // The first editor gets the lease.
        $this->actingAsUser($editor);
        $state = $this->beat($home)->assertOk()
            ->assertHeader('Cache-Control', 'no-store, private')
            ->assertJsonPath('data.mine', true)
            ->assertJsonPath('data.lock.user.id', $editor->id)
            ->assertJsonPath('data.lock.user.name', 'Rima')
            ->assertJsonPath('data.viewers.0.editing', true)
            ->assertJsonPath('data.viewers.0.is_me', true)
            ->assertJsonPath('data.comments.open', 0)
            ->json('data');
        $this->assertSame(1, $state['draft_revision']);
        $this->assertNotNull($state['lock']['expires_at']);

        // Others see it and are view-only.
        $this->actingAsUser($publisher);
        $state = $this->beat($home)->assertOk()->assertJsonPath('data.mine', false)->assertJsonPath('data.lock.user.id', $editor->id)->json('data');
        $this->assertCount(2, $state['viewers']);
        $byUser = collect($state['viewers'])->keyBy('user.id');
        $this->assertTrue($byUser[$editor->id]['editing']);
        $this->assertFalse($byUser[$publisher->id]['editing']);
        $this->assertTrue($byUser[$publisher->id]['is_me']);

        $locked = fn (TestResponse $r) => $r->assertStatus(423)->assertJsonPath('error.code', 'DOCUMENT_LOCKED')
            ->assertJsonPath('error.details.user.id', $editor->id)->assertJsonPath('error.details.user.name', 'Rima');
        $locked($this->save($home, self::page([self::heading('Mine')])));
        $locked($this->postJson(self::DOCS."/{$home}/publish"));
        $locked($this->postJson(self::DOCS."/{$home}/discard"));
        $locked($this->postJson(self::DOCS."/{$home}/checkpoints", ['name' => 'Before Eid']));
        $locked($this->postJson(self::DOCS."/{$home}/reviews"));
        $locked($this->postJson(self::DOCS."/{$home}/schedule", ['publish_at' => CarbonImmutable::now()->addHour()->toIso8601String()]));
        $locked($this->deleteJson(self::DOCS."/{$home}/schedule"));
        $locked($this->postJson(self::DOCS."/{$home}/experiments/x_hero/start", ['revision' => 1]));
        $locked($this->postJson('/api/v1/storefront/builder/publish-all', ['documents' => [$home]]));
        // Not draft writes: renaming and the page check stay possible.
        $this->patchJson(self::DOCS."/{$home}", ['title' => 'Front page'])->assertOk();
        $this->postJson(self::DOCS."/{$home}/check")->assertOk();
        // Copy into: only the locked page fails.
        $results = $this->postJson('/api/v1/storefront/builder/sections/copy', [
            'section' => ['id' => 's_x', 'type' => 'section', 'columns' => [['id' => 'c_x', 'width' => ['base' => 100], 'elements' => [self::heading('Copied', 'e_x')]]]],
            'document_ids' => [$home, $landing],
            'position' => 'bottom',
        ])->assertOk()->json('data.results');
        $this->assertSame(['failed', 'copied'], array_column($results, 'status'));
        $this->assertSame('DOCUMENT_LOCKED', $results[0]['error']['code']);

        // The holder keeps working; deleting the landing page is not blocked by the home page's lock.
        $this->actingAsUser($editor);
        $this->save($home, self::page([self::heading('Rima was here')]))->assertOk();
        $this->postJson(self::DOCS."/{$home}/checkpoints", ['name' => 'Mine'])->assertCreated();

        // Without storefront.manage, editing is ignored.
        $this->actingAsUser($viewer);
        $this->beat($landing)->assertOk()->assertJsonPath('data.lock', null)->assertJsonPath('data.mine', false);

        // editing: false from the holder releases the lease; the next editor takes it.
        $this->actingAsUser($editor);
        $this->beat($home, false)->assertOk()->assertJsonPath('data.lock', null);
        $this->actingAsUser($publisher);
        $this->beat($home)->assertOk()->assertJsonPath('data.mine', true);
        $this->postJson(self::DOCS."/{$home}/publish")->assertOk();

        // Leaving releases the lease and removes the entry.
        $this->deleteJson(self::DOCS."/{$home}/presence")->assertNoContent();
        $this->actingAsUser($editor);
        $state = $this->beat($home, false)->assertOk()->assertJsonPath('data.lock', null)->json('data');
        $this->assertSame([$editor->id], array_column(array_column($state['viewers'], 'user'), 'id'));

        // A lease and a presence entry end after silence.
        $this->beat($home)->assertOk()->assertJsonPath('data.mine', true);
        $this->travel(61)->seconds();
        $this->actingAsUser($publisher);
        $state = $this->beat($home, false)->assertOk()->assertJsonPath('data.lock.user.id', $editor->id)->json('data');
        $this->assertSame([$publisher->id], array_column(array_column($state['viewers'], 'user'), 'id'));
        $this->travel(30)->seconds();
        $this->beat($home, false)->assertOk()->assertJsonPath('data.lock', null);
        $this->save($home, self::page([self::heading('Free again')]))->assertOk();

        $this->actingAsUser($admin);
        $this->deleteJson(self::DOCS."/{$landing}")->assertNoContent();
    }

    public function test_take_over_and_ask_to_edit(): void
    {
        $home = $this->home();
        $editor = $this->staff(['storefront.view', 'storefront.manage'], 'Rima');
        $manager = $this->staff(['storefront.view', 'storefront.manage'], 'Nila');
        $publisher = $this->staff(['storefront.view', 'storefront.manage', 'storefront.publish'], 'Karim');
        $viewer = $this->staff(['storefront.view'], 'Viewer');

        $this->actingAsUser($manager);
        $this->postJson(self::DOCS."/{$home}/lock/request")->assertStatus(409)->assertJsonPath('error.code', 'NOT_LOCKED');

        $this->actingAsUser($editor);
        $this->beat($home)->assertOk()->assertJsonPath('data.mine', true);
        $this->postJson(self::DOCS."/{$home}/lock/request")->assertStatus(409);

        // Ask to edit: a bell for the editor, once a minute.
        $this->actingAsUser($manager);
        $this->postJson(self::DOCS."/{$home}/lock/request")->assertOk()->assertJsonPath('data.sent', true);
        $this->postJson(self::DOCS."/{$home}/lock/request")->assertOk()->assertJsonPath('data.sent', false);
        $this->assertSame(1, $this->notifications($editor, BuilderCollaborationNotification::EDIT_REQUESTED));
        $data = json_decode((string) DB::table('notifications')->where('notifiable_id', $editor->id)->value('data'), true);
        $this->assertSame('Nila asks to edit Home', $data['title']);
        $this->assertSame("/storefront/builder/{$home}", $data['link']);

        // Taking a live lease needs storefront.publish; the view-only can't even ask.
        $this->postJson(self::DOCS."/{$home}/lock/take-over")->assertForbidden()->assertJsonPath('error.code', 'TAKE_OVER_FORBIDDEN')
            ->assertJsonPath('error.details.user.id', $editor->id);
        $this->actingAsUser($viewer);
        $this->postJson(self::DOCS."/{$home}/lock/take-over")->assertForbidden();
        $this->postJson(self::DOCS."/{$home}/lock/request")->assertForbidden();

        $this->actingAsUser($publisher);
        $this->postJson(self::DOCS."/{$home}/lock/take-over")->assertOk()
            ->assertJsonPath('data.mine', true)->assertJsonPath('data.lock.user.id', $publisher->id);
        $this->assertSame(1, $this->notifications($editor, BuilderCollaborationNotification::LOCK_TAKEN_OVER));
        $data = json_decode((string) DB::table('notifications')->where('notifiable_id', $editor->id)
            ->where('type', BuilderCollaborationNotification::LOCK_TAKEN_OVER)->value('data'), true);
        $this->assertSame('Karim took over editing Home', $data['title']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'storefront.builder_lock_taken_over', 'subject_id' => $home, 'user_id' => $publisher->id]);
        // Taking it again is a no-op (no second audit or bell).
        $this->postJson(self::DOCS."/{$home}/lock/take-over")->assertOk();
        $this->assertSame(1, DB::table('audit_logs')->where('action', 'storefront.builder_lock_taken_over')->count());

        // The previous editor's next heartbeat is view-only; their saves are 423.
        $this->actingAsUser($editor);
        $this->beat($home)->assertOk()->assertJsonPath('data.mine', false)->assertJsonPath('data.lock.user.id', $publisher->id);
        $this->save($home, self::page([self::heading('Late')]))->assertStatus(423);

        // After the lease expired anyone who may edit can take over (no bell: nobody held it).
        $this->travel(91)->seconds();
        $this->actingAsUser($manager);
        $this->postJson(self::DOCS."/{$home}/lock/take-over")->assertOk()->assertJsonPath('data.mine', true);
        $this->assertSame(0, $this->notifications($publisher, BuilderCollaborationNotification::LOCK_TAKEN_OVER));
    }

    public function test_comments_threads_replies_mentions_resolve_edit_and_delete(): void
    {
        $admin = $this->t['admin'];
        $home = $this->home();
        $rima = $this->staff(['storefront.view', 'storefront.manage'], 'Rima Akter');
        $short = $this->staff(['storefront.view'], 'Rima');
        $karim = $this->staff(['storefront.view'], 'Karim');
        $nobody = $this->staff(['forms.view'], 'Nobody');
        $url = self::DOCS."/{$home}/comments";

        // Someone else holds the lock: commenting is still possible.
        $this->actingAsUser($rima);
        $this->beat($home)->assertOk()->assertJsonPath('data.mine', true);

        $this->actingAsUser($admin);
        $this->postJson($url, ['body' => '   '])->assertUnprocessable();
        $this->postJson($url, ['body' => 'Hi', 'anchor' => ['x' => 2, 'y' => 0.5]])->assertUnprocessable();
        $this->postJson($url, ['body' => str_repeat('a', 2001)])->assertUnprocessable();
        $this->postJson($url, ['body' => 'Hi', 'node_id' => 'e_gone'])->assertUnprocessable()->assertJsonPath('error.code', 'NODE_NOT_FOUND');

        $thread = $this->postJson($url, [
            'node_id' => 'e_title',
            'anchor' => ['x' => 0.5, 'y' => 0.25],
            'body' => 'Hi @Rima Akter and @Nobody — the title is too long.',
            'mentions' => [$karim->id, $nobody->id, '01900000-0000-7000-8000-00000000abcd'],
        ])->assertCreated()
            ->assertJsonPath('data.number', 1)
            ->assertJsonPath('data.node_id', 'e_title')
            ->assertJsonPath('data.node_removed', false)
            ->assertJsonPath('data.anchor.x', 0.5)
            ->assertJsonPath('data.author.id', $admin->id)
            ->assertJsonPath('data.parent_id', null)
            ->assertJsonPath('data.can_edit', true)
            ->assertJsonPath('data.can_delete', true)
            ->assertJsonPath('data.replies', [])
            ->json('data');
        // "@Rima Akter" is not also "@Rima"; picked ids count only for builder viewers.
        $this->assertEqualsCanonicalizing([$rima->id, $karim->id], array_column($thread['mentions'], 'id'));
        $this->assertSame(1, $this->notifications($rima, BuilderCollaborationNotification::COMMENT_MENTION));
        $this->assertSame(1, $this->notifications($karim, BuilderCollaborationNotification::COMMENT_MENTION));
        $this->assertSame(0, $this->notifications($short, BuilderCollaborationNotification::COMMENT_MENTION));
        $this->assertSame(0, DB::table('notifications')->where('notifiable_id', $nobody->id)->count());
        $data = json_decode((string) DB::table('notifications')->where('notifiable_id', $rima->id)->value('data'), true);
        $this->assertSame('Owner of Berry Kids mentioned you on Home', $data['title']);
        $this->assertSame("/storefront/builder/{$home}?comment={$thread['id']}", $data['link']);
        $this->assertArrayNotHasKey('body', $data);

        $second = $this->postJson($url, ['body' => 'On the page', 'anchor' => ['x' => 0.1, 'y' => 0.9]])->assertCreated()
            ->assertJsonPath('data.number', 2)->assertJsonPath('data.node_id', null)->json('data.id');

        // Replies: one level, to this page's threads only; the thread's participants hear about them.
        $this->actingAsUser($karim);
        $this->postJson($url, ['body' => 'Nested', 'parent_id' => '01900000-0000-7000-8000-00000000abcd'])->assertUnprocessable()->assertJsonPath('error.code', 'INVALID_PARENT');
        $reply = $this->postJson($url, ['body' => 'Agreed', 'parent_id' => $thread['id'], 'node_id' => 'e_title'])->assertCreated()
            ->assertJsonPath('data.parent_id', $thread['id'])->assertJsonPath('data.number', null)->assertJsonPath('data.node_id', null)
            ->assertJsonPath('data.can_delete', true)
            ->json('data.id');
        $this->postJson($url, ['body' => 'Deeper', 'parent_id' => $reply])->assertUnprocessable()->assertJsonPath('error.code', 'INVALID_PARENT');
        $this->assertSame(1, $this->notifications($admin, BuilderCollaborationNotification::COMMENT_REPLY));
        $this->assertSame(0, $this->notifications($rima, BuilderCollaborationNotification::COMMENT_REPLY));
        $this->actingAsUser($rima);
        $rimaReply = $this->postJson($url, ['body' => 'Fixed it', 'parent_id' => $thread['id']])->assertCreated()->json('data.id');
        $this->assertSame(2, $this->notifications($admin, BuilderCollaborationNotification::COMMENT_REPLY));
        $this->assertSame(1, $this->notifications($karim, BuilderCollaborationNotification::COMMENT_REPLY));

        $list = $this->getJson($url)->assertOk()->assertJsonPath('meta.counts.open', 2)->assertJsonPath('meta.counts.resolved', 0)->json('data');
        $this->assertSame([$thread['id'], $second], array_column($list, 'id'));
        $this->assertSame([$reply, $rimaReply], array_column($list[0]['replies'], 'id'));
        $this->assertSame('Karim', $list[0]['replies'][0]['author']['name']);
        $this->assertFalse($list[0]['can_edit']);
        $this->assertTrue($list[0]['replies'][1]['can_edit']);

        // Edit: the author only, within 15 minutes; new mentions are notified.
        $this->patchJson("{$url}/{$thread['id']}", ['body' => 'Mine now'])->assertForbidden()->assertJsonPath('error.code', 'COMMENT_NOT_YOURS');
        $this->actingAsUser($admin);
        $this->patchJson("{$url}/{$thread['id']}", ['body' => 'The title is too long, @Rima Akter @Rima'])->assertOk()
            ->assertJsonPath('data.body', 'The title is too long, @Rima Akter @Rima')
            ->assertJsonPath('data.replies.0.id', $reply);
        $this->assertNotNull(DB::table('builder_comments')->where('id', $thread['id'])->value('edited_at'));
        $this->assertSame(1, $this->notifications($rima, BuilderCollaborationNotification::COMMENT_MENTION));
        $this->assertSame(1, $this->notifications($short, BuilderCollaborationNotification::COMMENT_MENTION));
        $this->travel(16)->minutes();
        $this->patchJson("{$url}/{$thread['id']}", ['body' => 'Too late'])->assertUnprocessable()->assertJsonPath('error.code', 'COMMENT_EDIT_CLOSED');

        // Resolve / reopen threads (audited); replies can't be.
        $this->postJson("{$url}/{$reply}/resolve")->assertUnprocessable()->assertJsonPath('error.code', 'NOT_A_THREAD');
        $this->actingAsUser($karim);
        $this->postJson("{$url}/{$thread['id']}/resolve")->assertOk()
            ->assertJsonPath('data.resolved_by.id', $karim->id)->assertJsonPath('data.resolved_by.name', 'Karim');
        $this->getJson($url)->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $second);
        $this->getJson("{$url}?status=resolved")->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('meta.counts.resolved', 1);
        $this->getJson("{$url}?status=nope")->assertUnprocessable();
        $this->assertDatabaseHas('audit_logs', ['action' => 'storefront.builder_comment_resolved', 'subject_id' => $home, 'user_id' => $karim->id]);
        $this->postJson("{$url}/{$thread['id']}/reopen")->assertOk()->assertJsonPath('data.resolved_at', null);
        $this->assertDatabaseHas('audit_logs', ['action' => 'storefront.builder_comment_reopened', 'subject_id' => $home]);

        // A removed part keeps its comments.
        $this->actingAsUser($rima);
        $this->save($home, self::page([self::heading('Short', 'e_other')]))->assertOk();
        $this->getJson("{$url}?status=all")->assertOk()->assertJsonPath('data.0.node_removed', true)->assertJsonPath('data.0.node_id', 'e_title');
        $this->beat($home)->assertOk()->assertJsonPath('data.comments.open', 2);

        // Delete: the author or a publisher; a thread goes with its replies.
        $this->actingAsUser($karim);
        $this->deleteJson("{$url}/{$thread['id']}")->assertForbidden()->assertJsonPath('error.code', 'COMMENT_NOT_YOURS');
        $this->actingAsUser($rima);
        $this->deleteJson("{$url}/{$rimaReply}")->assertNoContent();
        $this->getJson($url)->assertOk()->assertJsonCount(1, 'data.0.replies');
        $this->actingAsUser($admin);
        $this->deleteJson("{$url}/{$thread['id']}")->assertNoContent();
        $this->assertSoftDeleted('builder_comments', ['id' => $reply]);
        $this->getJson("{$url}?status=all")->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $second);
        $this->assertDatabaseHas('audit_logs', ['action' => 'storefront.builder_comment_deleted', 'subject_id' => $home, 'user_id' => $admin->id]);
        // A new thread still gets a new number.
        $this->postJson($url, ['body' => 'Third'])->assertCreated()->assertJsonPath('data.number', 3);
        $this->deleteJson("{$url}/{$thread['id']}")->assertNotFound();
    }

    public function test_mentionable_staff_are_builder_viewers_of_the_organization(): void
    {
        $this->staff(['storefront.view'], 'Rima Akter');
        $this->staff(['storefront.view', 'storefront.manage'], 'Karim');
        $this->staff(['forms.view'], 'Rima Hidden');
        $other = $this->provisionTenant('Other Shop');
        $this->actingAsUser($other['admin']);
        $this->getJson('/api/v1/storefront/builder/mentionable?q=rima')->assertOk()->assertJsonCount(0, 'data');

        $this->actingAsUser($this->t['admin']);
        $all = $this->getJson('/api/v1/storefront/builder/mentionable')->assertOk()->json('data');
        $this->assertContains('Karim', array_column($all, 'name'));
        $this->assertContains('Owner of Berry Kids', array_column($all, 'name'));
        $this->assertNotContains('Rima Hidden', array_column($all, 'name'));
        $this->assertSame(['id', 'name'], array_keys($all[0]));
        $this->getJson('/api/v1/storefront/builder/mentionable?q=RIMA')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.name', 'Rima Akter');
    }

    public function test_activity_merges_the_audit_log_and_edit_sessions_newest_first_and_pages(): void
    {
        $admin = $this->t['admin'];
        $this->travelTo(CarbonImmutable::parse('2026-11-20 09:00:00'));
        $home = $this->home();
        $this->travel(5)->minutes();
        $this->save($home, self::page([self::heading('Two')]))->assertOk();
        $this->travel(5)->minutes();
        $this->save($home, self::page([self::heading('Three')]))->assertOk();
        $this->travel(20)->minutes();
        $this->save($home, self::page([self::heading('Four')]))->assertOk();
        $this->travel(1)->minutes();
        $version = $this->postJson(self::DOCS."/{$home}/publish", ['note' => 'Eid'])->assertOk()->json('data.published.version_id');
        $this->travel(1)->minutes();
        $this->patchJson(self::DOCS."/{$home}", ['title' => 'Front page'])->assertOk();
        $this->travel(1)->minutes();
        $this->postJson(self::DOCS."/{$home}/versions/{$version}/restore")->assertOk();
        $this->assertSame(2, DB::table('builder_edit_sessions')->where('document_id', $home)->count());

        $items = $this->getJson(self::DOCS."/{$home}/activity")->assertOk()
            ->assertHeader('Cache-Control', 'no-store, private')
            ->assertJsonPath('meta.next_before', null)->json('data');
        $this->assertSame(['restored', 'renamed', 'published', 'edited', 'edited', 'created'], array_column($items, 'action'));
        $this->assertSame('Restored version 1 into the draft', $items[0]['summary']);
        $this->assertSame($version, $items[0]['details']['version_id']);
        $this->assertSame(1, $items[0]['details']['version_number']);
        $this->assertSame('Renamed it from “Home” to “Front page”', $items[1]['summary']);
        $this->assertSame('Published version 1', $items[2]['summary']);
        $this->assertSame(['version_id' => $version, 'version_number' => 1, 'note' => 'Eid', 'via' => 'manual'], $items[2]['details']);
        $this->assertSame('Edited the draft (1 save)', $items[3]['summary']);
        $this->assertSame('Edited the draft (3 saves)', $items[4]['summary']);
        $this->assertSame('2026-11-20T09:00:00.000Z', $items[4]['details']['started_at']);
        $this->assertSame('2026-11-20T09:10:00.000Z', $items[4]['details']['ended_at']);
        $this->assertSame(['id' => $admin->id, 'name' => 'Owner of Berry Kids'], $items[4]['user']);
        $this->assertSame('Created the page', $items[5]['summary']);

        // Paging with `before`.
        $seen = [];
        $before = null;
        do {
            $page = $this->getJson(self::DOCS."/{$home}/activity?limit=2".($before === null ? '' : '&before='.$before))->assertOk();
            $this->assertLessThanOrEqual(2, count($page->json('data')));
            $seen = [...$seen, ...array_column($page->json('data'), 'id')];
            $before = $page->json('meta.next_before');
        } while ($before !== null);
        $this->assertSame(array_column($items, 'id'), $seen);

        // Entries of the same second never straddle a page.
        $this->travel(1)->minutes();
        $this->postJson(self::DOCS."/{$home}/publish")->assertOk();
        $this->patchJson(self::DOCS."/{$home}", ['title' => 'Same second'])->assertOk();
        $this->travel(1)->minutes();
        $this->patchJson(self::DOCS."/{$home}", ['title' => 'Later'])->assertOk();
        $first = $this->getJson(self::DOCS."/{$home}/activity?limit=2")->assertOk()->assertJsonCount(1, 'data');
        $rest = $this->getJson(self::DOCS."/{$home}/activity?limit=50&before=".$first->json('meta.next_before'))->assertOk()->json('data');
        $this->assertEqualsCanonicalizing(['renamed', 'published'], array_slice(array_column($rest, 'action'), 0, 2));
        $this->assertCount(9, [...$first->json('data'), ...$rest]);
    }

    public function test_collaboration_is_isolated_per_organization_and_needs_permissions(): void
    {
        $home = $this->home();
        $comment = $this->postJson(self::DOCS."/{$home}/comments", ['body' => 'Ours'])->assertCreated()->json('data.id');
        $landing = $this->postJson(self::DOCS, ['kind' => 'page', 'key' => 'landing:eid', 'title' => 'Eid sale'])->assertCreated()->json('data.id');
        // A comment belongs to its own page.
        $this->patchJson(self::DOCS."/{$landing}/comments/{$comment}", ['body' => 'x'])->assertNotFound();
        $this->deleteJson(self::DOCS."/{$landing}/comments/{$comment}")->assertNotFound();

        $other = $this->provisionTenant('Other Shop');
        $this->actingAsUser($other['admin']);
        $this->beat($home)->assertNotFound();
        $this->deleteJson(self::DOCS."/{$home}/presence")->assertNotFound();
        $this->postJson(self::DOCS."/{$home}/lock/take-over")->assertNotFound();
        $this->getJson(self::DOCS."/{$home}/comments")->assertNotFound();
        $this->postJson(self::DOCS."/{$home}/comments", ['body' => 'Theirs'])->assertNotFound();
        $this->postJson(self::DOCS."/{$home}/comments/{$comment}/resolve")->assertNotFound();
        $this->getJson(self::DOCS."/{$home}/activity")->assertNotFound();

        $outsider = $this->staff(['forms.view'], 'Outsider');
        $this->actingAsUser($outsider);
        $this->beat($home)->assertForbidden();
        $this->getJson(self::DOCS."/{$home}/comments")->assertForbidden();
        $this->getJson(self::DOCS."/{$home}/activity")->assertForbidden();
        $this->getJson('/api/v1/storefront/builder/mentionable')->assertForbidden();
    }
}
