<?php

namespace App\Modules\System\Tests\Feature;

use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\System\Infrastructure\Console\HeartbeatCommand;
use App\Modules\System\Infrastructure\Jobs\QueueHeartbeat;
use App\Modules\System\Infrastructure\Models\ErrorEvent;
use App\Modules\System\Infrastructure\Models\SystemBackup;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Tests\TestCase;

class SystemStatusTest extends TestCase
{
    use InteractsWithTenancy, RefreshDatabase;

    private function platformAdmin(): User
    {
        $admin = User::factory()->platformAdmin()->create();
        $this->actingAsUser($admin);

        return $admin;
    }

    /**
     * @return list<string>
     */
    private function warningCodes(): array
    {
        return array_column($this->getJson('/api/v1/platform/system/status')->assertOk()->json('data.warnings'), 'code');
    }

    public function test_operations_endpoints_are_for_platform_admins_only(): void
    {
        ['admin' => $owner] = $this->provisionTenant();
        // Existing rows, so route-model binding cannot answer 404 before the platform check.
        $backup = SystemBackup::query()->create(['started_at' => now(), 'status' => 'failed', 'triggered_by' => 'user']);
        $error = ErrorEvent::query()->create([
            'fingerprint' => str_repeat('c', 64), 'exception_class' => 'RuntimeException', 'message' => 'x',
            'occurrences' => 1, 'first_seen_at' => now(), 'last_seen_at' => now(), 'status' => 'open',
        ]);
        $endpoints = [
            ['get', '/api/v1/platform/system/status'],
            ['get', '/api/v1/platform/system/backups'],
            ['post', '/api/v1/platform/system/backups'],
            ['post', "/api/v1/platform/system/backups/{$backup->id}/verify"],
            ['get', '/api/v1/platform/system/failed-jobs'],
            ['post', '/api/v1/platform/system/failed-jobs/retry-all'],
            ['post', '/api/v1/platform/system/failed-jobs/abc/retry'],
            ['delete', '/api/v1/platform/system/failed-jobs/abc'],
            ['get', '/api/v1/platform/system/errors'],
            ['get', "/api/v1/platform/system/errors/{$error->id}"],
            ['patch', "/api/v1/platform/system/errors/{$error->id}"],
            ['post', '/api/v1/platform/system/mail-test'],
        ];

        foreach ($endpoints as [$method, $uri]) {
            $this->json($method, $uri)->assertUnauthorized();
        }

        $this->actingAsUser($owner);
        foreach ($endpoints as [$method, $uri]) {
            $this->json($method, $uri)->assertForbidden()->assertJsonPath('error.code', 'FORBIDDEN');
        }
    }

    public function test_status_shape_for_a_platform_admin_without_an_organization(): void
    {
        $this->platformAdmin();

        $this->getJson('/api/v1/platform/system/status')
            ->assertOk()
            ->assertJsonPath('data.checks.database', 'ok')
            ->assertJsonPath('data.checks.cache', 'ok')
            ->assertJsonPath('data.checks.scheduler.status', 'unknown')
            ->assertJsonPath('data.checks.queue.status', 'sync')
            ->assertJsonPath('data.checks.queue.driver', 'sync')
            ->assertJsonPath('data.checks.backups.status', 'disabled')
            ->assertJsonPath('data.checks.backups.enabled', false)
            ->assertJsonPath('data.checks.errors.open', 0)
            ->assertJsonPath('data.app.environment', 'testing')
            ->assertJsonPath('data.app.php_version', PHP_VERSION)
            ->assertJsonPath('data.retention.last_run_at', null)
            ->assertJsonStructure(['data' => [
                'checks' => [
                    'database', 'cache',
                    'scheduler' => ['status', 'last_heartbeat_at'],
                    'queue' => ['status', 'driver', 'last_heartbeat_at', 'pending_jobs', 'failed_jobs'],
                    'mail' => ['status', 'mailer', 'from_address'],
                    'backups' => ['status', 'enabled', 'schedule_time', 'keep_days', 'last_success_at', 'last_file', 'last_size_bytes', 'last_verified_at', 'verify_status', 'last_failure_at'],
                    'storage' => ['status', 'path', 'free_bytes', 'total_bytes'],
                    'errors' => ['open', 'new_last_24h'],
                ],
                'app' => ['environment', 'debug', 'php_version', 'laravel_version', 'timezone'],
                'retention' => ['last_run_at', 'deleted'],
                'warnings' => ['*' => ['code', 'message']],
            ]])
            ->assertJsonMissingPath('data.checks.backups._problems');
    }

