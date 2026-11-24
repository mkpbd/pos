<?php

namespace App\Modules\System\Application\Actions;

use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\System\Application\Services\OpsAlerts;
use App\Modules\System\Domain\ErrorLog\ErrorText;
use App\Modules\System\Domain\Exceptions\BackupRunning;
use App\Modules\System\Domain\Exceptions\BackupsNotConfigured;
use App\Modules\System\Infrastructure\Backups\PostgresTools;
use App\Modules\System\Infrastructure\Models\SystemBackup;
use Illuminate\Contracts\Cache\Lock;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use RuntimeException;
use Throwable;

/**
 * G1b: one database backup — `pg_dump --format=custom` of the default connection to
 * `{path}/pos-{database}-{Ymd-His}.dump` (written as `.partial`, renamed on success), its sha256
 * in `{file}.sha256`, the optional off-site hook, then the retention of older files.
 *
 * Only one backup runs at a time (cache lock); a failure is recorded on the row (sanitised),
 * audited and sent to the operations alert channel. Used by `pos:backup` and the RunBackup job.
 */
final class PerformBackup
{
    public const LOCK = 'system:backup:run';

    public function __construct(
        private readonly PostgresTools $tools,
        private readonly AuditTrail $audit,
        private readonly OpsAlerts $alerts,
    ) {}

    /**
     * @param  'schedule'|'user'  $triggeredBy
     * @param  string|null  $backupId  the row created when the run was queued ("Back up now")
     */
    public function __invoke(string $triggeredBy, ?string $userId = null, ?string $backupId = null): ?SystemBackup
    {
        if (! PostgresTools::isPostgres()) {
            throw new BackupsNotConfigured;
        }

        $lock = self::lock();
        if (! $lock->get()) {
            if ($backupId !== null) {
                SystemBackup::query()->whereKey($backupId)->where('status', SystemBackup::RUNNING)->update([
                    'status' => SystemBackup::FAILED, 'finished_at' => now(), 'error' => 'Another backup was running.',
                ]);
            }
            throw BackupRunning::backup();
        }

        try {
            self::failInterruptedRuns($backupId);

            if ($backupId !== null) {
                $backup = SystemBackup::query()->find($backupId);
                if ($backup === null || $backup->status !== SystemBackup::RUNNING) {
                    return $backup;
                }
                $backup->update(['started_at' => now()]);
            } else {
                $backup = SystemBackup::query()->create([
                    'started_at' => now(),
                    'status' => SystemBackup::RUNNING,
                    'triggered_by' => $triggeredBy,
                    'user_id' => $userId,
                ]);
            }

            return $this->run($backup);
        } finally {
            $lock->release();
        }
    }

    public static function lock(): Lock
    {
        return Cache::lock(self::LOCK, PostgresTools::timeout() * 2 + 600);
    }

    /**
     * Whether a backup is running or queued (a `running` row that is not stale, or the lock is held).
     */
    public static function isBusy(): bool
    {
        self::failInterruptedRuns();
        if (SystemBackup::query()->where('status', SystemBackup::RUNNING)->exists()) {
            return true;
        }

        $lock = self::lock();
        if ($lock->get()) {
            $lock->release();

            return false;
        }

        return true;
    }

    /**
     * `running` rows older than the longest possible run belong to a process that died (or a
     * queued run no worker picked up): they are marked failed so they no longer block backups.
     */
    public static function failInterruptedRuns(?string $exceptId = null): void
    {
        SystemBackup::query()
            ->where('status', SystemBackup::RUNNING)
            ->where('started_at', '<', now()->subSeconds(PostgresTools::timeout() + 900))
            ->when($exceptId !== null, fn ($q) => $q->whereKeyNot($exceptId))
            ->update([
                'status' => SystemBackup::FAILED,
                'finished_at' => now(),
                'error' => 'The backup was interrupted (the process stopped, or no queue worker picked it up).',
                'updated_at' => now(),
            ]);
    }

    /**
     * Removes the database password, connection strings and personal data from a process or
     * exception text.
     */
    public static function scrub(string $text, int $limit = 2000): string
    {
        $password = PostgresTools::password();
        if ($password !== '') {
            $text = str_replace($password, '[redacted]', $text);
        }

        return ErrorText::sanitise($text, $limit);
    }

