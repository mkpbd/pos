<?php

namespace App\Modules\Imports\Domain;

/**
 * How a cell is read before the handler sees it (CellValue): text is trimmed, numbers become
 * plain decimal strings, dates `YYYY-MM-DD`, booleans true/false.
 */
enum ColumnType: string
{
    case Text = 'text';
    case Decimal = 'decimal';
    case Integer = 'integer';
    case Date = 'date';
    case Boolean = 'boolean';
}
