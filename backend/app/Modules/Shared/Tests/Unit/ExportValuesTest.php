<?php

namespace App\Modules\Shared\Tests\Unit;

use App\Modules\Shared\Infrastructure\Export\ExportValues;
use App\Modules\Shared\Infrastructure\Export\XlsxExportWriter;
use App\Modules\Shared\Infrastructure\Http\Exports\FilterSummary;
use Illuminate\Http\Request;
use Tests\TestCase;

/**
 * Value formatting shared by the Excel and PDF writers, and the filter summary line.
 */
class ExportValuesTest extends TestCase
{
    public function test_money_and_quantities_are_formatted_exactly(): void
    {
        $this->assertSame('1,234,567.50', ExportValues::grouped('1234567.5', 2));
        $this->assertSame('-20.00', ExportValues::grouped('-20', 2));
        $this->assertSame('0.00', ExportValues::grouped('-0.001', 2));
        $this->assertSame('999,999,999,999.99', ExportValues::grouped('999999999999.99', 2));
        $this->assertSame('2.5', ExportValues::quantity('2.500'));
        $this->assertSame('1,000', ExportValues::quantity('1000.000'));
        $this->assertSame('12.34', ExportValues::decimal('12.34'));
        $this->assertSame('7', ExportValues::decimal(7));
        $this->assertNull(ExportValues::decimal('12,34'));
        $this->assertNull(ExportValues::decimal(null));
    }

    public function test_instants_use_the_organization_timezone_and_dates_stay_calendar_days(): void
    {
        $this->assertSame('2026-11-05 14:30', ExportValues::instant('2026-11-05T08:30:00Z', 'Asia/Dhaka')?->format('Y-m-d H:i'));
        $this->assertSame('2026-11-05 00:00', ExportValues::instant('2026-11-05', 'Asia/Dhaka')?->format('Y-m-d H:i'));
        $this->assertNull(ExportValues::instant('Total', 'Asia/Dhaka'));
        $this->assertSame('Partially received', ExportValues::status('partially_received'));
        $this->assertSame('Yes', ExportValues::text(true));
        $this->assertSame('a, b', ExportValues::text(['a', null, 'b']));
    }

    public function test_sheet_names_fit_excel_rules(): void
    {
        $this->assertSame('Customer statement — Rahim Uddi', XlsxExportWriter::sheetName('Customer statement — Rahim Uddin (CUS-1)'));
        $this->assertSame('Sales returns', XlsxExportWriter::sheetName('Sales / returns'));
        $this->assertSame('Export', XlsxExportWriter::sheetName('[]'));
    }

    public function test_filter_summary_reads_like_the_screen(): void
    {
        $request = Request::create('/x', 'GET', ['search' => ' soap ', 'status' => 'partially_received', 'from' => '2026-11-01', 'to' => '2026-11-05', 'archived' => '1', 'is_active' => '0']);

        $parts = FilterSummary::of($request)
            ->search()
            ->value('status', 'Status')
            ->lookup('missing', 'Branch', fn () => 'never')
            ->boolean('is_active', 'Active')
            ->flag('archived', 'Archived only')
            ->dates()
            ->all();

        $this->assertSame(['Search: "soap"', 'Status: Partially received', 'Active: No', 'Archived only', 'Date: 01 Nov–05 Nov 2026'], $parts);
        $this->assertSame(['Date: 28 Dec 2025–05 Jan 2026'], FilterSummary::of(Request::create('/x', 'GET', ['from' => '2025-12-28', 'to' => '2026-01-05']))->dates()->all());
        $this->assertSame(['Paid: from 01 Nov 2026'], FilterSummary::of(Request::create('/x', 'GET', ['from' => '2026-11-01']))->dates(label: 'Paid')->all());
    }
}
