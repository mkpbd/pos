<?php

namespace App\Modules\Imports\Infrastructure\Files;

use App\Modules\Imports\Application\Contracts\ImportHandler;
use App\Modules\Imports\Application\Data\ImportColumn;
use OpenSpout\Common\Entity\Cell\StringCell;
use OpenSpout\Common\Entity\Row;
use OpenSpout\Common\Entity\Style\Style;
use OpenSpout\Writer\CSV\Writer as CsvWriter;
use OpenSpout\Writer\XLSX\Entity\SheetView;
use OpenSpout\Writer\XLSX\Writer as XlsxWriter;

/**
 * The template of an import type: the header row with the column keys and one example row;
 * the .xlsx adds a "Help" sheet explaining every column. Every cell is text, so codes such as
 * "00123" keep their leading zeros when the user types over the example.
 */
final class TemplateWriter
{
    public function write(ImportHandler $handler, string $format, string $path): void
    {
        $columns = $handler->columns();
        $header = array_map(fn (ImportColumn $c) => $c->key, $columns);
        $example = array_map(fn (ImportColumn $c) => $c->example, $columns);

        if ($format === 'csv') {
            $writer = new CsvWriter;
            $writer->openToFile($path);
            $writer->addRow(self::row($header));
            $writer->addRow(self::row($example));
            $writer->close();

            return;
        }

        $writer = new XlsxWriter;
        $writer->openToFile($path);
        try {
            $sheet = $writer->getCurrentSheet();
            $sheet->setName(mb_substr($handler->label(), 0, 31));
            $sheet->setSheetView(new SheetView(freezeRow: 2));
            foreach ($columns as $index => $column) {
                $sheet->setColumnWidth(max(12, min(40, mb_strlen($column->key) + 4, mb_strlen($column->example) + 4)), $index + 1);
            }
            $writer->addRow(self::row($header, new Style(fontBold: true, backgroundColor: 'E8EEF5')));
            $writer->addRow(self::row($example));

            $help = $writer->addNewSheetAndMakeItCurrent();
            $help->setName('Help');
            $help->setColumnWidth(24, 1);
            $help->setColumnWidth(28, 2);
            $help->setColumnWidth(10, 3);
            $help->setColumnWidth(24, 4);
            $help->setColumnWidth(90, 5);
            $writer->addRow(self::row(['Column', 'Meaning', 'Required', 'Example', 'Help'], new Style(fontBold: true, backgroundColor: 'E8EEF5')));
            foreach ($columns as $column) {
                $writer->addRow(self::row([$column->key, $column->label, $column->required ? 'yes' : 'no', $column->example, $column->help]));
            }
            $writer->addRow(self::row([]));
            $writer->addRow(self::row(['Fill in the first sheet (one row per record) and keep its header row. Column names may also be written as the meanings above; case and spaces do not matter.']));
            $writer->addRow(self::row(['Numbers: plain, e.g. 1234.50 (1,234.50 is accepted). Dates: YYYY-MM-DD or an Excel date. Yes/no columns: yes or no.']));
        } finally {
            $writer->close();
        }
    }

    /**
     * @param  list<string>  $values
     */
    private static function row(array $values, ?Style $style = null): Row
    {
        return new Row(array_map(fn (string $v) => new StringCell($v, $style), $values));
    }
}
