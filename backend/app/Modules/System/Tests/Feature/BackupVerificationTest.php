<?php

namespace App\Modules\System\Tests\Feature;

use App\Modules\System\Application\Actions\PerformBackupVerification;
use App\Modules\System\Infrastructure\Backups\RestoredDatabaseInspector;
use App\Modules\System\Infrastructure\Models\SystemBackup;
use App\Modules\System\Infrastructure\Notifications\OpsAlertNotification;
use App\Modules\System\Tests\Concerns\UsesBackupFolder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Process\PendingProcess;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Process;
use Illuminate\Support\Str;
use Tests\TestCase;
use Throwable;

/**
 * G1b: restore checks. The full restore mode cannot run for real here (the test role may not
 * create databases), so pg_restore is faked and the inspector is checked separately against
 * the test database.
 */
class BackupVerificationTest extends TestCase
{
    use RefreshDatabase, UsesBackupFolder;

    private SystemBackup $backup;

    protected function setUp(): void
    {
        parent::setUp();

        $this->setUpBackupFolder();
        mkdir($this->backupDir, 0700, true);
        $name = 'pos-pos_test-20261124-020000.dump';
        file_put_contents($this->backupDir.'/'.$name, 'PGDMP archive bytes');
        $hash = hash_file('sha256', $this->backupDir.'/'.$name);
        file_put_contents($this->backupDir.'/'.$name.'.sha256', "{$hash}  {$name}\n");
        $this->backup = SystemBackup::query()->create([
            'started_at' => now(), 'finished_at' => now(), 'status' => 'succeeded', 'file_name' => $name,
            'size_bytes' => 19, 'sha256' => $hash, 'triggered_by' => 'schedule',
        ]);
        config(['pos.ops_alert_emails' => ['ops@example.com']]);
    }

    private function inspectorFinds(?string $problem): void
    {
        $this->app->instance(RestoredDatabaseInspector::class, new class($problem) extends RestoredDatabaseInspector
        {
            /** @var list<string> */
            public array $inspected = [];

            public function __construct(private readonly ?string $problem) {}

            public function problem(string $database): ?string
            {
                $this->inspected[] = $database;

                return $this->problem;
            }
        });
    }

    public function test_list_mode_passes_when_checksum_and_archive_are_good(): void
    {
        Process::fake(['*pg_restore*' => Process::result(output: ';  Archive created at …')]);

        $this->artisan('pos:backup:verify', ['--backup' => $this->backup->id])->assertSuccessful();

        $this->backup->refresh();
        $this->assertSame('passed', $this->backup->verify_status);
        $this->assertSame('list', $this->backup->verify_mode);
        Process::assertRan(fn (PendingProcess $p) => in_array('--list', (array) $p->command, true));
        Process::assertRanTimes(fn (PendingProcess $p) => str_contains(implode(' ', (array) $p->command), 'pg_restore'), 1);
        $this->assertDatabaseHas('audit_logs', ['action' => 'system.backup_verified', 'subject_id' => $this->backup->id]);
    }

    public function test_a_changed_file_fails_the_checksum_and_alerts(): void
    {
        Notification::fake();
        Process::fake();
        file_put_contents($this->backupDir.'/'.$this->backup->file_name, 'tampered');

        $this->artisan('pos:backup:verify')->assertFailed();

        $this->backup->refresh();
        $this->assertSame('failed', $this->backup->verify_status);
        $this->assertStringContainsString('checksum does not match', $this->backup->verify_error);
        Process::assertNothingRan();
        Notification::assertSentOnDemand(OpsAlertNotification::class, fn (OpsAlertNotification $n) => $n->kind === 'backup_verify');
    }

    public function test_an_unreadable_archive_fails(): void
    {
        Process::fake(['*pg_restore*' => Process::result(errorOutput: 'pg_restore: error: input file does not appear to be a valid archive', exitCode: 1)]);

        $this->artisan('pos:backup:verify')->assertFailed();

        $this->assertSame('pg_restore could not read the archive: pg_restore: error: input file does not appear to be a valid archive', $this->backup->fresh()->verify_error);
    }

