<?php

namespace App\Modules\Imports\Tests\Concerns;

use DateTimeInterface;
use Illuminate\Http\UploadedFile;
use Illuminate\Testing\TestResponse;
use OpenSpout\Common\Entity\Cell;
use OpenSpout\Common\Entity\Row;
use OpenSpout\Writer\XLSX\Writer;

/**
 * ST1: builds import files (CSV / XLSX) and drives the import endpoints. The test queue is sync,
 * so the dry run and the run finish inside the request.
 */
trait UploadsImports
{
    /**
     * @param  list<list<string|int|float|null>>  $rows  header first
     */
    protected function csvFile(array $rows, string $delimiter = ',', bool $bom = true, string $name = 'import.csv'): UploadedFile
    {
        $handle = fopen('php://temp', 'w+b');
        foreach ($rows as $row) {
            fputcsv($handle, array_map(fn ($v) => $v === null ? '' : (string) $v, $row), $delimiter, '"', '');
        }
        rewind($handle);
        $contents = ($bom ? "\u{FEFF}" : '').stream_get_contents($handle);
        fclose($handle);

        return UploadedFile::fake()->createWithContent($name, $contents);
    }

    /**
     * Cells keep their PHP type: ints/floats become number cells, DateTimeInterface date cells.
     *
     * @param  list<list<string|int|float|DateTimeInterface|null>>  $rows  header first
     */
    protected function xlsxFile(array $rows, string $name = 'import.xlsx'): UploadedFile
    {
        $path = tempnam(sys_get_temp_dir(), 'imp').'.xlsx';
        $writer = new Writer;
        $writer->openToFile($path);
        foreach ($rows as $row) {
            $writer->addRow(new Row(array_map(fn ($v) => Cell::fromValue($v), $row)));
        }
        $writer->close();

        return new UploadedFile($path, $name, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', null, true);
    }

    /**
     * @param  array<string, mixed>  $options
     */
    protected function upload(string $type, UploadedFile $file, array $options = []): TestResponse
    {
        return $this->post('/api/v1/imports', ['type' => $type, 'file' => $file] + ($options === [] ? [] : ['options' => $options]), ['Accept' => 'application/json']);
    }

    /**
     * Uploads, checks the dry run finished and runs the import.
     *
     * @param  array<string, mixed>  $options
     * @return array<string, mixed> the finished import
     */
    protected function importNow(string $type, UploadedFile $file, array $options = []): array
    {
        $id = $this->upload($type, $file, $options)->assertCreated()->assertJsonPath('data.status', 'validated')->json('data.id');
        $this->postJson("/api/v1/imports/{$id}/run")->assertOk();

        return $this->getJson("/api/v1/imports/{$id}")->assertOk()->json('data');
    }
}
