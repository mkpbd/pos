<?php

namespace App\Modules\Imports\Application\Services;

use App\Modules\Imports\Application\Contracts\GroupedImportHandler;
use App\Modules\Imports\Application\Contracts\ImportHandler;
use App\Modules\Imports\Application\Data\ImportColumn;
use App\Modules\Imports\Application\Data\ImportContext;
use App\Modules\Imports\Application\Data\RowResult;
use App\Modules\Imports\Domain\CellValue;
use App\Modules\Imports\Domain\ImportStatus;
use App\Modules\Imports\Domain\RowAction;
use App\Modules\Imports\Infrastructure\Models\Import;
use App\Modules\Imports\Infrastructure\Models\ImportError;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Validation\ValidationException;
use RuntimeException;
use Throwable;

/**
 * The two passes over an import file.
 *
 * Dry run (validate): every row is read by column type, checked by the handler (validateRow, then
 * validateGroup for grouped types) and for duplicate keys inside the file, and classified
 * create / update / skip / error. Counts and the first `pos.imports.stored_errors` errors are kept.
 *
 * Run: the same checks again (the data may have changed since the dry run — rows that now fail
 * are recorded as run errors), then the valid rows are written in chunks of
 * `pos.imports.chunk_size` rows, each chunk in one transaction and each row (or group) in its own
 * savepoint, so a row that fails at run time is recorded and skipped while the rest continue.
 * Counters are saved after every chunk (progress for the polling page).
 */
final class ImportProcessor
{
    public function __construct(
        private readonly ImportFileInspector $inspector,
        private readonly AuditTrail $audit,
    ) {}

    public function validate(Import $import, ImportHandler $handler, ImportContext $context): void
    {
        $pass = $this->check($import, $handler, $context);

        $counts = ['create' => 0, 'update' => 0, 'skip' => 0, 'error' => 0];
        $errors = [];
        foreach ($pass['results'] as $number => $result) {
            $counts[$result->action->value]++;
            if ($result->isError()) {
                foreach ($result->errors as $error) {
                    $errors[] = [$number, $error];
                }
            }
        }

        $this->storeErrors($import, 'validate', $errors, $pass['raw']);
        $total = count($pass['results']);

        Import::query()->withoutGlobalScopes()->whereKey($import->id)->where('status', ImportStatus::Validating->value)->update([
            'status' => ImportStatus::Validated->value,
            'rows_total' => $total,
            'rows_valid' => $total - $counts['error'],
            'rows_error' => $counts['error'],
            'to_create' => $counts['create'],
            'to_update' => $counts['update'],
            'to_skip' => $counts['skip'],
            'error_count' => count($errors),
            'validated_at' => now(),
            'updated_at' => now(),
            'error_rows' => json_encode(array_keys(array_filter($pass['results'], fn (RowResult $r) => $r->isError()))),
        ]);
    }

    public function run(Import $import, ImportHandler $handler, ImportContext $context): void
    {
        $pass = $this->check($import, $handler, $context);
        $knownErrors = array_flip($import->error_rows ?? []);

        $counters = ['created' => 0, 'updated' => 0, 'skipped' => 0, 'failed_rows' => 0, 'error_count' => $import->error_count];
        $storedRunErrors = 0;

        // Rows that pass no longer: run errors (unless they already failed the dry run).
        $newErrors = [];
        foreach ($pass['results'] as $number => $result) {
            if ($result->isError() && ! isset($knownErrors[$number])) {
                $counters['failed_rows']++;
                foreach ($result->errors as $error) {
                    $newErrors[] = [$number, $error];
                }
            }
        }
        $counters['error_count'] += count($newErrors);
        $storedRunErrors += $this->storeErrors($import, 'run', $newErrors, $pass['raw']);

        $valid = array_filter($pass['results'], fn (RowResult $r) => ! $r->isError());
        foreach ($this->chunks($handler, $pass['rows'], array_keys($valid)) as $chunk) {
            $outcomes = $this->importChunk($handler, $context, $chunk, $pass['rows']);

            $chunkErrors = [];
            foreach ($outcomes as $number => $result) {
                match ($result->action) {
                    RowAction::Create => $counters['created']++,
                    RowAction::Update => $counters['updated']++,
                    RowAction::Skip => $counters['skipped']++,
                    RowAction::Error => $counters['failed_rows']++,
                };
                foreach ($result->isError() ? $result->errors : [] as $error) {
                    $chunkErrors[] = [$number, $error];
                }
            }
            $counters['error_count'] += count($chunkErrors);
            $storedRunErrors += $this->storeErrors($import, 'run', $chunkErrors, $pass['raw'], $storedRunErrors);

            Import::query()->withoutGlobalScopes()->whereKey($import->id)->update($counters + ['updated_at' => now()]);
        }

        Import::query()->withoutGlobalScopes()->whereKey($import->id)->update($counters + [
            'status' => ImportStatus::Completed->value,
            'finished_at' => now(),
            'updated_at' => now(),
        ]);

        $import->refresh();
        $this->audit->record('import.completed', $import, new: [
            'type' => $import->type,
            'file_name' => $import->file_name,
            'created' => $import->created,
            'updated' => $import->updated,
            'skipped' => $import->skipped,
            'failed_rows' => $import->failed_rows,
        ]);
    }