    public function test_restore_mode_restores_into_the_scratch_database_and_inspects_it(): void
    {
        config(['pos.backup.verify_database' => 'pos_restore_check', 'database.connections.pgsql.password' => 'Sup3r-Secret!']);
        Process::fake(['*pg_restore*' => Process::result()]);
        $this->inspectorFinds(null);

        $this->artisan('pos:backup:verify')->assertSuccessful();

        $this->backup->refresh();
        $this->assertSame('passed', $this->backup->verify_status);
        $this->assertSame('restore', $this->backup->verify_mode);
        Process::assertRan(function (PendingProcess $process) {
            $command = implode(' ', (array) $process->command);

            return str_contains($command, '--clean --if-exists --no-owner --no-privileges --dbname=pos_restore_check')
                && ! str_contains($command, 'Sup3r-Secret!')
                && $process->environment['PGPASSWORD'] === 'Sup3r-Secret!'
                && $process->environment['PGDATABASE'] === 'pos_restore_check';
        });
        $this->assertSame(['pos_restore_check'], app(RestoredDatabaseInspector::class)->inspected);
    }

    public function test_restore_mode_fails_when_the_restored_database_is_incomplete(): void
    {
        Notification::fake();
        config(['pos.backup.verify_database' => 'pos_restore_check']);
        Process::fake(['*pg_restore*' => Process::result()]);
        $this->inspectorFinds('The restored database has no organizations.');

        $this->artisan('pos:backup:verify')->assertFailed();

        $this->assertSame('The restored database has no organizations.', $this->backup->fresh()->verify_error);
        $this->assertSame('restore', $this->backup->fresh()->verify_mode);
        Notification::assertSentOnDemandTimes(OpsAlertNotification::class, 1);
    }

    public function test_restore_mode_refuses_the_live_database(): void
    {
        config(['pos.backup.verify_database' => 'POS_TEST']);
        Process::fake(['*pg_restore*' => Process::result()]);
        $this->inspectorFinds(null);

        $this->artisan('pos:backup:verify')->assertFailed();

        $this->backup->refresh();
        $this->assertSame('failed', $this->backup->verify_status);
        $this->assertStringContainsString('names the live database', $this->backup->verify_error);
        Process::assertNotRan(fn (PendingProcess $p) => str_contains(implode(' ', (array) $p->command), '--dbname'));
        $this->assertSame([], app(RestoredDatabaseInspector::class)->inspected);
    }

    public function test_a_deleted_or_failed_backup_cannot_be_checked(): void
    {
        $this->backup->update(['file_deleted_at' => now()]);
        $this->artisan('pos:backup:verify')->expectsOutputToContain('no successful backup')->assertFailed();
        $this->artisan('pos:backup:verify', ['--backup' => $this->backup->id])->expectsOutputToContain('whose file is still kept')->assertFailed();
    }

    public function test_only_one_restore_check_runs_at_a_time(): void
    {
        $lock = PerformBackupVerification::lock();
        $this->assertTrue($lock->get());

        $this->artisan('pos:backup:verify')->expectsOutputToContain('already running')->assertFailed();
        $this->assertNull($this->backup->fresh()->verify_status);

        $lock->release();
    }

    public function test_the_inspector_checks_core_tables_and_organizations(): void
    {
        // The (migrated) test database has every core table; its committed organizations table is
        // normally empty — rows of this test live in an uncommitted transaction.
        $problem = (new RestoredDatabaseInspector)->problem('pos_test');
        $this->assertContains($problem, [null, 'The restored database has no organizations.']);

        try {
            (new RestoredDatabaseInspector)->problem('pos_g1b_database_that_does_not_exist_'.Str::lower(Str::random(4)));
            $this->fail('A missing database must fail the check.');
        } catch (Throwable $e) {
            $this->assertStringContainsString('does not exist', $e->getMessage());
        }
    }
}