    public function test_heartbeat_command_beats_for_the_scheduler_and_queues_the_worker_beat(): void
    {
        $this->travelTo(now()->setTime(10, 0));
        Queue::fake();

        $this->artisan('pos:heartbeat')->assertSuccessful();

        $this->assertSame(now()->toIso8601String(), Cache::get(HeartbeatCommand::SCHEDULER_KEY));
        Queue::assertPushed(QueueHeartbeat::class);
        $this->assertNull(Cache::get(QueueHeartbeat::CACHE_KEY));

        (new QueueHeartbeat)->handle();
        $this->assertSame(now()->toIso8601String(), Cache::get(QueueHeartbeat::CACHE_KEY));
    }

    public function test_scheduler_and_queue_status_follow_the_heartbeats(): void
    {
        $this->platformAdmin();
        config(['queue.default' => 'database']);
        $this->travelTo(now()->setTime(10, 0));

        $this->getJson('/api/v1/platform/system/status')
            ->assertJsonPath('data.checks.scheduler.status', 'unknown')
            ->assertJsonPath('data.checks.queue.status', 'unknown')
            ->assertJsonPath('data.checks.queue.driver', 'database')
            ->assertJsonPath('data.checks.queue.pending_jobs', 0);
        $this->assertContains('SCHEDULER_STALE', $this->warningCodes());
        $this->assertContains('QUEUE_STALE', $this->warningCodes());

        // The scheduler beats; the database queue runs the heartbeat job.
        $this->artisan('pos:heartbeat')->assertSuccessful();
        $this->assertSame(1, DB::table('jobs')->count());
        (new QueueHeartbeat)->handle();

        $this->travel(3)->minutes();
        $this->getJson('/api/v1/platform/system/status')
            ->assertJsonPath('data.checks.scheduler.status', 'ok')
            ->assertJsonPath('data.checks.scheduler.last_heartbeat_at', now()->subMinutes(3)->toIso8601String())
            ->assertJsonPath('data.checks.queue.status', 'ok')
            ->assertJsonPath('data.checks.queue.pending_jobs', 1);

        $this->travel(1)->minutes();
        $this->getJson('/api/v1/platform/system/status')
            ->assertJsonPath('data.checks.scheduler.status', 'stale')
            ->assertJsonPath('data.checks.queue.status', 'ok');

        $this->travel(2)->minutes();
        $this->getJson('/api/v1/platform/system/status')->assertJsonPath('data.checks.queue.status', 'stale');
        $this->assertContains('QUEUE_STALE', $this->warningCodes());
    }

    public function test_warnings(): void
    {
        $this->platformAdmin();

        $codes = $this->warningCodes();
        $this->assertContains('BACKUPS_DISABLED', $codes);
        $this->assertNotContains('APP_DEBUG_ON', $codes);
        $this->assertNotContains('FAILED_JOBS', $codes);
        $this->assertNotContains('OPEN_ERRORS', $codes);

        DB::table('failed_jobs')->insert(['uuid' => (string) Str::uuid(), 'connection' => 'database', 'queue' => 'default', 'payload' => '{}', 'exception' => 'RuntimeException: x', 'failed_at' => now()]);
        ErrorEvent::query()->create([
            'fingerprint' => str_repeat('a', 64), 'exception_class' => 'RuntimeException', 'message' => 'x',
            'occurrences' => 1, 'first_seen_at' => now(), 'last_seen_at' => now(), 'status' => 'open',
        ]);
        $this->getJson('/api/v1/platform/system/status')
            ->assertJsonPath('data.checks.queue.failed_jobs', 1)
            ->assertJsonPath('data.checks.errors.open', 1)
            ->assertJsonPath('data.checks.errors.new_last_24h', 1);
        $codes = $this->warningCodes();
        $this->assertContains('FAILED_JOBS', $codes);
        $this->assertContains('OPEN_ERRORS', $codes);

        // Production with debug on, the log mailer and the sync queue.
        $this->app['env'] = 'production';
        config(['app.debug' => true, 'mail.default' => 'log']);
        $codes = $this->warningCodes();
        $this->assertContains('APP_DEBUG_ON', $codes);
        $this->assertContains('MAIL_NOT_SENDING', $codes);
        $this->assertContains('QUEUE_SYNC_IN_PRODUCTION', $codes);

        config(['mail.default' => 'smtp', 'mail.from.address' => null]);
        $this->getJson('/api/v1/platform/system/status')->assertJsonPath('data.checks.mail.status', 'warn');
        config(['mail.from.address' => 'shop@example.com']);
        $this->getJson('/api/v1/platform/system/status')->assertJsonPath('data.checks.mail.status', 'ok');
    }

