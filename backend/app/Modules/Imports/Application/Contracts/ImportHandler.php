<?php

namespace App\Modules\Imports\Application\Contracts;

use App\Modules\Imports\Application\Data\ImportColumn;
use App\Modules\Imports\Application\Data\ImportContext;
use App\Modules\Imports\Application\Data\RowResult;

/**
 * ST1: one importable type, implemented by the module that owns the records (Products,
 * Inventory, Customers, Suppliers) and tagged with ImportHandler::TAG in that module's service
 * provider. The Imports module reads the file, maps the header, reads the cells by column type,
 * finds duplicate keys inside the file and stores the results; the handler checks a row against
 * its module's rules (validateRow) and writes it through its module's own actions (importRow),
 * so every rule, audit entry and event applies as if the row had been typed in.
 *
 * A row is `array<string, string|bool|null>`: every column key of columns(), null when blank or
 * not in the file, plus `_row` (int): the row's number in the file. Decimal / integer / date
 * columns arrive as plain strings ("1234.50", "2026-01-31"), boolean columns as bool.
 *
 * importRow() runs inside a transaction (savepoint) per row: throwing rolls back only that row,
 * which is then recorded as failed with the exception's message (ValidationException,
 * BusinessRuleViolation) — the rest of the chunk continues.
 */
interface ImportHandler
{
    public const TAG = 'imports.handlers';

    /** e.g. "products" (the API `type`). */
    public function type(): string;

    /** e.g. "Products". */
    public function label(): string;

    /** Permission needed to run (and see) imports of this type. */
    public function permission(): string;

    /**
     * @return list<ImportColumn>
     */
    public function columns(): array;

    /**
     * Called once per pass (dry run, run) with every row that passed the cell checks, before
     * any validateRow(), for bulk lookups (e.g. all SKUs of the file in one query).
     *
     * @param  array<int, array<string, mixed>>  $rows  row number => row
     */
    public function prepare(array $rows, ImportContext $context): void;

    /**
     * The row's identity for duplicate detection inside the file (null: never a duplicate).
     *
     * @param  array<string, mixed>  $row
     */
    public function keyOf(array $row): ?string;

    /**
     * create / update / skip, or the row's errors. Must not write anything.
     *
     * @param  array<string, mixed>  $row
     */
    public function validateRow(array $row, ImportContext $context): RowResult;

    /**
     * Writes the row (only rows validateRow() accepted in this pass reach it).
     *
     * @param  array<string, mixed>  $row
     */
    public function importRow(array $row, ImportContext $context): RowResult;
}
