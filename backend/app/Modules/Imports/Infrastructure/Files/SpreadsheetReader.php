<?php

namespace App\Modules\Imports\Infrastructure\Files;

use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use Generator;
use OpenSpout\Reader\CSV\Options as CsvOptions;
use OpenSpout\Reader\CSV\Reader as CsvReader;
use OpenSpout\Reader\ReaderInterface;
use OpenSpout\Reader\XLSX\Options as XlsxOptions;
use OpenSpout\Reader\XLSX\Reader as XlsxReader;
use Throwable;

/**
 * Streams the rows of an uploaded file with OpenSpout: the first sheet of an .xlsx, or a UTF-8
 * .csv (with or without BOM) separated by commas, semicolons or tabs (sniffed from the header
 * line). Row numbers are the file's own (the header is row 1), empty rows included in the count.
 */
final class SpreadsheetReader
{
    /**
     * @return Generator<int, list<mixed>> row number => cell values
     *
     * @throws BusinessRuleViolation IMPORT_BAD_FILE
     */
    public function rows(string $path, string $format): Generator
    {
        $reader = $this->open($path, $format);

        try {
            foreach ($reader->getSheetIterator() as $sheet) {
                $number = 0;
                foreach ($sheet->getRowIterator() as $row) {
                    $number++;
                    yield $number => $row === null ? [] : array_values($row->toArray());
                }
                break; // first sheet only
            }
        } catch (BusinessRuleViolation $e) {
            throw $e;
        } catch (Throwable $e) {
            throw self::badFile($format, $e);
        } finally {
            $reader->close();
        }
    }

    private function open(string $path, string $format): ReaderInterface
    {
        try {
            if ($format === 'csv') {
                $this->assertUtf8($path);
                $reader = new CsvReader(new CsvOptions(SHOULD_PRESERVE_EMPTY_ROWS: true, FIELD_DELIMITER: $this->sniffDelimiter($path)));
            } else {
                $reader = new XlsxReader(new XlsxOptions(SHOULD_FORMAT_DATES: false, SHOULD_PRESERVE_EMPTY_ROWS: true));
            }
            $reader->open($path);

            return $reader;
        } catch (BusinessRuleViolation $e) {
            throw $e;
        } catch (Throwable $e) {
            throw self::badFile($format, $e);
        }
    }

    /**
     * The separator used most in the first line (outside quotes): comma, semicolon or tab.
     */
    private function sniffDelimiter(string $path): string
    {
        $handle = fopen($path, 'rb');
        $line = $handle === false ? '' : (string) fgets($handle, 65536);
        if ($handle !== false) {
            fclose($handle);
        }
        $unquoted = (string) preg_replace('/"[^"]*"/', '', $line);
        $counts = [',' => substr_count($unquoted, ','), ';' => substr_count($unquoted, ';'), "\t" => substr_count($unquoted, "\t")];
        arsort($counts);

        return reset($counts) > 0 ? (string) array_key_first($counts) : ',';
    }

    private function assertUtf8(string $path): void
    {
        $contents = (string) file_get_contents($path);
        if (! mb_check_encoding($contents, 'UTF-8')) {
            throw new BusinessRuleViolation('IMPORT_BAD_FILE', 'The CSV file is not UTF-8. In Excel choose "Save as → CSV UTF-8 (Comma delimited)", or upload the .xlsx file.');
        }
    }

    private static function badFile(string $format, Throwable $e): BusinessRuleViolation
    {
        unset($e); // a user file, not an application error: not reported

        return new BusinessRuleViolation('IMPORT_BAD_FILE', $format === 'csv'
            ? 'The file could not be read as CSV.'
            : 'The file could not be read as an Excel workbook (.xlsx). Save it again in Excel, or upload a CSV file.');
    }
}
