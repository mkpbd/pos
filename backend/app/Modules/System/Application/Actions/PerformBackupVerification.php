<?php

namespace App\Modules\System\Application\Actions;

use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\System\Application\Services\OpsAlerts;
use App\Modules\System\Domain\Exceptions\BackupRunning;
use App\Modules\System\Infrastructure\Backups\PostgresTools;
use App\Modules\System\Infrastructure\Backups\RestoredDatabaseInspector;
use App\Modules\System\Infrastructure\Models\SystemBackup;
use Illuminate\Contracts\Cache\Lock;
use Illuminate\Support\Facades\Cache;
use Throwable;

/**
 * G1b: restore check of a backup. Always: the file's sha256 matches its `.sha256` file (and the
 * recorded one) and `pg_restore --list` reads the archive (`list` mode). When
 * POS_BACKUP_VERIFY_DATABASE names a scratch database (never the live one), the backup is
 * restored into it and its core tables are inspected (`restore` mode).
 */
final class PerformBackupVerification
{
    public const LOCK = 'system:backup:verify';

    public function __construct(
        private readonly PostgresTools $tools,
        private readonly RestoredDatabaseInspector $inspector,
        private readonly AuditTrail $audit,
        private readonly OpsAlerts $alerts,
    ) {}

    /**
     * @param  string|null  $backupId  default: the newest successful backup whose file is kept
     */
    public function __invoke(?string $backupId = null): SystemBackup
    {
        $backup = self::target($backupId);

        $lock = self::lock();
        if (! $lock->get()) {
            throw BackupRunning::verification();
        }

        try {
            try {
                [$mode, $error] = $this->check($backup);
            } catch (Throwable $e) {
                [$mode, $error] = ['list', $e->getMessage()];
            }

            $backup->update([
                'verified_at' => now(),
                'verify_status' => $error === null ? 'passed' : 'failed',
                'verify_error' => $error === null ? null : PerformBackup::scrub($error),
                'verify_mode' => $mode,
            ]);
        } finally {
            $lock->release();
        }

        $this->audit->record('system.backup_verified', $backup, new: [
            'file' => $backup->file_name,
            'verify_status' => $backup->verify_status,
            'verify_mode' => $backup->verify_mode,
        ]);

        if ($backup->verify_status === 'failed') {
            $this->alerts->send('backup_verify', 'Backup restore check failed', [
                'The restore check of '.$backup->file_name.' failed ('.$backup->verify_mode.' mode).',
                'Error: '.$backup->verify_error,
            ], OpsAlerts::adminUrl('system-status'), 'Open system status');
        }

        return $backup;
    }

    public static function lock(): Lock
    {
        return Cache::lock(self::LOCK, PostgresTools::timeout() * 2 + 600);
    }

    /**
     * The backup to check; refuses one that failed, is still running or whose file is deleted.
     */
    public static function target(?string $backupId): SystemBackup
    {
        $backup = $backupId !== null
            ? SystemBackup::query()->find($backupId)
            : SystemBackup::query()->where('status', SystemBackup::SUCCEEDED)->whereNull('file_deleted_at')->orderByDesc('started_at')->first();

        if ($backup === null) {
            throw new BusinessRuleViolation('NO_BACKUP_TO_VERIFY', 'There is no successful backup to check.');
        }
        if ($backup->status !== SystemBackup::SUCCEEDED || $backup->file_deleted_at !== null) {
            throw new BusinessRuleViolation('BACKUP_NOT_VERIFIABLE', 'Only a successful backup whose file is still kept can be checked.');
        }

        return $backup;
    }

    /**
     * @return array{0: 'list'|'restore', 1: ?string} the mode and the problem found (null = passed)
     */
    private function check(SystemBackup $backup): array
    {
        $file = rtrim(str_replace('\\', '/', (string) config('pos.backup.path')), '/').'/'.$backup->file_name;
        if (! is_file($file)) {
            return ['list', 'The backup file is missing from the backup folder.'];
        }
        if (! is_file($file.'.sha256')) {
            return ['list', 'The checksum file (.sha256) is missing.'];
        }

        $expected = strtolower((string) strtok(trim((string) file_get_contents($file.'.sha256')), " \t"));
        $actual = (string) hash_file('sha256', $file);
        if (! hash_equals($expected, $actual) || ($backup->sha256 !== null && ! hash_equals($backup->sha256, $actual))) {
            return ['list', 'The checksum does not match: the file was changed or is damaged.'];
        }

        $list = $this->tools->listArchive($file);
        if ($list->failed()) {
            return ['list', 'pg_restore could not read the archive: '.PerformBackup::excerpt($list->errorOutput() ?: $list->output())];
        }

        $scratch = trim((string) config('pos.backup.verify_database'));
        if ($scratch === '') {
            return ['list', null];
        }
        if (strcasecmp($scratch, PostgresTools::liveDatabase()) === 0) {
            return ['restore', 'POS_BACKUP_VERIFY_DATABASE names the live database; the restore check was refused.'];
        }

        try {
            $restore = $this->tools->restoreInto($scratch, $file);
            if ($restore->failed()) {
                return ['restore', 'pg_restore into the check database failed: '.PerformBackup::excerpt($restore->errorOutput() ?: $restore->output())];
            }

            return ['restore', $this->inspector->problem($scratch)];
        } catch (Throwable $e) {
            return ['restore', $e->getMessage()];
        }
    }
}
