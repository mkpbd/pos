<?php

namespace App\Modules\System\Application\Actions;

use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\System\Domain\Exceptions\BackupRunning;
use App\Modules\System\Infrastructure\Jobs\VerifyBackup;
use App\Modules\System\Infrastructure\Models\SystemBackup;

/**
 * G1b: "Verify" — queues the restore check of one successful backup.
 */
final class QueueBackupVerification
{
    public function __construct(private readonly AuditTrail $audit) {}

    public function __invoke(SystemBackup $backup): SystemBackup
    {
        PerformBackupVerification::target($backup->id);

        $lock = PerformBackupVerification::lock();
        if (! $lock->get()) {
            throw BackupRunning::verification();
        }
        $lock->release();

        $this->audit->record('system.backup_verify_requested', $backup);
        VerifyBackup::dispatch($backup->id);

        return $backup->refresh();
    }
}
