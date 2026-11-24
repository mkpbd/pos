<?php

namespace App\Modules\System\Tests\Feature;

use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\System\Application\Actions\PerformBackup;
use App\Modules\System\Infrastructure\Jobs\RunBackup;
use App\Modules\System\Infrastructure\Jobs\VerifyBackup;
use App\Modules\System\Infrastructure\Models\SystemBackup;
use App\Modules\System\Infrastructure\Notifications\OpsAlertNotification;
use App\Modules\System\Tests\Concerns\UsesBackupFolder;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Process\PendingProcess;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * G1b: database backups (pg_dump), the off-site hook, retention, and the operator endpoints.
 * The first test runs the real pg_dump / pg_restore --list against the test database.
 */
class BackupTest extends TestCase
{
    use InteractsWithTenancy, RefreshDatabase, UsesBackupFolder;

    protected function setUp(): void
    {
        parent::setUp();

        $this->setUpBackupFolder();
        config(['pos.ops_alert_emails' => ['ops@example.com']]);
    }

    /**
     * Fakes pg_dump: writes a small file where --file= points.
     */
    private function fakeDump(): void
    {
        Process::fake([
            '*pg_dump*' => function (PendingProcess $process) {
                $target = Str::after((string) collect($process->command)->first(fn ($arg) => str_starts_with($arg, '--file=')), '--file=');
                file_put_contents($target, 'PGDMP fake archive '.Str::random(16));

                return Process::result();
            },
            '*offsite-copy*' => Process::result(),
        ]);
    }

    /**
     * @param  array<string, mixed>  $attributes
     */
    private function succeededBackup(array $attributes = []): SystemBackup
    {
        return SystemBackup::query()->create($attributes + [
            'started_at' => now(), 'finished_at' => now(), 'status' => 'succeeded',
            'file_name' => 'pos-x-'.Str::random(6).'.dump', 'size_bytes' => 10, 'sha256' => str_repeat('a', 64), 'triggered_by' => 'schedule',
        ]);
    }

    public function test_real_backup_of_the_test_database_and_its_restore_check(): void
    {
        $this->requirePostgresTools();

        $this->artisan('pos:backup')->assertSuccessful();

        $backup = SystemBackup::query()->sole();
        $this->assertSame('succeeded', $backup->status);
        $this->assertSame('schedule', $backup->triggered_by);
        $this->assertSame('skipped', $backup->offsite_status);
        $this->assertMatchesRegularExpression('/^pos-pos_test-\d{8}-\d{6}\.dump$/', $backup->file_name);
        $file = $this->backupDir.'/'.$backup->file_name;
        $this->assertFileExists($file);
        $this->assertSame(filesize($file), $backup->size_bytes);
        $this->assertSame('PGDMP', file_get_contents($file, length: 5), 'a custom-format archive');
        $this->assertSame(hash_file('sha256', $file), $backup->sha256);
        $this->assertSame("{$backup->sha256}  {$backup->file_name}\n", file_get_contents($file.'.sha256'));
        $this->assertSame([], glob($this->backupDir.'/*.partial'));
        $this->assertDatabaseHas('audit_logs', ['action' => 'system.backup_run', 'subject_id' => $backup->id]);

        $this->artisan('pos:backup:verify')->assertSuccessful();

        $backup->refresh();
        $this->assertSame('passed', $backup->verify_status);
        $this->assertSame('list', $backup->verify_mode);
        $this->assertNotNull($backup->verified_at);
        $this->assertNull($backup->verify_error);
    }

