<?php

namespace App\Modules\Imports\Application\Contracts;

use App\Modules\Imports\Application\Data\ImportContext;
use App\Modules\Imports\Application\Data\RowResult;

/**
 * A type whose rows are written together: all rows with the same groupOf() form one unit —
 * the variants of one product (`parent_sku`), the opening stock of one store (one stock
 * adjustment). A group is never split across chunks and is written in one savepoint; importRow()
 * is not used for grouped types.
 */
interface GroupedImportHandler extends ImportHandler
{
    /**
     * @param  array<string, mixed>  $row
     */
    public function groupOf(array $row): string;

    /**
     * Checks that need the whole group (after every row passed validateRow()). Returns results
     * only for rows that change — errors, or a different action (e.g. a new variant of an
     * existing product is an update of that product).
     *
     * @param  array<int, array<string, mixed>>  $rows  row number => row
     * @return array<int, RowResult>
     */
    public function validateGroup(array $rows, ImportContext $context): array;

    /**
     * Writes the group. Returns one result per row number; rows reported as errors are counted
     * as failed (a handler may write the rest of the group and refuse only some rows).
     *
     * @param  array<int, array<string, mixed>>  $rows  row number => row
     * @return array<int, RowResult>
     */
    public function importGroup(array $rows, ImportContext $context): array;
}
