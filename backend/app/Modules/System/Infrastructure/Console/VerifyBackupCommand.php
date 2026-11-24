<?php

namespace App\Modules\System\Infrastructure\Console;

use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\System\Application\Actions\PerformBackupVerification;
use Illuminate\Console\Command;

/**
 * G1b: restore check of a backup (default: the newest successful one), scheduled 90 minutes
 * after the backup.
 */
class VerifyBackupCommand extends Command
{
    protected $signature = 'pos:backup:verify {--backup= : Id of the backup to check (default: the newest successful one)}';

    protected $description = 'Check that a backup can be restored (checksum, pg_restore --list, optional full restore)';

    public function handle(PerformBackupVerification $verify): int
    {
        $id = $this->option('backup');

        try {
            $backup = $verify(is_string($id) && $id !== '' ? $id : null);
        } catch (BusinessRuleViolation $e) {
            $this->error($e->getMessage());

            return self::FAILURE;
        }

        if ($backup->verify_status !== 'passed') {
            $this->error("Restore check of {$backup->file_name} failed ({$backup->verify_mode}): {$backup->verify_error}");

            return self::FAILURE;
        }

        $this->info("Restore check of {$backup->file_name} passed ({$backup->verify_mode} mode).");

        return self::SUCCESS;
    }
}
