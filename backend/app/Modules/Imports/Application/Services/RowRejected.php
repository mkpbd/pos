<?php

namespace App\Modules\Imports\Application\Services;

use App\Modules\Imports\Application\Data\RowResult;
use RuntimeException;

/**
 * @internal a row the handler refused while writing it (rolls back the row's savepoint).
 */
final class RowRejected extends RuntimeException
{
    public function __construct(public readonly RowResult $result)
    {
        parent::__construct('Row rejected.');
    }
}