    /**
     * Reads and checks every row.
     *
     * @return array{rows: array<int, array<string, mixed>>, raw: array<int, array<string, ?string>>, results: array<int, RowResult>}
     */
    private function check(Import $import, ImportHandler $handler, ImportContext $context): array
    {
        $path = $this->localPath($import);
        $columns = [];
        foreach ($handler->columns() as $column) {
            $columns[$column->key] = $column;
        }

        $rows = [];
        $raw = [];
        $results = [];
        foreach ($this->inspector->rows($handler, $path, $import->file_format) as $number => $row) {
            $raw[$number] = $row['raw'];
            [$values, $errors] = $this->readCells($columns, $row['cells']);
            if ($errors !== []) {
                $results[$number] = RowResult::errors($errors);
            } else {
                $rows[$number] = $values + ['_row' => $number];
            }
            if (count($raw) > ImportFileInspector::maxRows()) {
                throw new BusinessRuleViolation('IMPORT_TOO_MANY_ROWS', 'The file has more than '.ImportFileInspector::maxRows().' rows.');
            }
        }

        $handler->prepare($rows, $context);

        $seen = [];
        foreach ($rows as $number => $values) {
            $results[$number] = $handler->validateRow($values, $context);
        }
        // Duplicates inside the file: the first row with a key wins, later ones are errors.
        foreach ($raw as $number => $_) {
            if (! isset($rows[$number])) {
                continue;
            }
            $key = $handler->keyOf($rows[$number]);
            if ($key === null) {
                continue;
            }
            if (isset($seen[$key])) {
                $previous = $results[$number]->isError() ? $results[$number]->errors : [];
                $results[$number] = RowResult::errors([...$previous, ['column' => null, 'message' => "Duplicate row: the same record is already on row {$seen[$key]}."]]);
            } else {
                $seen[$key] = $number;
            }
        }

        if ($handler instanceof GroupedImportHandler) {
            $groups = [];
            foreach ($rows as $number => $values) {
                if (! $results[$number]->isError()) {
                    $groups[$handler->groupOf($values)][$number] = $values;
                }
            }
            foreach ($groups as $groupRows) {
                foreach ($handler->validateGroup($groupRows, $context) as $number => $result) {
                    $results[$number] = $result;
                }
            }
        }

        ksort($results);

        return ['rows' => $rows, 'raw' => $raw, 'results' => $results];
    }

    /**
     * @param  array<string, ImportColumn>  $columns
     * @param  array<string, mixed>  $cells
     * @return array{0: array<string, mixed>, 1: list<array{column: ?string, message: string}>}
     */
    private function readCells(array $columns, array $cells): array
    {
        $values = [];
        $errors = [];
        foreach ($columns as $key => $column) {
            [$value, $error] = CellValue::read($column->type, $cells[$key] ?? null);
            if ($error !== null) {
                $errors[] = ['column' => $key, 'message' => $error];
            } elseif ($value === null && $column->required) {
                $errors[] = ['column' => $key, 'message' => "{$column->label} is required."];
            } elseif (is_string($value) && $column->maxLength !== null && mb_strlen($value) > $column->maxLength) {
                $errors[] = ['column' => $key, 'message' => "{$column->label} may have at most {$column->maxLength} characters."];
            }
            $values[$key] = $error === null ? $value : null;
        }

        return [$values, $errors];
    }

    /**
     * Valid rows in chunks of about chunk_size rows; a group is never split.
     *
     * @param  array<int, array<string, mixed>>  $rows
     * @param  list<int>  $valid  row numbers
     * @return list<list<list<int>>> chunks of units (row numbers written together)
     */
    private function chunks(ImportHandler $handler, array $rows, array $valid): array
    {
        $units = [];
        if ($handler instanceof GroupedImportHandler) {
            foreach ($valid as $number) {
                $units[$handler->groupOf($rows[$number])][] = $number;
            }
            $units = array_values($units);
        } else {
            $units = array_map(fn (int $n) => [$n], $valid);
        }

        $size = max(1, (int) config('pos.imports.chunk_size', 200));
        $chunks = [];
        $current = [];
        $count = 0;
        foreach ($units as $unit) {
            if ($current !== [] && $count + count($unit) > $size) {
                $chunks[] = $current;
                [$current, $count] = [[], 0];
            }
            $current[] = $unit;
            $count += count($unit);
        }
        if ($current !== []) {
            $chunks[] = $current;
        }

        return $chunks;
    }

