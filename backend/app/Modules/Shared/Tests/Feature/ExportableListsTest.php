<?php

namespace App\Modules\Shared\Tests\Feature;

use App\Modules\Inventory\Infrastructure\Models\StockReorderRule;
use App\Modules\Promotions\Tests\Concerns\BuildsPromotions;
use App\Modules\Purchasing\Infrastructure\Models\SupplierProduct;
use App\Modules\Sales\Tests\Concerns\InteractsWithSales;
use App\Modules\Shared\Infrastructure\Http\Exports\ListExporter;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Shared\Tests\Concerns\ReadsExports;
use App\Modules\Suppliers\Infrastructure\Models\Supplier;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Route;
use Illuminate\Support\Facades\Route as Router;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\DataProvider;
use ReflectionMethod;
use ReflectionNamedType;
use Tests\TestCase;

/**
 * Every exportable admin list answers `?export=xlsx` (and `pdf`) with its header row, and
 * every list endpoint that can export is listed here.
 */
class ExportableListsTest extends TestCase
{
    use BuildsPromotions, InteractsWithSales, InteractsWithTenancy, ReadsExports, RefreshDatabase;

    /**
     * URI (with {customer}/{supplier}/{promotion} placeholders) => [route URI, expected first header, filename stem].
     *
     * @return array<string, array{0: string, 1: string, 2: string, 3: string}>
     */
    public static function lists(): array
    {
        return [
            'sales' => ['sales', 'sales?status=completed', 'Invoice', 'sales', 1],
            'sale returns' => ['returns', 'returns', 'Return', 'sale-returns', 0],
            'customer payments' => ['customer-payments', 'customer-payments', 'Number', 'customer-payments', 1],
            'customer statement' => ['customers/{customerId}/statement', 'customers/{customer}/statement?from=2026-01-01', 'Date', 'customer-statement', 1],
            'customers' => ['customers', 'customers?is_active=1', 'Code', 'customers', 1],
            'suppliers' => ['suppliers', 'suppliers', 'Code', 'suppliers', 1],
            'products' => ['products', 'products?type=standard', 'Product', 'products', 1],
            'users' => ['users', 'users', 'Name', 'users', 1],
            'audit log' => ['audit-logs', 'audit-logs?action=user.*', 'Date', 'audit-log', 0],
            'purchase orders' => ['purchasing/orders', 'purchasing/orders', 'Order', 'purchase-orders', 0],
            'goods receipts' => ['purchasing/receipts', 'purchasing/receipts?from=2026-01-01', 'Receipt', 'goods-receipts', 0],
            'purchase returns' => ['purchasing/returns', 'purchasing/returns', 'Return', 'purchase-returns', 0],
            'supplier payments' => ['purchasing/payments', 'purchasing/payments', 'Number', 'supplier-payments', 0],
            'supplier statement' => ['purchasing/suppliers/{supplierId}/statement', 'purchasing/suppliers/{supplier}/statement', 'Date', 'supplier-statement', 0],
            'supplier catalog' => ['purchasing/supplier-products', 'purchasing/supplier-products?is_active=1', 'Product', 'supplier-catalog', 1],
            'reorder suggestions' => ['purchasing/reorder-suggestions', 'purchasing/reorder-suggestions?store_id={store}&only=purchase', 'Product', 'reorder-suggestions', 1],
            'purchase requisitions' => ['purchasing/requisitions', 'purchasing/requisitions?status=draft', 'Requisition', 'purchase-requisitions', 0],
            'rfqs' => ['purchasing/rfqs', 'purchasing/rfqs?status=sent', 'RFQ', 'rfqs', 0],
            'pending approvals' => ['purchasing/approvals', 'purchasing/approvals?kind=requisition', 'Document', 'pending-approvals', 0],
            'landed cost vouchers' => ['purchasing/landed-cost-vouchers', 'purchasing/landed-cost-vouchers?status=posted', 'Voucher', 'landed-cost-vouchers', 0],
            'supplier performance' => ['purchasing/supplier-performance', 'purchasing/supplier-performance?date_from=2026-01-01', 'Supplier', 'supplier-performance', 0],
            'stock' => ['inventory/stock', 'inventory/stock?low_stock=0', 'Product', 'stock', 1],
            'batches' => ['inventory/batches', 'inventory/batches', 'Product', 'batches', 1],
            'stock movements' => ['inventory/movements', 'inventory/movements', 'Date', 'stock-movements', 1],
            'valuation' => ['inventory/valuation', 'inventory/valuation', 'Store', 'stock-valuation', 1],
            'adjustments' => ['inventory/adjustments', 'inventory/adjustments', 'Adjustment', 'stock-adjustments', 1],
            'transfers' => ['inventory/transfers', 'inventory/transfers', 'Transfer', 'stock-transfers', 0],
            'register sessions' => ['register-sessions', 'register-sessions', 'Session', 'register-sessions', 1],
            'payments ledger' => ['payments', 'payments?direction=in', 'Date', 'payments', 1],
            'expenses' => ['expenses', 'expenses?type=expense', 'Number', 'expenses', 0],
            'other income' => ['expenses', 'expenses?type=income', 'Number', 'income', 0],
            'web orders' => ['web-orders', 'web-orders?date_from=2026-01-01', 'Order', 'web-orders', 0],
            'web order returns' => ['web-order-returns', 'web-order-returns', 'Return', 'web-returns', 0],
            'cod remittances' => ['cod-remittances', 'cod-remittances', 'Remittance', 'cod-remittances', 0],
            'promotions' => ['promotions', 'promotions?status=active', 'Promotion', 'promotions', 1],
            'promotion report' => ['promotions/{promotion}/report', 'promotions/{promotion}/report?date_from=2026-11-01&date_to=2026-11-05', 'Date', 'promotion-report', 1],
            'reviews' => ['reviews', 'reviews', 'Date', 'reviews', 0],
            'contact messages' => ['cms/contact-messages', 'cms/contact-messages?status=open', 'Received', 'contact-messages', 0],
            'newsletter subscribers' => ['cms/newsletter-subscribers', 'cms/newsletter-subscribers', 'E-mail', 'newsletter-subscribers', 0],
            // B8b.
            'form submissions' => ['forms/submissions', 'forms/submissions?status=new', 'Received', 'form-submissions', 0],
            // Phase 7: every report of the registry exports the same way (one route).
            'reports' => ['reports/{key}', 'reports/sales_by_product?date_from=2026-01-01&date_to=2026-12-31', 'Product', 'report-sales-by-product', 1],
        ];
    }

