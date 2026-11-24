<?php

namespace App\Modules\System\Infrastructure\Console;

use App\Modules\System\Application\Actions\PruneRecords;
use Illuminate\Console\Command;

/**
 * G1b: data retention (config pos.retention), scheduled daily.
 */
class PruneRecordsCommand extends Command
{
    protected $signature = 'pos:prune-records {--dry-run : Only count what would be deleted}';

    protected $description = 'Delete old login activity, read notifications, failed jobs, AI requests, closed errors, backup records (and audit logs when configured)';

    public function handle(PruneRecords $prune): int
    {
        $dryRun = (bool) $this->option('dry-run');
        $counts = $prune($dryRun);

        $this->table(['Table', $dryRun ? 'Would delete' : 'Deleted'], collect($counts)->map(fn (int $n, string $table) => [$table, $n])->values()->all());
        if ($counts === []) {
            $this->info('Every retention period is "keep forever".');
        }

        return self::SUCCESS;
    }
}
