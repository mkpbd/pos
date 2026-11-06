<?php

namespace App\Modules\Reports\Domain;

/**
 * How a report column is formatted: money (2-decimal string), quantity (3-decimal string),
 * number (integer or decimal string), percent (2-decimal string, "12.50" = 12.5 %),
 * date (Y-m-d in the organization's timezone), datetime (ISO 8601 instant), text.
 */
enum ColumnType: string
{
    case Money = 'money';
    case Quantity = 'quantity';
    case Number = 'number';
    case Percent = 'percent';
    case Date = 'date';
    case DateTime = 'datetime';
    case Text = 'text';

    public function isNumeric(): bool
    {
        return in_array($this, [self::Money, self::Quantity, self::Number, self::Percent], true);
    }
}