    private function run(SystemBackup $backup): SystemBackup
    {
        $dir = rtrim(str_replace('\\', '/', (string) config('pos.backup.path')), '/');
        $database = (string) preg_replace('/[^A-Za-z0-9_\-]+/', '_', PostgresTools::liveDatabase());
        $name = 'pos-'.$database.'-'.now()->format('Ymd-His').'.dump';
        $file = $dir.'/'.$name;
        $partial = $file.'.partial';

        try {
            self::ensureDirectory($dir);

            $result = $this->tools->dump($partial);
            if ($result->failed()) {
                throw new RuntimeException('pg_dump failed (exit code '.$result->exitCode().'): '.self::excerpt($result->errorOutput() ?: $result->output()));
            }
            if (! is_file($partial) || filesize($partial) === 0) {
                throw new RuntimeException('pg_dump finished but wrote no file.');
            }
            if (! @rename($partial, $file)) {
                throw new RuntimeException('The finished dump could not be renamed to '.$name.'.');
            }
            @chmod($file, 0600);

            $hash = (string) hash_file('sha256', $file);
            if (file_put_contents($file.'.sha256', "{$hash}  {$name}\n") === false) {
                throw new RuntimeException('The checksum file could not be written.');
            }
            @chmod($file.'.sha256', 0600);

            $backup->update([
                'status' => SystemBackup::SUCCEEDED,
                'finished_at' => now(),
                'file_name' => $name,
                'size_bytes' => (int) filesize($file),
                'sha256' => $hash,
                'error' => null,
            ]);
        } catch (Throwable $e) {
            if (is_file($partial)) {
                @unlink($partial);
            }
            $backup->update(['status' => SystemBackup::FAILED, 'finished_at' => now(), 'error' => self::scrub($e->getMessage())]);
            $this->audited($backup);
            $this->alerts->send('backup', 'Database backup failed', [
                'The database backup started at '.$backup->started_at->toIso8601String().' failed.',
                'Error: '.$backup->error,
            ], OpsAlerts::adminUrl('system-status'), 'Open system status');

            return $backup;
        }

        $this->offsite($backup, $file);
        $this->audited($backup);

        try {
            $this->applyRetention($dir);
        } catch (Throwable $e) {
            Log::warning('Backup retention failed.', ['message' => self::scrub($e->getMessage(), 500)]);
        }

        return $backup;
    }

    private function offsite(SystemBackup $backup, string $file): void
    {
        $template = trim((string) config('pos.backup.after_command'));
        if ($template === '') {
            $backup->update(['offsite_status' => 'skipped']);

            return;
        }

        try {
            $result = $this->tools->afterCommand($template, $file);
            $error = $result->failed()
                ? 'Exit code '.$result->exitCode().': '.self::excerpt($result->errorOutput() ?: $result->output())
                : null;
        } catch (Throwable $e) {
            $error = $e->getMessage();
        }

        $backup->update([
            'offsite_status' => $error === null ? 'succeeded' : 'failed',
            'offsite_error' => $error === null ? null : self::scrub($error),
        ]);

        if ($error !== null) {
            $this->alerts->send('backup', 'Off-site copy of the backup failed', [
                'The backup '.$backup->file_name.' was made, but the off-site command failed.',
                'Error: '.$backup->offsite_error,
            ], OpsAlerts::adminUrl('system-status'), 'Open system status');
        }
    }

    private function audited(SystemBackup $backup): void
    {
        $this->audit->record('system.backup_run', $backup, new: [
            'triggered_by' => $backup->triggered_by,
            'file' => $backup->file_name,
            'size' => $backup->size_bytes,
            'status' => $backup->status,
            'offsite_status' => $backup->offsite_status,
        ], context: array_filter(['requested_by' => $backup->user_id]));
    }

    /**
     * Deletes backups older than keep_days (files, then the row is marked `file_deleted_at`),
     * never the newest keep_min successful ones; removes `.partial` leftovers older than a day.
     */
    private function applyRetention(string $dir): void
    {
        $keepDays = (int) config('pos.backup.keep_days');
        $keepMin = max(1, (int) config('pos.backup.keep_min'));

        if ($keepDays > 0) {
            SystemBackup::query()
                ->where('status', SystemBackup::SUCCEEDED)
                ->whereNull('file_deleted_at')
                ->orderByDesc('started_at')
                ->get()
                ->slice($keepMin)
                ->filter(fn (SystemBackup $b) => ($b->finished_at ?? $b->started_at)->lt(now()->subDays($keepDays)))
                ->each(function (SystemBackup $old) use ($dir) {
                    foreach ([$dir.'/'.$old->file_name, $dir.'/'.$old->file_name.'.sha256'] as $path) {
                        if (is_file($path)) {
                            @unlink($path);
                        }
                    }
                    $old->update(['file_deleted_at' => now()]);
                });
        }

        foreach (glob($dir.'/pos-*.dump.partial') ?: [] as $leftover) {
            if (filemtime($leftover) < now()->subDay()->getTimestamp()) {
                @unlink($leftover);
            }
        }
    }

    private static function ensureDirectory(string $dir): void
    {
        // Created private to the application's user (where the OS has such permissions); an
        // existing folder keeps the permissions the operator gave it.
        if (! is_dir($dir) && ! @mkdir($dir, 0700, true) && ! is_dir($dir)) {
            throw new RuntimeException('The backup folder could not be created (POS_BACKUP_PATH).');
        }
        if (! is_writable($dir)) {
            throw new RuntimeException('The backup folder is not writable (POS_BACKUP_PATH).');
        }
    }

    /**
     * The last lines of a process output, which name the actual error.
     */
    public static function excerpt(string $output, int $limit = 1500): string
    {
        $output = trim($output);

        return strlen($output) > $limit ? '…'.substr($output, -$limit) : $output;
    }
}
