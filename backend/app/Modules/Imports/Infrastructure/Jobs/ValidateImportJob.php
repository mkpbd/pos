<?php

namespace App\Modules\Imports\Infrastructure\Jobs;

use App\Modules\Imports\Application\Actions\ProcessImport;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Throwable;

/**
 * ST1: the queued dry run of an import (works with the sync, database and redis queues).
 * Not retried: when it dies the import is marked failed and the file can be uploaded again.
 */
class ValidateImportJob implements ShouldQueue
{
    use Queueable;

    public int $tries = 1;

    /** 20 000 rows through the module actions. */
    public int $timeout = 3600;

    public function __construct(public readonly string $importId) {}

    public function handle(ProcessImport $process): void
    {
        $process->validate($this->importId);
    }

    public function failed(?Throwable $exception): void
    {
        ProcessImport::markFailed($this->importId, 'The import was interrupted. Upload the file again.');
    }
}
