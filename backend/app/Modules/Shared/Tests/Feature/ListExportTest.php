<?php

namespace App\Modules\Shared\Tests\Feature;

use App\Modules\Audit\Infrastructure\Models\AuditLog;
use App\Modules\Organizations\Infrastructure\Models\Organization;
use App\Modules\Sales\Tests\Concerns\InteractsWithSales;
use App\Modules\Shared\Application\Export\PdfRenderer;
use App\Modules\Shared\Infrastructure\Export\BrowsershotPdfRenderer;
use App\Modules\Shared\Infrastructure\Export\ChromeLocator;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Shared\Tests\Concerns\ReadsExports;
use App\Modules\Users\Domain\Roles\SystemRole;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use OpenSpout\Common\Entity\Cell\DateTimeCell;
use OpenSpout\Common\Entity\Cell\NumericCell;
use OpenSpout\Common\Entity\Cell\StringCell;
use Tests\TestCase;

/**
 * List exports (X1): `?export=xlsx|pdf` on admin lists — file contents, letterhead and
 * filters, limits, permissions, tenant isolation, audit and throttling.
 */
class ListExportTest extends TestCase
{
    use InteractsWithSales, InteractsWithTenancy, ReadsExports, RefreshDatabase;

    public function test_sales_export_to_xlsx_matches_the_filtered_list(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant('Dhaka Traders');
        $soap = $this->sellable($org, 'Soap', '1250.50');
        $store = $this->mainStoreId($org);
        $customer = $this->customer($org, 'রহিম উদ্দিন');
        $this->actingAsUser($admin);
        $this->stockUp($store, $soap, '50');
        $this->checkout($this->cart($store, [[$soap, '1']], [['cash', '1250.50']]))->assertCreated();
        $this->checkout($this->cart($store, [[$soap, '2']], [['cash', '2501.00']], ['customer_id' => $customer->id]))->assertCreated();
        $cancelled = $this->checkout($this->cart($store, [[$soap, '1']], [['cash', '1250.50']]))->json('data.id');
        $this->postJson("/api/v1/sales/{$cancelled}/cancel", ['reason' => 'Mistake'])->assertOk();

        $list = $this->getJson('/api/v1/sales?status=completed&sort=-total')->assertOk();
        $response = $this->get('/api/v1/sales?status=completed&sort=-total&page=2&per_page=1&export=xlsx')->assertOk();

        $response->assertHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        $this->assertMatchesRegularExpression('/^attachment; filename=sales-dhaka-traders-\d{8}-\d{4}\.xlsx/', (string) $response->headers->get('Content-Disposition'));
        $this->assertStringContainsString('no-store', (string) $response->headers->get('Cache-Control'));

        $cells = $this->xlsxCells($response);
        // Every page, not just the one asked for: header + the list's total.
        $this->assertCount($list->json('meta.pagination.total') + 1, $cells);
        $this->assertSame(['Invoice', 'Date', 'Branch', 'Store', 'Customer', 'Cashier', 'Subtotal', 'Discount', 'Tax', 'Total', 'Paid', 'Due', 'Status'], array_map(fn ($c) => $c->getValue(), $cells[0]));
        $first = $cells[1];
        $this->assertSame($list->json('data.0.number'), $first[0]->getValue());
        $this->assertInstanceOf(StringCell::class, $first[0]);
        $this->assertInstanceOf(DateTimeCell::class, $first[1]);
        // Dates are written in the organization's timezone (Asia/Dhaka).
        $soldAt = CarbonImmutable::parse($list->json('data.0.sold_at'))->setTimezone('Asia/Dhaka');
        $this->assertSame($soldAt->format('Y-m-d H:i'), $first[1]->getValue()->format('Y-m-d H:i'));
        $this->assertInstanceOf(NumericCell::class, $first[9]);
        $this->assertEquals(2501.0, $first[9]->getValue());
        $this->assertSame('রহিম উদ্দিন', $first[4]->getValue());
        $this->assertSame('Completed', $first[12]->getValue());
        $this->assertSame('Walk-in', $cells[2][4]->getValue());

        $sheet = $this->xlsxSheetXml($response);
        $this->assertStringContainsString('state="frozen"', $sheet);
        $this->assertStringContainsString('ySplit="1"', $sheet);
        // Money cells use the built-in "#,##0.00" format (id 4).
        $this->assertStringContainsString('numFmtId="4"', $this->xlsxSheetXml($response, 'xl/styles.xml'));
    }