    #[DataProvider('lists')]
    public function test_list_exports_to_xlsx_and_pdf(string $route, string $uri, string $firstHeader, string $stem, int $minRows): void
    {
        $pdf = $this->fakePdfRenderer();
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant('Export Co');
        $customer = $this->customer($org, 'Rina', creditLimit: '500');
        $supplier = $this->inTenant($org, fn () => Supplier::query()->create(['code' => 'SUP-1', 'name' => 'Pran', 'is_active' => true]));
        $promotion = $this->makePromotion($org, ['name' => 'Eid sale', 'type' => 'percent', 'value' => '10']);
        $syrup = $this->sellable($org, 'Syrup', '100.00', ['batches' => true]);
        $store = $this->mainStoreId($org);
        // SC1: a preferred catalog row and a reorder rule the stock falls below.
        $this->inTenant($org, function () use ($supplier, $syrup, $store, $branch) {
            SupplierProduct::query()->create(['supplier_id' => $supplier->id, 'variant_id' => $syrup->id, 'unit_cost' => '55', 'pack_size' => '6', 'is_preferred' => true]);
            StockReorderRule::query()->create(['branch_id' => $branch->id, 'store_id' => $store, 'variant_id' => $syrup->id, 'min_qty' => '20', 'max_qty' => '30']);
        });
        $this->actingAsUser($admin);
        // Stock (adjustment, movements, batch), a part-paid sale (session, ledger) and a customer payment.
        $this->stockUp($store, $syrup, '10', '60.00', 'B1', now()->addMonth()->toDateString());
        $this->checkout($this->cart($store, [[$syrup, '1']], [['cash', '60']], ['customer_id' => $customer->id]))->assertCreated();
        $this->postJson('/api/v1/customer-payments', ['customer_id' => $customer->id, 'branch_id' => $branch->id, 'amount' => '20', 'method' => 'cash'], ['Idempotency-Key' => (string) Str::uuid()])->assertCreated();
        $uri = '/api/v1/'.strtr($uri, ['{customer}' => $customer->id, '{supplier}' => $supplier->id, '{promotion}' => $promotion->id, '{store}' => $store]);
        $separator = str_contains($uri, '?') ? '&' : '?';

        $xlsx = $this->get($uri.$separator.'export=xlsx')->assertOk();
        $this->assertMatchesRegularExpression("/filename={$stem}-export-co-\\d{8}-\\d{4}\\.xlsx/", (string) $xlsx->headers->get('Content-Disposition'));
        $rows = $this->xlsxRows($xlsx);
        $this->assertSame($firstHeader, $rows[0][0] ?? null);
        $this->assertGreaterThanOrEqual($minRows, count($rows) - 1, 'Expected exported rows');
        $this->assertSame((string) (count($rows) - 1), $xlsx->headers->get('X-Export-Rows'));

        $this->get($uri.$separator.'export=pdf')->assertOk()->assertHeader('Content-Type', 'application/pdf');
        $this->assertStringContainsString('<th class="left">'.e($firstHeader).'</th>', str_replace('class="right"', 'class="left"', $pdf->lastHtml()));
    }

    /**
     * A list that can export must be covered above (and the frontend's EXPORTABLE_LISTS).
     */
    public function test_every_list_that_exports_is_covered(): void
    {
        $exporting = collect(Router::getRoutes()->getRoutes())
            ->filter(fn (Route $r) => in_array('GET', $r->methods(), true) && is_string($r->getAction('uses')) && str_contains($r->getAction('uses'), '@'))
            ->filter(function (Route $r) {
                [$class, $method] = explode('@', $r->getAction('uses'));
                if (! method_exists($class, $method)) {
                    return false;
                }

                return collect((new ReflectionMethod($class, $method))->getParameters())
                    ->contains(fn ($p) => $p->getType() instanceof ReflectionNamedType && $p->getType()->getName() === ListExporter::class);
            })
            ->map(fn (Route $r) => preg_replace('#^api/v1/#', '', $r->uri()))
            ->unique()->sort()->values()->all();

        $covered = collect(self::lists())->pluck(0)->unique()->sort()->values()->all();

        $this->assertSame($covered, $exporting);
    }
}
