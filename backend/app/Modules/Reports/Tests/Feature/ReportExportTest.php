<?php

namespace App\Modules\Reports\Tests\Feature;

use App\Modules\Audit\Infrastructure\Models\AuditLog;
use App\Modules\Reports\Tests\Concerns\BuildsReportData;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Shared\Tests\Concerns\ReadsExports;
use App\Modules\Users\Infrastructure\Models\Role;
use Illuminate\Foundation\Testing\RefreshDatabase;
use OpenSpout\Common\Entity\Cell\NumericCell;
use Tests\TestCase;

/**
 * Phase 7: reports export through X1 (`?export=xlsx|pdf|csv`): every row in the report's
 * order plus a totals row, the user's columns only, filters on the document, audit.
 */
class ReportExportTest extends TestCase
{
    use BuildsReportData, InteractsWithTenancy, ReadsExports, RefreshDatabase;

    public function test_reports_export_to_xlsx_csv_and_pdf(): void
    {
        $pdf = $this->fakePdfRenderer();
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant('Export Mart');
        $soap = $this->sellable($org, '=HYPERLINK("http://evil.test")', '100.00', ['cost' => '40.00']);
        $tea = $this->sellable($org, 'Tea, "Green"', '50.00', ['cost' => '20.00']);
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $this->travelTo($this->dhaka('2026-11-02 10:00'));
        $this->stockUp($store, $soap, '10', '40.00');
        $this->stockUp($store, $tea, '10', '20.00');
        $this->checkout($this->cart($store, [[$soap, '2'], [$tea, '1']], [['cash', '250']]))->assertCreated();
        $query = 'date_from=2026-11-01&date_to=2026-11-03&branch_id='.$branch->id;

        $xlsx = $this->get("/api/v1/reports/sales_daily?{$query}&export=xlsx")->assertOk();
        $this->assertMatchesRegularExpression('/filename=report-sales-daily-export-mart-\d{8}-\d{4}\.xlsx/', (string) $xlsx->headers->get('Content-Disposition'));
        $rows = $this->xlsxRows($xlsx);
        $this->assertSame(['Date', 'Orders', 'Gross sales', 'Discounts', 'Returns', 'Net sales', 'Tax', 'Delivery income', 'Average ticket', 'Cost of goods', 'Gross profit', 'Margin %'], $rows[0]);
        $this->assertCount(1 + 3 + 1, $rows, 'header, three days, totals');
        $this->assertSame('Total', $rows[4][0]);
        $this->assertEquals(250.0, $rows[4][5]);
        $this->assertInstanceOf(NumericCell::class, $this->xlsxCells($xlsx)[2][5]);
        $this->assertSame('4', $xlsx->headers->get('X-Export-Rows'));

        $csv = $this->get("/api/v1/reports/sales_by_product?{$query}&export=csv&sort=product")->assertOk();
        $csv->assertHeader('Content-Type', 'text/csv; charset=UTF-8');
        $this->assertMatchesRegularExpression('/filename=report-sales-by-product-export-mart-\d{8}-\d{4}\.csv/', (string) $csv->headers->get('Content-Disposition'));
        $content = $this->csvContent($csv);
        $this->assertStringStartsWith("\xEF\xBB\xBFProduct,Category,Brand,Quantity,Orders,", $content);
        $this->assertStringContainsString("\r\n", $content);
        $this->assertStringContainsString('"Tea, ""Green"""', $content, 'RFC 4180 quoting');
        $records = $this->csvRows($csv);
        $this->assertSame('\'=HYPERLINK("http://evil.test")', $records[1][0], 'formula guard');
        $this->assertSame(['2.000', '1', '200.00', '0.00', '0.00', '200.00', '80.00', '120.00', '60.00'], array_slice($records[1], 3));
        $this->assertSame('Total', $records[3][0]);
        $this->assertSame('250.00', $records[3][8]);

        $this->get("/api/v1/reports/profit_and_loss?{$query}&export=pdf")->assertOk()->assertHeader('Content-Type', 'application/pdf');
        $html = $pdf->lastHtml();
        $this->assertStringContainsString('<h1>Profit and loss</h1>', $html);
        $this->assertStringContainsString('Period: 01 Nov–03 Nov 2026', $html);
        $this->assertStringContainsString('Net profit', $html);
        $this->assertStringContainsString('Branch: '.e($branch->name), $html);

        // Ledgers stream through the query (paged in SQL).
        $movements = $this->csvRows($this->get("/api/v1/reports/stock_movements?{$query}&export=csv")->assertOk());
        $this->assertSame('Date', $movements[0][0]);
        $this->assertCount(1 + 4, $movements, 'two openings and two sale movements');

        $audited = AuditLog::query()->withoutGlobalScopes()->where('action', 'export.created')->get()->map(fn (AuditLog $log) => $log->context['list'] ?? null)->all();
        $this->assertSame(['report-sales-daily', 'report-sales-by-product', 'report-profit-and-loss', 'report-stock-movements'], $audited);
        $this->get("/api/v1/reports/sales_daily?{$query}&export=docx")->assertStatus(422);
    }

    public function test_exports_leave_out_cost_columns_the_user_may_not_see(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $soap = $this->sellable($org, 'Soap', '100.00', ['cost' => '40.00']);
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $this->stockUp($store, $soap, '10', '40.00');
        $roleId = $this->postJson('/api/v1/roles', ['name' => 'Report reader', 'permissions' => ['reports.view']])->assertCreated()->json('data.id');
        $this->actingAsUser($this->createUserWithRole($org, Role::query()->withoutGlobalScopes()->findOrFail($roleId), [$branch->id]));

        $rows = $this->csvRows($this->get('/api/v1/reports/inventory_valuation?export=csv')->assertOk());

        $this->assertSame(['Store', 'Items in stock', 'Quantity'], $rows[0]);
        $this->assertSame(['Total', '1', '10.000'], $rows[2]);
    }

    public function test_csv_is_offered_on_every_x1_list(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $this->customer($org, '+SUM(A1)');
        $this->actingAsUser($admin);

        $rows = $this->csvRows($this->get('/api/v1/customers?export=csv')->assertOk());

        $this->assertSame('Code', $rows[0][0]);
        $this->assertSame("'+SUM(A1)", $rows[1][1]);
    }
}