    public function test_text_is_never_written_as_a_formula(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $this->customer($org, '=HYPERLINK("http://evil.test","x")');
        $this->actingAsUser($admin);

        $rows = $this->xlsxRows($this->get('/api/v1/customers?export=xlsx')->assertOk());

        $this->assertSame('=HYPERLINK("http://evil.test","x")', $rows[1][1]);
        $this->assertStringNotContainsString('<f>', $this->xlsxSheetXml($this->get('/api/v1/customers?export=xlsx')));
    }

    public function test_pdf_export_renders_letterhead_filters_and_escaped_rows(): void
    {
        $pdf = $this->fakePdfRenderer();
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant('Dhaka Traders');
        Organization::query()->whereKey($org->id)->update([
            'legal_name' => 'Dhaka Traders Ltd.',
            'address' => 'House 12, Road 5, Dhanmondi',
            'phone' => '+8801711000000',
            'tax_number' => 'BIN-000123456',
        ]);
        $this->customer($org, '<script>alert(1)</script> & Co');
        $this->customer($org, 'করিম স্টোর');
        $this->actingAsUser($admin);

        $response = $this->get('/api/v1/customers?export=pdf&search=%3C&is_active=1')->assertOk();

        $response->assertHeader('Content-Type', 'application/pdf');
        $this->assertMatchesRegularExpression('/^attachment; filename=customers-dhaka-traders-\d{8}-\d{4}\.pdf/', (string) $response->headers->get('Content-Disposition'));
        $this->assertStringStartsWith('%PDF', (string) $response->getContent());
        $html = $pdf->lastHtml();
        $this->assertStringContainsString('Dhaka Traders', $html);
        $this->assertStringContainsString('Dhaka Traders Ltd.', $html);
        $this->assertStringContainsString('House 12, Road 5, Dhanmondi', $html);
        $this->assertStringContainsString('Tax no. BIN-000123456', $html);
        $this->assertStringContainsString('<h1>Customers</h1>', $html);
        $this->assertStringContainsString('Search: &quot;&lt;&quot; · Active: Yes', $html);
        $this->assertStringContainsString('by '.e($admin->name), $html);
        $this->assertStringContainsString('&lt;script&gt;alert(1)&lt;/script&gt; &amp; Co', $html);
        $this->assertStringNotContainsString('<script>alert(1)</script>', $html);
        $this->assertStringContainsString('<thead>', $html);
        $this->assertStringContainsString('display: table-header-group', $html);
        $this->assertStringContainsString("font-family:'Hind Siliguri'", $html);
        $this->assertStringContainsString('data:font/woff2;base64,', $html);
        // Nine columns: landscape, with the page-number footer.
        $this->assertTrue($pdf->rendered[0]['landscape']);
        $this->assertStringContainsString('class="pageNumber"', $pdf->rendered[0]['footer']);
        $this->assertStringContainsString('class="totalPages"', $pdf->rendered[0]['footer']);

        $this->get('/api/v1/customers?export=pdf&search=%E0%A6%95%E0%A6%B0%E0%A6%BF%E0%A6%AE')->assertOk();
        $this->assertStringContainsString('করিম স্টোর', $pdf->lastHtml());
        $this->assertStringContainsString('Search: &quot;করিম&quot;', $pdf->lastHtml());
    }

