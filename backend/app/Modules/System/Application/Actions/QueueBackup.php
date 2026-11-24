<?php

namespace App\Modules\System\Application\Actions;

use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\System\Domain\Exceptions\BackupRunning;
use App\Modules\System\Domain\Exceptions\BackupsNotConfigured;
use App\Modules\System\Infrastructure\Backups\PostgresTools;
use App\Modules\System\Infrastructure\Jobs\RunBackup;
use App\Modules\System\Infrastructure\Models\SystemBackup;
use Illuminate\Support\Facades\Cache;

/**
 * G1b: "Back up now" — records a `running` backup at once (so the list shows it while the queue
 * worker picks it up) and queues RunBackup. Refused while another backup runs or is queued.
 */
final class QueueBackup
{
    public function __construct(private readonly AuditTrail $audit) {}

    public function __invoke(string $userId): SystemBackup
    {
        if (! PostgresTools::isPostgres()) {
            throw new BackupsNotConfigured;
        }

        $backup = Cache::lock('system:backup:queue', 10)->get(function () use ($userId) {
            if (PerformBackup::isBusy()) {
                throw BackupRunning::backup();
            }

            return SystemBackup::query()->create([
                'started_at' => now(),
                'status' => SystemBackup::RUNNING,
                'triggered_by' => 'user',
                'user_id' => $userId,
            ]);
        });

        if (! $backup instanceof SystemBackup) {
            throw BackupRunning::backup();
        }

        $this->audit->record('system.backup_requested', $backup);
        RunBackup::dispatch($backup->id, $userId);

        return $backup->refresh();
    }
}