    public function test_the_password_reaches_pg_dump_only_through_the_environment(): void
    {
        config(['database.connections.pgsql.password' => 'Sup3r-Secret!', 'pos.backup.pg_bin' => '/opt/pg/bin']);
        $this->fakeDump();

        $this->artisan('pos:backup')->assertSuccessful();

        Process::assertRan(function (PendingProcess $process) {
            $command = implode(' ', (array) $process->command);

            return str_contains($command, '/opt/pg/bin/pg_dump')
                && str_contains($command, '--format=custom --no-owner --no-privileges')
                && ! str_contains($command, 'Sup3r-Secret!')
                && $process->environment['PGPASSWORD'] === 'Sup3r-Secret!'
                && $process->environment['PGDATABASE'] === 'pos_test'
                && isset($process->environment['PGHOST'], $process->environment['PGPORT'], $process->environment['PGUSER']);
        });
    }

    public function test_on_windows_pg_dump_gets_system_root_even_from_a_trimmed_web_environment(): void
    {
        // pg_dump 18 fails with "could not generate restrict key" without SystemRoot (found under `php artisan serve`).
        if (PHP_OS_FAMILY !== 'Windows') {
            $this->markTestSkipped('Windows only.');
        }
        $this->fakeDump();

        $this->artisan('pos:backup')->assertSuccessful();

        Process::assertRan(fn (PendingProcess $process) => str_contains(implode(' ', (array) $process->command), 'pg_dump')
            && ($process->environment['SystemRoot'] ?? '') !== '');
    }

    public function test_a_failed_backup_is_recorded_sanitised_audited_and_alerted(): void
    {
        Notification::fake();
        config(['database.connections.pgsql.password' => 'Sup3r-Secret!']);
        Process::fake(['*pg_dump*' => Process::result(
            errorOutput: 'pg_dump: error: connection to "postgresql://pos_app:Sup3r-Secret!@db/pos_test" failed: password authentication failed (password Sup3r-Secret!)',
            exitCode: 1,
        )]);

        $this->artisan('pos:backup')->assertFailed();

        $backup = SystemBackup::query()->sole();
        $this->assertSame('failed', $backup->status);
        $this->assertNotNull($backup->finished_at);
        $this->assertStringContainsString('pg_dump failed (exit code 1)', $backup->error);
        $this->assertStringContainsString('password authentication failed', $backup->error);
        $this->assertStringNotContainsString('Sup3r-Secret!', $backup->error);
        $this->assertSame([], glob($this->backupDir.'/*'));
        $this->assertDatabaseHas('audit_logs', ['action' => 'system.backup_run', 'subject_id' => $backup->id]);
        Notification::assertSentOnDemand(OpsAlertNotification::class, fn (OpsAlertNotification $n) => $n->kind === 'backup'
            && str_contains($n->subject, 'Database backup failed')
            && ! str_contains(implode(' ', $n->lines), 'Sup3r-Secret!'));
    }

    public function test_the_off_site_hook_gets_the_escaped_path_and_its_failure_is_recorded(): void
    {
        Notification::fake();
        config(['pos.backup.after_command' => 'offsite-copy {file} remote:pos']);
        Process::fake([
            '*pg_dump*' => function (PendingProcess $process) {
                file_put_contents(Str::after((string) collect($process->command)->first(fn ($a) => str_starts_with($a, '--file=')), '--file='), 'PGDMP x');

                return Process::result();
            },
            '*offsite-copy*' => Process::result(errorOutput: 'upload denied: token=abc123 for ops@example.com', exitCode: 3),
        ]);

        $this->artisan('pos:backup')->assertSuccessful();

        $backup = SystemBackup::query()->sole();
        $this->assertSame('succeeded', $backup->status);
        $this->assertSame('failed', $backup->offsite_status);
        $this->assertSame('Exit code 3: upload denied: token=[redacted] for [email]', $backup->offsite_error);
        $expected = 'offsite-copy '.escapeshellarg($this->backupDir.'/'.$backup->file_name).' remote:pos';
        Process::assertRan(fn (PendingProcess $process) => $process->command === $expected
            && $process->environment['PGPASSWORD'] === false
            && array_diff(array_keys($process->environment), ['PGPASSWORD', 'SystemRoot']) === []);
        Notification::assertSentOnDemand(OpsAlertNotification::class, fn (OpsAlertNotification $n) => str_contains($n->subject, 'Off-site copy'));

        Process::fake(['*pg_dump*' => function (PendingProcess $process) {
            file_put_contents(Str::after((string) collect($process->command)->first(fn ($a) => str_starts_with($a, '--file=')), '--file='), 'PGDMP x');

            return Process::result();
        }, '*offsite-copy*' => Process::result()]);
        $this->travel(1)->seconds();
        $this->artisan('pos:backup')->assertSuccessful();
        $this->assertSame('succeeded', SystemBackup::query()->latest('started_at')->first()->offsite_status);
    }