    public function test_narrow_lists_print_in_portrait(): void
    {
        $pdf = $this->fakePdfRenderer();
        ['admin' => $admin] = $this->provisionTenant();
        $this->actingAsUser($admin);

        $this->get('/api/v1/cms/newsletter-subscribers?export=pdf')->assertOk();

        $this->assertFalse($pdf->rendered[0]['landscape']);
        $this->assertStringContainsString('No records match these filters.', $pdf->lastHtml());
    }

    public function test_exports_above_the_limit_are_refused(): void
    {
        $this->fakePdfRenderer();
        config(['exports.max_rows.pdf' => 2, 'exports.max_rows.xlsx' => 3]);
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        foreach (['A', 'B', 'C'] as $name) {
            $this->customer($org, "Customer {$name}");
        }
        $this->actingAsUser($admin);

        $this->getJson('/api/v1/customers?export=pdf')
            ->assertStatus(422)
            ->assertJsonPath('error.code', 'EXPORT_TOO_LARGE')
            ->assertJsonPath('error.details.limit', 2)
            ->assertJsonPath('error.details.rows', 3);
        $this->get('/api/v1/customers?export=xlsx')->assertOk();
        $this->getJson('/api/v1/customers?export=pdf&search=Customer%20A')->assertOk();
        $this->assertSame(2, AuditLog::query()->where('action', 'export.created')->count());
    }

    public function test_unknown_formats_are_a_validation_error(): void
    {
        ['admin' => $admin] = $this->provisionTenant();
        $this->actingAsUser($admin);

        $this->getJson('/api/v1/customers?export=csv')
            ->assertStatus(422)
            ->assertJsonPath('error.code', 'VALIDATION_FAILED')
            ->assertJsonStructure(['error' => ['details' => ['export']]]);
    }

