<?php

namespace App\Modules\System\Tests\Feature;

use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\System\Application\Actions\PruneRecords;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * G1b: `pos:prune-records` (data retention).
 */
class DataRetentionTest extends TestCase
{
    use InteractsWithTenancy, RefreshDatabase;

    private string $organizationId;

    private string $userId;

    protected function setUp(): void
    {
        parent::setUp();

        config(['pos.retention' => [
            'login_activities' => 365, 'notifications' => 180, 'failed_jobs' => 30, 'ai_requests' => 365,
            'error_events' => 90, 'audit_logs' => null, 'system_backups' => 90,
        ]]);
        ['organization' => $organization, 'admin' => $admin] = $this->provisionTenant();
        $this->organizationId = $organization->id;
        $this->userId = $admin->id;
        $this->seedRecords();
    }

    /**
     * For every table: one row just past the cut-off (pruned) and one inside it (kept), plus the
     * rows that must survive whatever their age.
     */
    private function seedRecords(): void
    {
        foreach (['old' => 400, 'new' => 10] as $tag => $days) {
            DB::table('login_activities')->insert(['id' => Str::uuid(), 'email' => "{$tag}@example.com", 'channel' => 'session', 'succeeded' => true, 'created_at' => now()->subDays($days)]);
            DB::table('failed_jobs')->insert(['uuid' => (string) Str::uuid(), 'connection' => 'database', 'queue' => $tag, 'payload' => '{}', 'exception' => 'x', 'failed_at' => now()->subDays($days === 400 ? 31 : 29)->utc()->format('Y-m-d H:i:s')]);
            DB::table('ai_requests')->insert(['id' => Str::uuid(), 'organization_id' => $this->organizationId, 'feature' => $tag, 'status' => 'ok', 'created_at' => now()->subDays($days)]);
            DB::table('audit_logs')->insert(['id' => Str::uuid(), 'action' => "g1b.{$tag}", 'created_at' => now()->subDays($days)]);
        }

        foreach ([['read', 200, now()->subDays(190)], ['unread-old', 200, null], ['read-new', 100, now()->subDays(90)]] as [$tag, $days, $readAt]) {
            DB::table('notifications')->insert([
                'id' => Str::uuid(), 'type' => $tag, 'notifiable_type' => 'users', 'notifiable_id' => $this->userId,
                'data' => '{}', 'read_at' => $readAt, 'created_at' => now()->subDays($days), 'updated_at' => now()->subDays($days),
            ]);
        }

        foreach ([['resolved', 100], ['ignored', 100], ['open', 100], ['resolved', 10]] as [$status, $days]) {
            DB::table('error_events')->insert([
                'id' => Str::uuid(), 'fingerprint' => hash('sha256', Str::random()), 'exception_class' => $status, 'message' => 'x',
                'occurrences' => 1, 'first_seen_at' => now()->subDays($days), 'last_seen_at' => now()->subDays($days), 'status' => $status,
                'created_at' => now()->subDays($days), 'updated_at' => now()->subDays($days),
            ]);
        }

        foreach ([['failed', null, 100], ['succeeded', now()->subDays(95), 100], ['succeeded', null, 100], ['failed', null, 10]] as [$status, $fileDeletedAt, $days]) {
            DB::table('system_backups')->insert([
                'id' => Str::uuid(), 'started_at' => now()->subDays($days), 'status' => $status, 'triggered_by' => 'schedule',
                'file_deleted_at' => $fileDeletedAt, 'created_at' => now()->subDays($days), 'updated_at' => now()->subDays($days),
            ]);
        }
    }

    /**
     * @return array<string, int>
     */
    private function counts(): array
    {
        return collect(['login_activities', 'notifications', 'failed_jobs', 'ai_requests', 'error_events', 'system_backups'])
            ->mapWithKeys(fn (string $table) => [$table => DB::table($table)->count()])
            ->put('audit_logs', DB::table('audit_logs')->where('action', 'like', 'g1b.%')->count())
            ->all();
    }

    public function test_dry_run_only_counts(): void
    {
        $before = $this->counts();

        $this->artisan('pos:prune-records', ['--dry-run' => true])
            ->expectsTable(['Table', 'Would delete'], [
                ['login_activities', 1], ['notifications', 1], ['failed_jobs', 1], ['ai_requests', 1], ['error_events', 2], ['system_backups', 2],
            ])
            ->assertSuccessful();

        $this->assertSame($before, $this->counts());
        $this->assertNull(Cache::get(PruneRecords::CACHE_KEY));
    }

