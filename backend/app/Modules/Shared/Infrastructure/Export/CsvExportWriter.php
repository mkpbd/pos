<?php

namespace App\Modules\Shared\Infrastructure\Export;

use App\Modules\Shared\Application\Export\ColumnType;
use App\Modules\Shared\Application\Export\ExportColumn;
use App\Modules\Shared\Application\Export\ExportDocument;
use RuntimeException;

/**
 * Streams an export into a .csv file (Phase 7): UTF-8 with a byte-order mark (so Excel opens
 * Bangla text correctly), RFC 4180 — comma separated, CRLF line ends, a field quoted when it
 * holds a comma, a quote or a line break, quotes doubled — one header row of column labels,
 * then the rows. Numbers, money and quantities are plain decimal strings ("1234.50", never
 * grouped or floats), dates "Y-m-d" and date-times "Y-m-d H:i" in the organization's timezone,
 * statuses readable labels.
 *
 * Formula-injection guard (like the xlsx writer, which never writes formulas): a text cell
 * starting with `=`, `+`, `-`, `@`, a tab or a carriage return is prefixed with `'`, so a
 * spreadsheet shows it as text instead of evaluating it. Numeric cells are written only when
 * they are exact decimals, so "-12.50" stays a number.
 */
final class CsvExportWriter
{
    public const BOM = "\xEF\xBB\xBF";

    private const FORMULA_PREFIXES = ['=', '+', '-', '@', "\t", "\r"];

    /**
     * @return int the number of data rows written
     */
    public function write(ExportDocument $document, string $path): int
    {
        $handle = fopen($path, 'wb');
        if ($handle === false) {
            throw new RuntimeException('Cannot open the export file for writing.');
        }

        try {
            fwrite($handle, self::BOM);
            fwrite($handle, self::line(array_map(fn (ExportColumn $c) => self::guard($c->label), $document->columns)));

            $count = 0;
            foreach ($document->rows() as $row) {
                $cells = [];
                foreach ($document->columns as $column) {
                    $cells[] = $this->cell($column, $column->valueOf($row), $document->timezone);
                }
                fwrite($handle, self::line($cells));
                $count++;
            }

            return $count;
        } finally {
            fclose($handle);
        }
    }

    private function cell(ExportColumn $column, mixed $value, string $timezone): string
    {
        switch ($column->type) {
            case ColumnType::Number:
            case ColumnType::Money:
            case ColumnType::Quantity:
                $decimal = ExportValues::decimal($value);

                return $decimal ?? self::guard((string) ExportValues::text($value));
            case ColumnType::Date:
            case ColumnType::DateTime:
                $instant = ExportValues::instant($value, $timezone);
                if ($instant === null) {
                    return self::guard((string) ExportValues::text($value));
                }

                return $instant->format($column->type === ColumnType::Date ? 'Y-m-d' : 'Y-m-d H:i');
            case ColumnType::Status:
                return self::guard((string) ExportValues::status($value));
            default:
                return self::guard((string) ExportValues::text($value));
        }
    }

    /**
     * A text cell a spreadsheet could read as a formula gets a leading apostrophe.
     */
    public static function guard(string $text): string
    {
        if ($text !== '' && in_array($text[0], self::FORMULA_PREFIXES, true)) {
            return "'".$text;
        }

        return $text;
    }

    /**
     * One RFC 4180 record, CRLF-terminated.
     *
     * @param  list<string>  $fields
     */
    public static function line(array $fields): string
    {
        return implode(',', array_map(self::field(...), $fields))."\r\n";
    }

    private static function field(string $value): string
    {
        if (strpbrk($value, ",\"\r\n") === false) {
            return $value;
        }

        return '"'.str_replace('"', '""', $value).'"';
    }
}
