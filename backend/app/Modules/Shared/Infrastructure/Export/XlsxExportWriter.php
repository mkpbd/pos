<?php

namespace App\Modules\Shared\Infrastructure\Export;

use App\Modules\Shared\Application\Export\ColumnType;
use App\Modules\Shared\Application\Export\ExportColumn;
use App\Modules\Shared\Application\Export\ExportDocument;
use OpenSpout\Common\Entity\Cell;
use OpenSpout\Common\Entity\Cell\DateTimeCell;
use OpenSpout\Common\Entity\Cell\EmptyCell;
use OpenSpout\Common\Entity\Cell\NumericCell;
use OpenSpout\Common\Entity\Cell\StringCell;
use OpenSpout\Common\Entity\Row;
use OpenSpout\Common\Entity\Style\CellAlignment;
use OpenSpout\Common\Entity\Style\Style;
use OpenSpout\Writer\XLSX\Entity\SheetView;
use OpenSpout\Writer\XLSX\Options;
use OpenSpout\Writer\XLSX\Properties;
use OpenSpout\Writer\XLSX\Writer;

/**
 * Streams an export into an .xlsx file with OpenSpout: a bold, frozen header row, numbers
 * and money as numeric cells (2-decimal format for money), dates as date cells in the
 * organization's timezone, sized columns. Text is always written as text (never a formula).
 */
final class XlsxExportWriter
{
    private const FORMATS = [
        'money' => '#,##0.00',
        // Integers and decimals both read naturally (a fixed "#,##0.###" prints "5." for 5).
        'number' => 'General',
        'quantity' => 'General',
        'date' => 'dd mmm yyyy',
        'datetime' => 'dd mmm yyyy hh:mm',
    ];

    /**
     * @return int the number of data rows written
     */
    public function write(ExportDocument $document, string $path): int
    {
        // One font for the whole sheet (OpenSpout's fallback would differ from styled cells).
        $writer = new Writer(new Options(FALLBACK_STYLE: new Style, properties: new Properties(
            title: $document->title,
            subject: $document->filterSummary(),
            application: 'Enterprise POS',
            creator: $document->generatedBy ?? 'Enterprise POS',
            lastModifiedBy: $document->generatedBy ?? 'Enterprise POS',
            description: $document->letterhead['name'],
        )));
        $writer->openToFile($path);

        try {
            $sheet = $writer->getCurrentSheet();
            $sheet->setName(self::sheetName($document->title));
            $sheet->setSheetView(new SheetView(freezeRow: 2));
            foreach ($document->columns as $index => $column) {
                $sheet->setColumnWidth(self::width($column), $index + 1);
            }

            $header = new Style(fontBold: true, backgroundColor: 'E8EEF5');
            $writer->addRow(new Row(array_map(
                fn (ExportColumn $c) => new StringCell($c->label, $c->type->isNumeric() ? $header->withCellAlignment(CellAlignment::RIGHT) : $header),
                $document->columns,
            )));

            $styles = array_map(fn (ExportColumn $c) => self::style($c), $document->columns);
            $count = 0;
            foreach ($document->rows() as $row) {
                $cells = [];
                foreach ($document->columns as $index => $column) {
                    $cells[] = $this->cell($column, $column->valueOf($row), $styles[$index], $document->timezone);
                }
                $writer->addRow(new Row($cells));
                $count++;
            }

            return $count;
        } finally {
            $writer->close();
        }
    }

    private function cell(ExportColumn $column, mixed $value, ?Style $style, string $timezone): Cell
    {
        switch ($column->type) {
            case ColumnType::Number:
            case ColumnType::Money:
            case ColumnType::Quantity:
                $decimal = ExportValues::decimal($value);
                if ($decimal === null) {
                    return self::textCell($value, $style);
                }

                // The spreadsheet cell is the only place a decimal string becomes a binary number.
                return new NumericCell(preg_match('/^-?\d+$/', $decimal) === 1 ? (int) $decimal : (float) $decimal, $style);
            case ColumnType::Date:
            case ColumnType::DateTime:
                $instant = ExportValues::instant($value, $timezone);
                if ($instant === null) {
                    return self::textCell($value, null);
                }

                return new DateTimeCell($column->type === ColumnType::Date ? $instant->startOfDay() : $instant, $style);
            case ColumnType::Status:
                return self::textCell(ExportValues::status($value), $style);
            default:
                return self::textCell($value, $style);
        }
    }

    private static function textCell(mixed $value, ?Style $style): Cell
    {
        $text = ExportValues::text($value);

        // StringCell, not Cell::fromValue(): a value starting with "=" stays text, never a formula.
        return $text === null || $text === '' ? new EmptyCell(null) : new StringCell($text, $style);
    }

    private static function style(ExportColumn $column): ?Style
    {
        $format = self::FORMATS[$column->type->value] ?? null;
        $alignment = match ($column->alignment()) {
            'right' => CellAlignment::RIGHT,
            'center' => CellAlignment::CENTER,
            default => null,
        };
        if ($format === null && $alignment === null) {
            return null;
        }

        return new Style(cellAlignment: $alignment, format: $format);
    }

    private static function width(ExportColumn $column): float
    {
        $base = match ($column->type) {
            ColumnType::Money, ColumnType::Number, ColumnType::Quantity => 14,
            ColumnType::Date => 13,
            ColumnType::DateTime => 18,
            ColumnType::Status => 16,
            ColumnType::Text => 26,
        };

        return (float) max($base, min(50, mb_strlen($column->label) + 4));
    }

    /**
     * Excel sheet names: at most 31 characters, none of : \ / ? * [ ].
     */
    public static function sheetName(string $title): string
    {
        $name = trim((string) preg_replace('/\s+/', ' ', (string) preg_replace('/[:\\\\\/?*\[\]]+/', ' ', $title)));

        return mb_substr($name === '' ? 'Export' : $name, 0, 31);
    }
}
