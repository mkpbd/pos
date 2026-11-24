<?php

namespace App\Modules\Imports\Application\Support;

use App\Modules\Imports\Application\Contracts\ImportHandler;
use App\Modules\Imports\Application\Data\ImportContext;
use App\Modules\Imports\Domain\CellValue;

/**
 * Defaults for handlers: no bulk preparation.
 */
abstract class BaseImportHandler implements ImportHandler
{
    public function prepare(array $rows, ImportContext $context): void {}

    /**
     * A decimal cell with more decimals than the field keeps (null: blank, fine).
     */
    protected static function tooPrecise(mixed $value, int $scale): bool
    {
        // Trailing zeros do not count: "12.500" fits 2 decimals.
        return is_string($value) && str_contains($value, '.') && CellValue::scaleOf(rtrim($value, '0')) > $scale;
    }

    /**
     * Lower-cased, trimmed text for keys and lookups (null for blanks).
     */
    protected static function fold(mixed $value): ?string
    {
        if (! is_string($value)) {
            return null;
        }
        $value = mb_strtolower(trim($value));

        return $value === '' ? null : $value;
    }
}