    public function test_exports_need_the_lists_view_permission(): void
    {
        ['organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $this->actingAsUser($this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]));

        $this->getJson('/api/v1/users?export=xlsx')->assertForbidden()->assertJsonPath('error.code', 'FORBIDDEN');
        $this->getJson('/api/v1/audit-logs?export=pdf')->assertForbidden();
        $this->getJson('/api/v1/purchasing/orders?export=xlsx')->assertForbidden();
        $this->assertSame(0, AuditLog::query()->withoutGlobalScopes()->where('action', 'export.created')->count());
    }

    public function test_exports_never_contain_another_organizations_rows(): void
    {
        $this->fakePdfRenderer();
        ['admin' => $adminA, 'organization' => $orgA] = $this->provisionTenant('Alpha Retail');
        ['organization' => $orgB] = $this->provisionTenant('Beta Retail');
        $this->customer($orgA, 'Alpha Customer');
        $this->customer($orgB, 'Beta Customer');
        $soap = $this->sellable($orgB, 'Beta Soap', '10.00');
        $this->actingAsUser($adminA);

        $rows = $this->xlsxRows($this->get('/api/v1/customers?export=xlsx')->assertOk());
        $this->assertSame(['Alpha Customer'], array_column(array_slice($rows, 1), 1));

        $products = $this->xlsxRows($this->get('/api/v1/products?export=xlsx')->assertOk());
        $this->assertNotContains('Beta Soap', array_column($products, 0));
        $this->assertCount(1, $products);

        $this->get('/api/v1/customers?export=pdf')->assertOk();
        $this->assertStringNotContainsString('Beta', app(PdfRenderer::class)->lastHtml());
        $this->assertNotNull($soap);
    }

    public function test_exports_are_audited(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $this->customer($org, 'Rina');
        $this->customer($org, 'Rafi');
        $this->actingAsUser($admin);

        $this->get('/api/v1/customers?export=xlsx&search=Ri&sort=-name&page=3')->assertOk();

        $log = AuditLog::query()->where('action', 'export.created')->sole();
        $this->assertSame($admin->id, $log->user_id);
        $this->assertSame(['list' => 'customers', 'format' => 'xlsx', 'filters' => ['search' => 'Ri', 'sort' => '-name'], 'rows' => 1], $log->context);
    }

    public function test_exports_are_throttled_per_user(): void
    {
        config(['exports.rate_limit' => 2]);
        ['admin' => $admin] = $this->provisionTenant();
        $this->actingAsUser($admin);

        $this->get('/api/v1/customers?export=xlsx')->assertOk();
        $this->get('/api/v1/suppliers?export=xlsx')->assertOk();
        $this->getJson('/api/v1/users?export=xlsx')
            ->assertStatus(429)
            ->assertJsonPath('error.code', 'TOO_MANY_REQUESTS')
            ->assertHeader('Retry-After');
        // The JSON lists themselves are not affected.
        $this->getJson('/api/v1/users')->assertOk();
    }

    public function test_missing_chrome_is_reported_as_pdf_unavailable(): void
    {
        config(['pdf.chrome_path' => base_path('missing/chrome.exe')]);
        ['admin' => $admin] = $this->provisionTenant();
        $this->actingAsUser($admin);

        $this->getJson('/api/v1/customers?export=pdf')
            ->assertStatus(503)
            ->assertJsonPath('error.code', 'PDF_UNAVAILABLE');
        $this->get('/api/v1/customers?export=xlsx')->assertOk();
        $this->assertSame(1, AuditLog::query()->where('action', 'export.created')->count());
    }

    public function test_chrome_locator_prefers_the_newest_playwright_chromium(): void
    {
        $root = storage_path('framework/testing/chrome-locator');
        foreach (['chromium-1200/chrome-win', 'chromium-1248/chrome-win64', 'chromium_headless_shell-1300/chrome-win64'] as $dir) {
            @mkdir("{$root}/ms-playwright/{$dir}", 0777, true);
            touch("{$root}/ms-playwright/{$dir}/chrome.exe");
        }

        try {
            $found = (new ChromeLocator(null, $root))->find();
            $this->assertSame(str_replace('/', DIRECTORY_SEPARATOR, "{$root}/ms-playwright/chromium-1248/chrome-win64/chrome.exe"), str_replace('/', DIRECTORY_SEPARATOR, (string) $found));
            $this->assertNull((new ChromeLocator("{$root}/nope.exe", $root))->find());
        } finally {
            app('files')->deleteDirectory($root);
        }
    }

    /**
     * Opt-in: PDF_E2E=1 renders a real PDF with headless Chrome (skipped when Chrome or the
     * renderer's node_modules are missing).
     */
    public function test_real_pdf_rendering_with_chrome(): void
    {
        if (getenv('PDF_E2E') !== '1') {
            $this->markTestSkipped('Set PDF_E2E=1 to render a real PDF with headless Chrome.');
        }
        if (ChromeLocator::fromConfig()->find() === null || ! is_dir(config('pdf.node_modules_path').'/puppeteer-core')) {
            $this->markTestSkipped('Chrome or backend/pdf-renderer/node_modules is not installed.');
        }
        $this->app->bind(PdfRenderer::class, fn () => new BrowsershotPdfRenderer(ChromeLocator::fromConfig()));
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant('Dhaka Traders');
        foreach (range(1, 60) as $i) {
            $this->customer($org, "গ্রাহক {$i} রহিম");
        }
        $this->actingAsUser($admin);

        $response = $this->get('/api/v1/customers?export=pdf')->assertOk();

        $bytes = (string) $response->getContent();
        if (is_string($out = getenv('PDF_E2E_OUT')) && $out !== '') {
            file_put_contents($out, $bytes); // keep the file for a manual look
        }
        $this->assertStringStartsWith('%PDF', $bytes);
        $this->assertStringContainsString('HindSiliguri', $bytes);
        $this->assertGreaterThan(1, preg_match_all('#/Type\s*/Page[^s]#', $bytes));
    }
}