    /**
     * One transaction for the chunk, one savepoint per unit.
     *
     * @param  list<list<int>>  $chunk
     * @param  array<int, array<string, mixed>>  $rows
     * @return array<int, RowResult>
     */
    private function importChunk(ImportHandler $handler, ImportContext $context, array $chunk, array $rows): array
    {
        $outcomes = [];

        try {
            DB::transaction(function () use ($handler, $context, $chunk, $rows, &$outcomes) {
                $outcomes = [];
                foreach ($chunk as $unit) {
                    $unitRows = array_intersect_key($rows, array_flip($unit));
                    try {
                        $results = DB::transaction(function () use ($handler, $context, $unitRows) {
                            if ($handler instanceof GroupedImportHandler) {
                                return $handler->importGroup($unitRows, $context);
                            }
                            $number = array_key_first($unitRows);
                            $result = $handler->importRow($unitRows[$number], $context);
                            if ($result->isError()) {
                                throw new RowRejected($result);
                            }

                            return [$number => $result];
                        });
                        foreach ($unit as $number) {
                            $outcomes[$number] = $results[$number] ?? RowResult::error(null, 'This row was not imported.');
                        }
                    } catch (Throwable $e) {
                        $failure = $this->failure($e);
                        foreach ($unit as $number) {
                            $outcomes[$number] = $failure;
                        }
                    }
                }
            });
        } catch (Throwable $e) {
            // The chunk's own commit failed: nothing of it was written.
            report($e);
            $outcomes = [];
            foreach ($chunk as $unit) {
                foreach ($unit as $number) {
                    $outcomes[$number] = RowResult::error(null, 'This row could not be saved (the database refused the batch). Run the import again for the rows left.');
                }
            }
        }

        return $outcomes;
    }

    private function failure(Throwable $e): RowResult
    {
        return match (true) {
            $e instanceof RowRejected => $e->result,
            $e instanceof ValidationException => RowResult::errors(collect($e->errors())
                ->flatMap(fn (array $messages, string $field) => array_map(fn (string $m) => ['column' => self::columnOf($field), 'message' => $m], $messages))
                ->values()->all()),
            $e instanceof BusinessRuleViolation => RowResult::error(null, $e->getMessage()),
            $e instanceof UniqueConstraintViolationException => RowResult::error(null, 'This record was created by someone else while the import ran.'),
            default => (function () use ($e) {
                report($e);

                return RowResult::error(null, 'This row could not be imported (unexpected error).');
            })(),
        };
    }

    /**
     * An action's validation field as an import column when it is one ("phone"), else null.
     */
    private static function columnOf(string $field): ?string
    {
        return preg_match('/^[a-z_]+$/', $field) === 1 ? $field : null;
    }

    /**
     * @param  list<array{0: int, 1: array{column: ?string, message: string}}>  $errors
     * @param  array<int, array<string, ?string>>  $raw
     * @return int errors stored
     */
    private function storeErrors(Import $import, string $phase, array $errors, array $raw, int $alreadyStored = 0): int
    {
        $room = max(0, (int) config('pos.imports.stored_errors', 1000) - $alreadyStored);
        $errors = array_slice($errors, 0, $room);
        if ($errors === []) {
            return 0;
        }

        $now = now();
        foreach (array_chunk($errors, 500) as $chunk) {
            ImportError::query()->withoutGlobalScopes()->insert(array_map(fn (array $e) => [
                'import_id' => $import->id,
                'organization_id' => $import->organization_id,
                'phase' => $phase,
                'row' => $e[0],
                'column' => $e[1]['column'] === null ? null : mb_substr($e[1]['column'], 0, 64),
                'message' => mb_substr($e[1]['message'], 0, 1000),
                'values' => json_encode($raw[$e[0]] ?? null),
                'created_at' => $now,
            ], $chunk));
        }

        return count($errors);
    }

    private function localPath(Import $import): string
    {
        $disk = Storage::disk(config('pos.imports.disk', 'local'));
        if (! $disk->exists($import->filePath())) {
            throw new RuntimeException('The uploaded file is no longer available.');
        }

        return $disk->path($import->filePath());
    }
}