    public function test_retention_keeps_the_newest_backups_and_removes_old_files(): void
    {
        config(['pos.backup.keep_days' => 14, 'pos.backup.keep_min' => 3]);
        mkdir($this->backupDir, 0700, true);
        $old = [];
        foreach ([40, 30, 20, 16] as $daysAgo) {
            $backup = $this->succeededBackup(['started_at' => now()->subDays($daysAgo), 'finished_at' => now()->subDays($daysAgo)]);
            file_put_contents($this->backupDir.'/'.$backup->file_name, 'x');
            file_put_contents($this->backupDir.'/'.$backup->file_name.'.sha256', 'x');
            $old[$daysAgo] = $backup;
        }
        $recent = $this->succeededBackup(['started_at' => now()->subDays(1), 'finished_at' => now()->subDays(1)]);
        file_put_contents($this->backupDir.'/'.$recent->file_name, 'x');
        $staleLeftover = $this->backupDir.'/pos-pos_test-20260101-020000.dump.partial';
        $freshLeftover = $this->backupDir.'/pos-pos_test-20260102-020000.dump.partial';
        file_put_contents($staleLeftover, 'x');
        touch($staleLeftover, now()->subDays(2)->getTimestamp());
        file_put_contents($freshLeftover, 'x');
        $this->fakeDump();

        $this->artisan('pos:backup')->assertSuccessful();

        // Kept: the new backup, the one from yesterday and the newest old one (keep_min = 3).
        $this->assertFileExists($this->backupDir.'/'.$recent->file_name);
        $this->assertFileExists($this->backupDir.'/'.$old[16]->file_name);
        $this->assertNull($old[16]->fresh()->file_deleted_at);
        foreach ([40, 30, 20] as $daysAgo) {
            $this->assertFileDoesNotExist($this->backupDir.'/'.$old[$daysAgo]->file_name);
            $this->assertFileDoesNotExist($this->backupDir.'/'.$old[$daysAgo]->file_name.'.sha256');
            $this->assertNotNull($old[$daysAgo]->fresh()->file_deleted_at);
        }
        $this->assertFileDoesNotExist($staleLeftover);
        $this->assertFileExists($freshLeftover);
    }

    public function test_only_one_backup_runs_at_a_time(): void
    {
        $this->fakeDump();
        $lock = PerformBackup::lock();
        $this->assertTrue($lock->get());

        $this->artisan('pos:backup')->expectsOutputToContain('A backup is already running')->assertFailed();
        $this->assertSame(0, SystemBackup::query()->count());

        $this->actingAsUser(User::factory()->platformAdmin()->create());
        $this->postJson('/api/v1/platform/system/backups')->assertStatus(409)->assertJsonPath('error.code', 'BACKUP_RUNNING');

        $lock->release();
    }

    public function test_backups_need_postgres(): void
    {
        config(['database.connections.pgsql.driver' => 'mysql']);

        $this->artisan('pos:backup')->expectsOutputToContain('PostgreSQL')->assertFailed();

        $this->actingAsUser(User::factory()->platformAdmin()->create());
        $this->postJson('/api/v1/platform/system/backups')->assertUnprocessable()->assertJsonPath('error.code', 'BACKUPS_NOT_CONFIGURED');
    }

