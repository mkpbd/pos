<?php

namespace App\Modules\Shared\Application\Export;

/**
 * How an exported column is written: numbers, money and quantities become numeric cells,
 * dates and date-times date cells in the organization's timezone, statuses readable labels.
 */
enum ColumnType: string
{
    case Text = 'text';
    case Number = 'number';
    case Money = 'money';
    case Quantity = 'quantity';
    case Date = 'date';
    case DateTime = 'datetime';
    case Status = 'status';

    public function isNumeric(): bool
    {
        return in_array($this, [self::Number, self::Money, self::Quantity], true);
    }
}
