<?php

namespace App\Modules\Shared\Tests\Unit;

use App\Modules\Shared\Application\Export\ExportColumn;
use App\Modules\Shared\Application\Export\ExportDocument;
use App\Modules\Shared\Infrastructure\Export\CsvExportWriter;
use Carbon\CarbonImmutable;
use PHPUnit\Framework\TestCase;

/**
 * Phase 7: the CSV writer — BOM, RFC 4180 quoting and CRLF, exact decimals, dates in the
 * organization's timezone, formula-injection guard on text (never on numbers).
 */
class CsvExportWriterTest extends TestCase
{
    public function test_writes_rfc_4180_with_bom_and_guards_formulas(): void
    {
        $document = new ExportDocument(
            title: 'Test',
            columns: [
                ExportColumn::text('name', 'Name'),
                ExportColumn::money('amount', 'Amount'),
                ExportColumn::quantity('quantity', 'Qty'),
                ExportColumn::dateTime('at', 'At'),
                ExportColumn::date('on', 'On'),
                ExportColumn::status('status', 'Status'),
            ],
            rows: fn () => yield from [
                ['name' => 'Plain', 'amount' => '-12.50', 'quantity' => '2.500', 'at' => '2026-11-06 18:30:00', 'on' => '2026-11-07', 'status' => 'partially_received'],
                ['name' => "=1+1\nline, \"quoted\"", 'amount' => '1234567.89', 'quantity' => 3, 'at' => null, 'on' => null, 'status' => null],
                ['name' => '@SUM(A1)', 'amount' => 'n/a', 'quantity' => '-1', 'at' => null, 'on' => null, 'status' => null],
                ['name' => 'রহিম', 'amount' => '+5', 'quantity' => '0', 'at' => null, 'on' => null, 'status' => null],
            ],
            total: 4,
            filters: [],
            letterhead: ['name' => 'Acme', 'legal_name' => null, 'address' => null, 'phone' => null, 'email' => null, 'tax_number' => null, 'slug' => 'acme', 'timezone' => 'Asia/Dhaka', 'logo' => null],
            timezone: 'Asia/Dhaka',
            generatedAt: CarbonImmutable::now(),
            generatedBy: null,
        );
        $path = tempnam(sys_get_temp_dir(), 'csv');

        $count = (new CsvExportWriter)->write($document, $path);
        $content = (string) file_get_contents($path);
        @unlink($path);

        $this->assertSame(4, $count);
        $this->assertSame(
            "\xEF\xBB\xBF".'Name,Amount,Qty,At,On,Status'."\r\n"
            .'Plain,-12.50,2.500,2026-11-07 00:30,2026-11-07,Partially received'."\r\n"
            ."\"'=1+1\nline, \"\"quoted\"\"\",1234567.89,3,,,\r\n"
            ."'@SUM(A1),n/a,-1,,,\r\n"
            ."রহিম,5,0,,,\r\n",
            $content,
        );
    }
}
