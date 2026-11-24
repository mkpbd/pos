<?php

namespace App\Modules\System\Infrastructure\Jobs;

use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\System\Application\Actions\PerformBackupVerification;
use App\Modules\System\Infrastructure\Backups\PostgresTools;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;

/**
 * G1b: restore check of one backup, queued from the operations page; the result is recorded on
 * the backup row.
 */
class VerifyBackup implements ShouldQueue
{
    use Queueable;

    public int $tries = 1;

    public int $timeout;

    public function __construct(public readonly string $backupId)
    {
        $this->timeout = PostgresTools::timeout() * 2 + 300;
    }

    public function handle(PerformBackupVerification $verify): void
    {
        try {
            $verify($this->backupId);
        } catch (BusinessRuleViolation $e) {
            Log::info('Backup restore check skipped.', ['backup_id' => $this->backupId, 'reason' => $e->errorCode]);
        }
    }
}