    public function test_back_up_now_queues_a_run_and_refuses_a_second_one(): void
    {
        Queue::fake();
        $admin = User::factory()->platformAdmin()->create();
        $this->actingAsUser($admin);

        $response = $this->postJson('/api/v1/platform/system/backups')
            ->assertStatus(202)
            ->assertJsonPath('data.status', 'running')
            ->assertJsonPath('data.triggered_by', 'user')
            ->assertJsonPath('data.user_id', $admin->id);
        $id = $response->json('data.id');
        Queue::assertPushed(RunBackup::class, fn (RunBackup $job) => $job->backupId === $id && $job->userId === $admin->id);
        $this->assertDatabaseHas('audit_logs', ['action' => 'system.backup_requested', 'subject_id' => $id, 'user_id' => $admin->id]);

        $this->postJson('/api/v1/platform/system/backups')->assertStatus(409)->assertJsonPath('error.code', 'BACKUP_RUNNING');
        Queue::assertPushed(RunBackup::class, 1);

        // A queued run nobody picked up for longer than a run can take no longer blocks.
        $this->travel(config('pos.backup.timeout') + 901)->seconds();
        $this->postJson('/api/v1/platform/system/backups')->assertStatus(202);
        $this->assertSame('failed', SystemBackup::query()->find($id)->status);
    }

    public function test_the_queued_run_completes_the_requested_backup(): void
    {
        $this->fakeDump();
        $admin = User::factory()->platformAdmin()->create();
        $this->actingAsUser($admin);

        // The sync queue runs the job at once.
        $id = $this->postJson('/api/v1/platform/system/backups')->assertStatus(202)->json('data.id');

        $backup = SystemBackup::query()->sole();
        $this->assertSame($id, $backup->id);
        $this->assertSame('succeeded', $backup->status);
        $this->assertSame('user', $backup->triggered_by);
        $this->assertSame($admin->id, $backup->user_id);
        $this->assertDatabaseHas('audit_logs', ['action' => 'system.backup_run', 'subject_id' => $id]);
    }

    public function test_backup_list_and_verify_endpoint(): void
    {
        Queue::fake();
        $this->actingAsUser(User::factory()->platformAdmin()->create());
        $older = $this->succeededBackup(['started_at' => now()->subDay()]);
        $newer = $this->succeededBackup();
        $failed = SystemBackup::query()->create(['started_at' => now()->subDays(2), 'status' => 'failed', 'error' => 'x', 'triggered_by' => 'schedule']);

        $this->getJson('/api/v1/platform/system/backups')
            ->assertOk()
            ->assertJsonPath('meta.pagination.total', 3)
            ->assertJsonPath('data.0.id', $newer->id)
            ->assertJsonPath('data.1.id', $older->id)
            ->assertJsonPath('data.0.file_name', $newer->file_name)
            ->assertJsonStructure(['data' => ['*' => [
                'id', 'status', 'started_at', 'finished_at', 'file_name', 'size_bytes', 'sha256', 'error', 'offsite_status', 'offsite_error',
                'verified_at', 'verify_status', 'verify_error', 'verify_mode', 'triggered_by', 'user_id', 'file_deleted_at', 'created_at',
            ]]]);

        $this->postJson("/api/v1/platform/system/backups/{$older->id}/verify")->assertStatus(202)->assertJsonPath('data.id', $older->id);
        Queue::assertPushed(VerifyBackup::class, fn (VerifyBackup $job) => $job->backupId === $older->id);

        $this->postJson("/api/v1/platform/system/backups/{$failed->id}/verify")->assertUnprocessable()->assertJsonPath('error.code', 'BACKUP_NOT_VERIFIABLE');
        $this->postJson('/api/v1/platform/system/backups/'.Str::uuid().'/verify')->assertNotFound();
        $this->postJson('/api/v1/platform/system/backups/nope/verify')->assertNotFound();
    }
}