    public function test_prunes_each_table_by_its_rule_and_keeps_audit_logs_by_default(): void
    {
        $this->artisan('pos:prune-records')->assertSuccessful();

        $this->assertSame(['new@example.com'], DB::table('login_activities')->pluck('email')->all());
        $this->assertEqualsCanonicalizing(['unread-old', 'read-new'], DB::table('notifications')->pluck('type')->all());
        $this->assertSame(['new'], DB::table('failed_jobs')->pluck('queue')->all());
        $this->assertSame(['new'], DB::table('ai_requests')->pluck('feature')->all());
        $this->assertEqualsCanonicalizing(['open', 'resolved'], DB::table('error_events')->pluck('exception_class')->all());
        $this->assertSame(1, DB::table('error_events')->where('status', 'open')->count());
        $this->assertSame(2, DB::table('system_backups')->count());
        $this->assertSame(1, DB::table('system_backups')->where('status', 'succeeded')->whereNull('file_deleted_at')->count(), 'a kept backup file keeps its row');
        $this->assertSame(2, DB::table('audit_logs')->where('action', 'like', 'g1b.%')->count(), 'audit logs are kept forever by default');

        $lastRun = Cache::get(PruneRecords::CACHE_KEY);
        $this->assertSame(now()->toIso8601String(), $lastRun['last_run_at']);
        $this->assertSame(['login_activities' => 1, 'notifications' => 1, 'failed_jobs' => 1, 'ai_requests' => 1, 'error_events' => 2, 'system_backups' => 2], $lastRun['deleted']);

        $this->actingAsUser(User::factory()->platformAdmin()->create());
        $this->getJson('/api/v1/platform/system/status')
            ->assertJsonPath('data.retention.last_run_at', $lastRun['last_run_at'])
            ->assertJsonPath('data.retention.deleted.error_events', 2);
    }

    public function test_audit_logs_are_pruned_only_when_configured(): void
    {
        config(['pos.retention.audit_logs' => 365]);

        $this->artisan('pos:prune-records')->assertSuccessful();

        $this->assertSame(['g1b.new'], DB::table('audit_logs')->where('action', 'like', 'g1b.%')->pluck('action')->all());
        $this->assertTrue(DB::table('audit_logs')->where('action', 'not like', 'g1b.%')->exists(), 'recent audit entries stay');
    }

    public function test_empty_or_zero_means_keep_forever_and_deletes_run_in_chunks(): void
    {
        config(['pos.retention' => ['login_activities' => '', 'notifications' => 0, 'failed_jobs' => null, 'ai_requests' => null, 'error_events' => null, 'audit_logs' => null, 'system_backups' => null]]);
        $this->artisan('pos:prune-records')->expectsOutputToContain('keep forever')->assertSuccessful();
        $this->assertSame(2, DB::table('login_activities')->count());

        // More rows than one delete statement takes.
        $rows = collect(range(1, 2105))->map(fn () => ['id' => (string) Str::uuid(), 'email' => 'bulk@example.com', 'channel' => 'token', 'succeeded' => false, 'created_at' => now()->subYears(2)]);
        $rows->chunk(500)->each(fn ($chunk) => DB::table('login_activities')->insert($chunk->values()->all()));
        config(['pos.retention.login_activities' => 365]);

        $this->assertSame(['login_activities' => 2106], app(PruneRecords::class)());
        $this->assertSame(['new@example.com'], DB::table('login_activities')->pluck('email')->all());
    }

    public function test_ai_requests_still_referenced_are_kept(): void
    {
        // DDL is transactional in PostgreSQL: the table goes with the test's rollback.
        DB::statement('CREATE TABLE g1b_ai_refs (ai_request_id uuid REFERENCES ai_requests(id))');
        $old = DB::table('ai_requests')->where('feature', 'old')->value('id');
        DB::table('g1b_ai_refs')->insert(['ai_request_id' => $old]);

        $this->assertSame(0, app(PruneRecords::class)(dryRun: true)['ai_requests']);
        DB::table('g1b_ai_refs')->delete();
        $this->assertSame(1, app(PruneRecords::class)()['ai_requests']);
    }
}