    public function test_backup_status_rules(): void
    {
        $this->platformAdmin();
        config(['pos.backup.enabled' => true]);
        $this->travelTo(now()->setTime(10, 0));

        $this->getJson('/api/v1/platform/system/status')->assertJsonPath('data.checks.backups.status', 'fail');
        $this->assertContains('BACKUP_STALE', $this->warningCodes());

        $backup = SystemBackup::query()->create([
            'started_at' => now()->subHours(30), 'finished_at' => now()->subHours(30), 'status' => 'succeeded',
            'file_name' => 'pos-pos_test-old.dump', 'size_bytes' => 1234, 'sha256' => str_repeat('b', 64), 'triggered_by' => 'schedule',
        ]);
        $this->assertContains('BACKUP_STALE', $this->warningCodes());

        // Fresh, but never verified.
        $backup->update(['started_at' => now()->subHours(2), 'finished_at' => now()->subHours(2)]);
        $this->getJson('/api/v1/platform/system/status')
            ->assertJsonPath('data.checks.backups.status', 'warn')
            ->assertJsonPath('data.checks.backups.last_file', 'pos-pos_test-old.dump')
            ->assertJsonPath('data.checks.backups.last_size_bytes', 1234)
            ->assertJsonPath('data.checks.backups.last_success_at', now()->subHours(2)->toIso8601String());
        $codes = $this->warningCodes();
        $this->assertContains('BACKUP_UNVERIFIED', $codes);
        $this->assertNotContains('BACKUP_STALE', $codes);
        $this->assertNotContains('BACKUPS_DISABLED', $codes);

        $backup->update(['verified_at' => now()->subHour(), 'verify_status' => 'passed', 'verify_mode' => 'list']);
        $this->getJson('/api/v1/platform/system/status')
            ->assertJsonPath('data.checks.backups.status', 'ok')
            ->assertJsonPath('data.checks.backups.verify_status', 'passed');

        $backup->update(['verified_at' => now()->subDays(9)]);
        $this->getJson('/api/v1/platform/system/status')->assertJsonPath('data.checks.backups.status', 'warn');
        $backup->update(['verified_at' => now()->subHour()]);

        // The latest run failed.
        SystemBackup::query()->create(['started_at' => now()->subMinutes(30), 'finished_at' => now()->subMinutes(29), 'status' => 'failed', 'error' => 'pg_dump failed', 'triggered_by' => 'user']);
        $this->getJson('/api/v1/platform/system/status')
            ->assertJsonPath('data.checks.backups.status', 'fail')
            ->assertJsonPath('data.checks.backups.last_failure_at', now()->subMinutes(29)->toIso8601String());
        $this->assertContains('BACKUP_FAILED', $this->warningCodes());
    }

    public function test_the_scheduler_runs_heartbeat_and_retention_and_backups_only_when_enabled(): void
    {
        $events = collect(app(Schedule::class)->events())->mapWithKeys(fn ($event) => [trim(Str::after((string) $event->command, 'artisan')) => $event]);
        $heartbeat = $events->first(fn ($e, $command) => str_contains($command, 'pos:heartbeat'));
        $prune = $events->first(fn ($e, $command) => str_contains($command, 'pos:prune-records'));

        $this->assertNotNull($heartbeat);
        $this->assertSame('* * * * *', $heartbeat->expression);
        $this->assertNotNull($prune);
        $this->assertTrue($prune->withoutOverlapping);
        $this->assertFalse($events->keys()->contains(fn ($command) => str_contains($command, 'pos:backup')));
    }
}
