<?php

namespace App\Modules\Shared\Tests\Concerns;

use App\Modules\Shared\Application\Export\PdfRenderer;
use App\Modules\Shared\Tests\Fakes\FakePdfRenderer;
use Illuminate\Testing\TestResponse;
use OpenSpout\Common\Entity\Cell;
use OpenSpout\Reader\XLSX\Reader;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use ZipArchive;

/**
 * Reads list exports back: .xlsx through OpenSpout's reader, PDFs through a fake renderer.
 */
trait ReadsExports
{
    /**
     * Downloads are deleted after sending; tests never send them, so tidy up here.
     */
    protected function tearDownReadsExports(): void
    {
        foreach ([...(glob(storage_path('app/private/exports/*.xlsx')) ?: []), ...(glob(storage_path('app/private/exports/*.csv')) ?: [])] as $file) {
            @unlink($file);
        }
    }

    /**
     * The raw bytes of a .csv download (BOM included).
     */
    protected function csvContent(TestResponse $response): string
    {
        $base = $response->baseResponse;
        $this->assertInstanceOf(BinaryFileResponse::class, $base, 'Expected a .csv file download.');

        return (string) file_get_contents($base->getFile()->getPathname());
    }

    /**
     * Records of a .csv download (header first), parsed as RFC 4180 without the BOM.
     *
     * @return list<list<string>>
     */
    protected function csvRows(TestResponse $response): array
    {
        $content = $this->csvContent($response);
        $this->assertStringStartsWith("\xEF\xBB\xBF", $content);
        $handle = fopen('php://memory', 'r+');
        fwrite($handle, substr($content, 3));
        rewind($handle);
        $rows = [];
        while (($row = fgetcsv($handle, escape: '')) !== false) {
            $rows[] = array_map(fn ($v) => (string) $v, $row);
        }
        fclose($handle);

        return $rows;
    }

    protected function fakePdfRenderer(): FakePdfRenderer
    {
        $fake = new FakePdfRenderer;
        $this->app->instance(PdfRenderer::class, $fake);

        return $fake;
    }

    /**
     * Cells of the first sheet (header first), as OpenSpout cell objects.
     *
     * @return list<list<Cell>>
     */
    protected function xlsxCells(TestResponse $response): array
    {
        $path = $this->xlsxPath($response);
        $reader = new Reader;
        $reader->open($path);
        $rows = [];
        try {
            foreach ($reader->getSheetIterator() as $sheet) {
                foreach ($sheet->getRowIterator() as $row) {
                    $rows[] = $row->cells;
                }
                break;
            }
        } finally {
            $reader->close();
        }

        return $rows;
    }

    /**
     * Plain values of the first sheet (header first).
     *
     * @return list<list<mixed>>
     */
    protected function xlsxRows(TestResponse $response): array
    {
        return array_map(fn (array $cells) => array_map(fn (Cell $c) => $c->getValue(), $cells), $this->xlsxCells($response));
    }

    protected function xlsxSheetXml(TestResponse $response, string $part = 'xl/worksheets/sheet1.xml'): string
    {
        $zip = new ZipArchive;
        $zip->open($this->xlsxPath($response));
        $xml = (string) $zip->getFromName($part);
        $zip->close();

        return $xml;
    }

    private function xlsxPath(TestResponse $response): string
    {
        $base = $response->baseResponse;
        $this->assertInstanceOf(BinaryFileResponse::class, $base, 'Expected an .xlsx file download.');

        return $base->getFile()->getPathname();
    }
}
