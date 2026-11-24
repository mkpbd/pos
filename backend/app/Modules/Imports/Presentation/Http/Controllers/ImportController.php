<?php

namespace App\Modules\Imports\Presentation\Http\Controllers;

use App\Modules\Imports\Application\Actions\ControlImport;
use App\Modules\Imports\Application\Actions\StartImport;
use App\Modules\Imports\Application\Contracts\ImportHandler;
use App\Modules\Imports\Application\Data\ImportColumn;
use App\Modules\Imports\Application\Services\ImportFileInspector;
use App\Modules\Imports\Application\Support\ImportHandlerRegistry;
use App\Modules\Imports\Domain\ImportStatus;
use App\Modules\Imports\Infrastructure\Files\TemplateWriter;
use App\Modules\Imports\Infrastructure\Models\Import;
use App\Modules\Imports\Infrastructure\Models\ImportError;
use App\Modules\Imports\Presentation\Http\Requests\StartImportRequest;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Infrastructure\Export\CsvExportWriter;
use App\Modules\Shared\Infrastructure\Http\Queries\ListQuery;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Users\Application\Contracts\UserDirectory;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * ST1: bulk import — types and templates, upload (queues the dry run), status with the first
 * errors, the errors file, run and cancel. Every import is visible to users who may run its type.
 */
class ImportController
{
    private const SHOWN_ERRORS = 200;

    public function __construct(
        private readonly ImportHandlerRegistry $handlers,
        private readonly TenantContext $tenant,
        private readonly UserDirectory $users,
    ) {}

    /**
     * Import types the user may run
     */
    public function types(Request $request): JsonResponse
    {
        $allowed = $this->handlers->typesAllowedFor($request->user());

        return ApiResponse::success(array_values(array_map(fn (ImportHandler $h) => [
            'type' => $h->type(),
            'label' => $h->label(),
            'permission' => $h->permission(),
            'columns' => array_map(fn (ImportColumn $c) => $c->toArray(), $h->columns()),
            'max_rows' => ImportFileInspector::maxRows(),
        ], array_filter($this->handlers->all(), fn (ImportHandler $h) => in_array($h->type(), $allowed, true)))));
    }

    /**
     * Download a template
     *
     * `format=xlsx` (default; with a "Help" sheet) or `csv`.
     */
    public function template(Request $request, string $type, TemplateWriter $writer, StartImport $start): BinaryFileResponse
    {
        $data = $request->validate(['format' => ['sometimes', Rule::in(['xlsx', 'csv'])]]);
        $handler = $start->requireHandler($this->user($request), $type);
        $format = $data['format'] ?? 'xlsx';

        $directory = storage_path('app/private/exports');
        if (! is_dir($directory)) {
            mkdir($directory, 0775, true);
        }
        $path = $directory.'/template-'.Str::uuid().'.'.$format;
        $writer->write($handler, $format, $path);

        return response()->download($path, "{$handler->type()}-import-template.{$format}", [
            'Content-Type' => $format === 'csv' ? 'text/csv; charset=UTF-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Cache-Control' => 'no-store, private',
        ])->deleteFileAfterSend();
    }

    /**
     * Import history
     *
     * Filters: `type`, `status`. Only imports of types the user may run.
     */
    public function index(Request $request): JsonResponse
    {
        $request->validate([
            'type' => ['sometimes', 'string', 'max:40'],
            'status' => ['sometimes', Rule::enum(ImportStatus::class)],
        ]);
        $allowed = $this->handlers->typesAllowedFor($request->user());

        $query = Import::query()
            ->whereIn('type', $allowed)
            ->when($request->query('type'), fn ($q, string $type) => $q->where('type', $type))
            ->when($request->query('status'), fn ($q, string $status) => $q->where('status', $status))
            ->orderByDesc('created_at')->orderByDesc('id');
        $page = $query->paginate(ListQuery::perPage($request));
        $names = $this->names(collect($page->items())->pluck('created_by')->filter()->all());

        return ApiResponse::paginated($page, fn (Import $import) => new JsonResource($this->present($import, $names)));
    }

    /**
     * Upload a file
     *
     * Multipart `type`, `file` (.xlsx or .csv UTF-8, ≤ 10 MB, ≤ 20 000 rows), `options[update_existing]`
     * (default true). The header is checked now (422 `IMPORT_BAD_HEADERS` with `details.missing`
     * and `details.unknown`; `IMPORT_TOO_MANY_ROWS`; `IMPORT_EMPTY`; `IMPORT_BAD_FILE`); the rows
     * are checked by a queued dry run (status `validating` → `validated`).
     */
    public function store(StartImportRequest $request, StartImport $start): JsonResponse
    {
        $data = $request->validated();
        $import = $start($this->user($request), $data['type'], $request->file('file'), $data['options'] ?? []);

        return ApiResponse::created($this->present($import, $this->names([$import->created_by]), withErrors: true));
    }

