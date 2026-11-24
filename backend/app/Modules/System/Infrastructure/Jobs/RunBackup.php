<?php

namespace App\Modules\System\Infrastructure\Jobs;

use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\System\Application\Actions\PerformBackup;
use App\Modules\System\Infrastructure\Backups\PostgresTools;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;

/**
 * G1b: "Back up now" from the operations page. The outcome is recorded on the backup row; the
 * job itself never retries (a second dump would be a new backup).
 */
class RunBackup implements ShouldQueue
{
    use Queueable;

    public int $tries = 1;

    public int $timeout;

    public function __construct(public readonly string $backupId, public readonly ?string $userId = null)
    {
        $this->timeout = PostgresTools::timeout() + 300;
    }

    public function handle(PerformBackup $backup): void
    {
        try {
            $backup('user', $this->userId, $this->backupId);
        } catch (BusinessRuleViolation) {
            // Another backup was running: PerformBackup marked this one failed.
        }
    }
}
