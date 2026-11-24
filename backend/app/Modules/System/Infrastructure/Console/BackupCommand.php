<?php

namespace App\Modules\System\Infrastructure\Console;

use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\System\Application\Actions\PerformBackup;
use App\Modules\System\Infrastructure\Models\SystemBackup;
use Illuminate\Console\Command;

/**
 * G1b: database backup with pg_dump (scheduled daily at POS_BACKUP_TIME when POS_BACKUP_ENABLED).
 */
class BackupCommand extends Command
{
    protected $signature = 'pos:backup';

    protected $description = 'Back up the database (pg_dump custom format, checksum, off-site hook, retention)';

    public function handle(PerformBackup $perform): int
    {
        try {
            $backup = $perform('schedule');
        } catch (BusinessRuleViolation $e) {
            $this->error($e->getMessage());

            return self::FAILURE;
        }

        if ($backup === null || $backup->status !== SystemBackup::SUCCEEDED) {
            $this->error('Backup failed: '.($backup->error ?? 'unknown error'));

            return self::FAILURE;
        }

        $this->info("Backup written: {$backup->file_name} ({$backup->size_bytes} bytes, sha256 {$backup->sha256}).");
        if ($backup->offsite_status === 'failed') {
            $this->warn('Off-site copy failed: '.$backup->offsite_error);
        }

        return self::SUCCESS;
    }
}
