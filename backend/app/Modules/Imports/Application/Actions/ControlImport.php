<?php

namespace App\Modules\Imports\Application\Actions;

use App\Modules\Imports\Domain\ImportStatus;
use App\Modules\Imports\Infrastructure\Jobs\RunImportJob;
use App\Modules\Imports\Infrastructure\Models\Import;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;

/**
 * Starting the run of a checked import, or cancelling one before it runs. Both are conditional
 * updates of the status, so a second click (or two people) cannot run an import twice.
 */
final class ControlImport
{
    public function __construct(private readonly AuditTrail $audit) {}

    /**
     * @throws BusinessRuleViolation 409 IMPORT_NOT_READY
     */
    public function run(Import $import): Import
    {
        $claimed = Import::query()->whereKey($import->id)
            ->where('status', ImportStatus::Validated->value)
            ->where('rows_valid', '>', 0)
            ->update(['status' => ImportStatus::Importing->value, 'started_at' => now(), 'updated_at' => now()]);

        if ($claimed === 0) {
            $import->refresh();
            $message = match (true) {
                $import->status === ImportStatus::Validated => 'The file has no valid rows to import. Fix the errors and upload it again.',
                $import->status === ImportStatus::Validating => 'The file is still being checked.',
                default => 'This import has already run or was cancelled.',
            };

            throw new BusinessRuleViolation('IMPORT_NOT_READY', $message, ['status' => $import->status->value], 409);
        }

        $import->refresh();
        $this->audit->record('import.started', $import, new: [
            'type' => $import->type,
            'file_name' => $import->file_name,
            'rows_valid' => $import->rows_valid,
            'to_create' => $import->to_create,
            'to_update' => $import->to_update,
        ]);

        RunImportJob::dispatch($import->id);

        return $import->refresh();
    }

    /**
     * @throws BusinessRuleViolation 409 IMPORT_NOT_CANCELLABLE
     */
    public function cancel(Import $import): Import
    {
        $cancelled = Import::query()->whereKey($import->id)
            ->whereIn('status', [ImportStatus::Validating->value, ImportStatus::Validated->value])
            ->update(['status' => ImportStatus::Cancelled->value, 'finished_at' => now(), 'updated_at' => now()]);

        if ($cancelled === 0) {
            throw new BusinessRuleViolation('IMPORT_NOT_CANCELLABLE', 'Only an import that has not started can be cancelled.', ['status' => $import->refresh()->status->value], 409);
        }

        return $import->refresh();
    }
}
