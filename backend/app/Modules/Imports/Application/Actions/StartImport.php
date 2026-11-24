<?php

namespace App\Modules\Imports\Application\Actions;

use App\Modules\Imports\Application\Contracts\ImportHandler;
use App\Modules\Imports\Application\Services\ImportFileInspector;
use App\Modules\Imports\Application\Support\ImportHandlerRegistry;
use App\Modules\Imports\Domain\ImportStatus;
use App\Modules\Imports\Infrastructure\Jobs\ValidateImportJob;
use App\Modules\Imports\Infrastructure\Models\Import;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;
use Throwable;

/**
 * Upload: checks the header and the row count straight away (422 IMPORT_BAD_HEADERS,
 * IMPORT_TOO_MANY_ROWS, IMPORT_EMPTY, IMPORT_BAD_FILE), stores the file on the private disk as
 * imports/{organization}/{import}.{ext} and queues the dry run.
 */
final class StartImport
{
    public function __construct(
        private readonly ImportHandlerRegistry $handlers,
        private readonly ImportFileInspector $inspector,
        private readonly TenantContext $tenant,
    ) {}

    /**
     * @param  array{update_existing?: bool}  $options
     */
    public function __invoke(TenantUser&Authenticatable $user, string $type, UploadedFile $file, array $options): Import
    {
        $handler = $this->requireHandler($user, $type);
        $format = mb_strtolower($file->getClientOriginalExtension()) === 'csv' ? 'csv' : 'xlsx';

        $this->inspector->count($handler, (string) $file->getRealPath(), $format);

        $import = Import::query()->create([
            'organization_id' => $this->tenant->requireOrganization(),
            'branch_id' => $this->tenant->branchId(),
            'type' => $handler->type(),
            'status' => ImportStatus::Validating,
            'file_name' => mb_substr($file->getClientOriginalName(), 0, 255),
            'file_format' => $format,
            'file_size' => (int) $file->getSize(),
            'options' => ['update_existing' => (bool) ($options['update_existing'] ?? true)],
            'created_by' => $user->getAuthIdentifier(),
        ]);

        try {
            $path = $import->filePath();
            Storage::disk(config('pos.imports.disk', 'local'))->putFileAs(dirname($path), $file, basename($path));
        } catch (Throwable $e) {
            $import->delete();

            throw $e;
        }

        ValidateImportJob::dispatch($import->id);

        return $import->refresh();
    }

    /**
     * @throws ValidationException|AuthorizationException
     */
    public function requireHandler(TenantUser&Authenticatable $user, string $type): ImportHandler
    {
        $handler = $this->handlers->find($type)
            ?? throw ValidationException::withMessages(['type' => ['Unknown import type.']]);
        if (! Gate::forUser($user)->allows($handler->permission())) {
            throw new AuthorizationException('You may not import '.mb_strtolower($handler->label()).'.');
        }

        return $handler;
    }
}
