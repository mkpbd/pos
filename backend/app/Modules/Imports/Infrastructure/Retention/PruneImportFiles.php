<?php

namespace App\Modules\Imports\Infrastructure\Retention;

use App\Modules\Imports\Infrastructure\Models\Import;
use App\Modules\Shared\Application\Contracts\RetentionTask;
use Illuminate\Support\Facades\Storage;

/**
 * ST1: deletes the uploaded file of imports that finished (completed, failed or cancelled) more
 * than `pos.retention.import_files` days ago (POS_RETAIN_IMPORT_FILES_DAYS, default 30); the
 * import's history row and its stored errors stay. Runs inside `pos:prune-records`.
 */
final class PruneImportFiles implements RetentionTask
{
    public function name(): string
    {
        return 'import_files';
    }

    public function prune(bool $dryRun): ?int
    {
        $days = config('pos.retention.import_files');
        if ($days === null || $days === '' || ! is_numeric($days) || (int) $days <= 0) {
            return null;
        }

        $query = Import::query()->withoutGlobalScopes()
            ->whereNotNull('finished_at')
            ->where('finished_at', '<', now()->subDays((int) $days))
            ->whereNull('file_deleted_at');

        if ($dryRun) {
            return $query->count();
        }

        $disk = Storage::disk(config('pos.imports.disk', 'local'));
        $deleted = 0;
        $query->orderBy('id')->chunkById(500, function ($imports) use ($disk, &$deleted) {
            foreach ($imports as $import) {
                /** @var Import $import */
                $disk->delete($import->filePath());
                Import::query()->withoutGlobalScopes()->whereKey($import->id)->update(['file_deleted_at' => now()]);
                $deleted++;
            }
        });

        return $deleted;
    }
}