    public function show(Request $request, Import $import): JsonResponse
    {
        $this->authorizeType($request, $import);

        return ApiResponse::success($this->present($import, $this->names([$import->created_by]), withErrors: true));
    }

    /**
     * Download all errors (CSV)
     *
     * Every stored error with the row's original values, ready to fix and upload again.
     */
    public function errors(Request $request, Import $import): StreamedResponse
    {
        $handler = $this->authorizeType($request, $import);
        $keys = array_map(fn (ImportColumn $c) => $c->key, $handler->columns());

        return response()->streamDownload(function () use ($import, $keys) {
            echo "\u{FEFF}";
            echo CsvExportWriter::line(['row', 'column', 'error', ...$keys]);
            ImportError::query()->where('import_id', $import->id)->orderBy('id')
                ->chunkById(500, function ($errors) use ($keys) {
                    foreach ($errors as $error) {
                        /** @var ImportError $error */
                        $values = array_map(fn (string $key) => self::guard((string) ($error->values[$key] ?? '')), $keys);
                        echo CsvExportWriter::line([(string) $error->row, (string) $error->column, self::guard($error->message), ...$values]);
                    }
                });
        }, "{$import->type}-import-errors-".substr($import->id, 0, 8).'.csv', [
            'Content-Type' => 'text/csv; charset=UTF-8',
            'Cache-Control' => 'no-store, private',
        ]);
    }

    /**
     * Run the import
     *
     * Only from `validated` with at least one valid row; 409 `IMPORT_NOT_READY` otherwise
     * (also when it already ran: running twice is refused).
     */
    public function run(Request $request, Import $import, ControlImport $control): JsonResponse
    {
        $this->authorizeType($request, $import);
        $import = $control->run($import);

        return ApiResponse::success($this->present($import, $this->names([$import->created_by]), withErrors: true));
    }

    /**
     * Cancel before the run
     *
     * 409 `IMPORT_NOT_CANCELLABLE` once it has started or finished.
     */
    public function cancel(Request $request, Import $import, ControlImport $control): JsonResponse
    {
        $this->authorizeType($request, $import);
        $import = $control->cancel($import);

        return ApiResponse::success($this->present($import, $this->names([$import->created_by]), withErrors: true));
    }

    private function authorizeType(Request $request, Import $import): ImportHandler
    {
        $handler = $this->handlers->find($import->type);
        if ($handler === null || ! Gate::forUser($request->user())->allows($handler->permission())) {
            throw new AuthorizationException('You may not see imports of this type.');
        }

        return $handler;
    }

    /**
     * @param  array<string, string>  $names
     * @return array<string, mixed>
     */
    private function present(Import $import, array $names, bool $withErrors = false): array
    {
        $data = [
            'id' => $import->id,
            'type' => $import->type,
            'label' => $this->handlers->find($import->type)?->label() ?? $import->type,
            'status' => $import->status->value,
            'file_name' => $import->file_name,
            'file_size' => $import->file_size,
            'rows_total' => $import->rows_total,
            'rows_valid' => $import->rows_valid,
            'rows_error' => $import->rows_error,
            'to_create' => $import->to_create,
            'to_update' => $import->to_update,
            'to_skip' => $import->to_skip,
            'created' => $import->created,
            'updated' => $import->updated,
            'skipped' => $import->skipped,
            'failed_rows' => $import->failed_rows,
            'error_count' => $import->error_count,
            'options' => $import->options,
            'created_by' => $import->created_by === null ? null : ['id' => $import->created_by, 'name' => $names[$import->created_by] ?? null],
            'created_at' => $import->created_at?->toIso8601String(),
            'validated_at' => $import->validated_at?->toIso8601String(),
            'started_at' => $import->started_at?->toIso8601String(),
            'finished_at' => $import->finished_at?->toIso8601String(),
            'message' => $import->message,
        ];

        if ($withErrors) {
            $errors = ImportError::query()->where('import_id', $import->id)->orderBy('id')->limit(self::SHOWN_ERRORS)
                ->get(['row', 'column', 'message'])
                ->map(fn (ImportError $e) => ['row' => $e->row, 'column' => $e->column, 'message' => $e->message])->all();
            $data['errors'] = $errors;
            $data['errors_truncated'] = $import->error_count > count($errors);
        }

        return $data;
    }

    /**
     * @param  list<?string>  $ids
     * @return array<string, string>
     */
    private function names(array $ids): array
    {
        $ids = array_values(array_unique(array_filter($ids)));

        return $ids === [] ? [] : $this->users->names($this->tenant->requireOrganization(), $ids);
    }

    private function user(Request $request): TenantUser&Authenticatable
    {
        /** @var TenantUser&Authenticatable $user */
        $user = $request->user();

        return $user;
    }

    /**
     * Formula-injection guard that leaves numbers alone ("-5" and "+8801…" stay re-importable).
     */
    private static function guard(string $text): string
    {
        if ($text === '' || preg_match('/^[+-]?[\d.,\s]+$/', $text) === 1) {
            return $text;
        }

        return CsvExportWriter::guard($text);
    }
}
