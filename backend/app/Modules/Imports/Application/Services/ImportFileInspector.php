<?php

namespace App\Modules\Imports\Application\Services;

use App\Modules\Imports\Application\Contracts\ImportHandler;
use App\Modules\Imports\Application\Data\ImportColumn;
use App\Modules\Imports\Domain\CellValue;
use App\Modules\Imports\Domain\HeaderMatcher;
use App\Modules\Imports\Infrastructure\Files\SpreadsheetReader;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use Generator;

/**
 * Reads an import file row by row: checks the header against the type's columns, skips empty
 * rows and gives each data row as raw text (for the errors file) and as cells keyed by column.
 */
final class ImportFileInspector
{
    public function __construct(private readonly SpreadsheetReader $reader) {}

    public static function maxRows(): int
    {
        return (int) config('pos.imports.max_rows', 20000);
    }

    /**
     * Upload check, before anything is stored: the header and the number of data rows.
     *
     * @return int data rows
     *
     * @throws BusinessRuleViolation IMPORT_BAD_HEADERS, IMPORT_TOO_MANY_ROWS, IMPORT_EMPTY, IMPORT_BAD_FILE
     */
    public function count(ImportHandler $handler, string $path, string $format): int
    {
        $count = 0;
        foreach ($this->rows($handler, $path, $format) as $_) {
            if (++$count > self::maxRows()) {
                throw new BusinessRuleViolation('IMPORT_TOO_MANY_ROWS', 'A file can have at most '.number_format(self::maxRows()).' rows. Split it into smaller files.', ['max_rows' => self::maxRows()]);
            }
        }
        if ($count === 0) {
            throw new BusinessRuleViolation('IMPORT_EMPTY', 'The file has a header row but no data rows.');
        }

        return $count;
    }

    /**
     * @return Generator<int, array{raw: array<string, ?string>, cells: array<string, mixed>}> row number => row
     *
     * @throws BusinessRuleViolation IMPORT_BAD_HEADERS, IMPORT_BAD_FILE
     */
    public function rows(ImportHandler $handler, string $path, string $format): Generator
    {
        $columns = $handler->columns();
        $map = null;

        foreach ($this->reader->rows($path, $format) as $number => $cells) {
            if ($map === null) {
                $map = $this->headerMap($columns, $cells);

                continue;
            }

            $raw = [];
            $values = [];
            foreach ($map as $index => $key) {
                $values[$key] = $cells[$index] ?? null;
                $raw[$key] = CellValue::text($values[$key]);
            }
            if (array_filter($raw, fn (?string $v) => $v !== null) === []) {
                continue; // an empty row (also rows with only unmapped cells)
            }

            yield $number => ['raw' => $raw, 'cells' => $values];
        }

        if ($map === null) {
            throw self::badHeaders(array_map(fn (ImportColumn $c) => $c->key, array_filter($columns, fn (ImportColumn $c) => $c->required)), []);
        }
    }

    /**
     * @param  list<ImportColumn>  $columns
     * @param  list<mixed>  $header
     * @return array<int, string>
     */
    private function headerMap(array $columns, array $header): array
    {
        $match = HeaderMatcher::match(
            array_map(fn (ImportColumn $c) => ['key' => $c->key, 'label' => $c->label, 'required' => $c->required], $columns),
            array_map(fn ($cell) => CellValue::text($cell), $header),
        );
        $unknown = [...$match['unknown'], ...$match['duplicate']];
        if ($match['missing'] !== [] || $unknown !== [] || $match['map'] === []) {
            throw self::badHeaders($match['missing'], $unknown, $match['duplicate']);
        }

        return $match['map'];
    }

    /**
     * @param  list<string>  $missing
     * @param  list<string>  $unknown
     * @param  list<string>  $duplicate
     */
    private static function badHeaders(array $missing, array $unknown, array $duplicate = []): BusinessRuleViolation
    {
        $parts = [];
        if ($missing !== []) {
            $parts[] = 'missing column(s): '.implode(', ', $missing);
        }
        if ($unknown !== []) {
            $parts[] = 'unknown column(s): '.implode(', ', $unknown);
        }

        return new BusinessRuleViolation(
            'IMPORT_BAD_HEADERS',
            'The header row does not match the template'.($parts === [] ? '.' : ' — '.implode('; ', $parts).'.').' Download the template and keep its first row.',
            ['missing' => array_values($missing), 'unknown' => array_values($unknown), 'duplicate' => array_values($duplicate)],
        );
    }
}
