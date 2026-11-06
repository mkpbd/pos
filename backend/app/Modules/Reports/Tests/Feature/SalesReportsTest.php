<?php

namespace App\Modules\Reports\Tests\Feature;

use App\Modules\Catalog\Infrastructure\Models\Category;
use App\Modules\Organizations\Infrastructure\Models\Organization;
use App\Modules\Products\Infrastructure\Models\ProductVariant;
use App\Modules\Reports\Tests\Concerns\BuildsReportData;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Suppliers\Infrastructure\Models\Supplier;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Phase 7 sales reports, P&L and tax on one hand-computed scenario (exclusive tax, Asia/Dhaka):
 *
 * Soap 100 + VAT 10 %, cost 40; Tea 50, no tax, cost 20.
 * Nov 2: sale A — 2 soap + 1 tea, invoice discount 25 (soap 20, tea 5): net 225, tax 18, cost 100;
 *        sale B — 1 soap, cancelled (excluded); web order W3 delivered — 2 tea: net 100, cost 40,
 *        delivery 60.
 * Nov 3: return of 1 soap from A (restocked: net 90, tax 9, cost 40); sale C — 3 tea: net 150,
 *        cost 60; return of 1 tea from C written off (net 50, cost stays); web order W1
 *        delivered — 1 soap, 10 off: net 90, tax 9, cost 40, delivery 60; W3 refund of 1 tea
 *        (net 50, restocked: cost 20); W2 confirmed only (excluded).
 */
class SalesReportsTest extends TestCase
{
    use BuildsReportData, InteractsWithTenancy, RefreshDatabase;

    private Organization $org;

    private User $admin;

    private string $branchId;

    private string $store;

    private ProductVariant $soap;

    private ProductVariant $tea;

    protected function setUp(): void
    {
        parent::setUp();
        ['admin' => $this->admin, 'organization' => $this->org, 'branch' => $branch] = $this->provisionTenant('Report Mart');
        $this->branchId = $branch->id;
        $this->store = $this->mainStoreId($this->org);
        $categories = $this->inTenant($this->org, fn () => [
            'care' => Category::query()->create(['name' => 'Personal care'])->id,
            'drinks' => Category::query()->create(['name' => 'Drinks'])->id,
        ]);
        $this->soap = $this->sellable($this->org, 'Soap', '100.00', ['tax' => '10', 'cost' => '40.00']);
        $this->tea = $this->sellable($this->org, 'Tea', '50.00', ['cost' => '20.00']);
        $this->inTenant($this->org, function () use ($categories) {
            $this->soap->product()->update(['category_id' => $categories['care']]);
            $this->tea->product()->update(['category_id' => $categories['drinks']]);
        });
        $this->actingAsUser($this->admin);
        $this->travelTo($this->dhaka('2026-11-01 09:00'));
        $this->stockUp($this->store, $this->soap, '20', '40.00');
        $this->stockUp($this->store, $this->tea, '20', '20.00');
    }

    /**
     * @return array{a: array<string, mixed>, c: array<string, mixed>}
     */
    private function scenario(): array
    {
        $this->travelTo($this->dhaka('2026-11-02 10:00'));
        $a = $this->checkout($this->cart($this->store, [[$this->soap, '2'], [$this->tea, '1']], [['cash', '243']],
            ['invoice_discount' => ['type' => 'amount', 'value' => '25']]))->assertCreated()->assertJsonPath('data.total', '243.00')->json('data');
        $b = $this->checkout($this->cart($this->store, [[$this->soap, '1']], [['card', '110']]))->assertCreated()->json('data');
        $this->postJson("/api/v1/sales/{$b['id']}/cancel", ['reason' => 'Mistake'])->assertOk();
        $w3 = $this->webOrder($this->org, $this->store, [['variant' => $this->tea, 'quantity' => '2', 'unit_price' => '50', 'unit_cost' => '20']],
            ['delivered_at' => $this->dhaka('2026-11-02 12:00'), 'shipping_total' => '60']);

        $this->travelTo($this->dhaka('2026-11-03 10:00'));
        $soapLine = collect($a['lines'])->firstWhere('variant_id', $this->soap->id)['id'];
        $this->posReturn($a['id'], [[$soapLine, '1', true]], [['cash', '99']])->assertCreated()->assertJsonPath('data.status', 'completed');
        $c = $this->checkout($this->cart($this->store, [[$this->tea, '3']], [['cash', '150']]))->assertCreated()->json('data');
        $this->posReturn($c['id'], [[$c['lines'][0]['id'], '1', false]], [['cash', '50']])->assertCreated();
        $this->webOrder($this->org, $this->store, [['variant' => $this->soap, 'quantity' => '1', 'unit_price' => '100', 'discount' => '10', 'tax_rate' => '10', 'unit_cost' => '40']],
            ['delivered_at' => $this->dhaka('2026-11-03 12:00'), 'shipping_total' => '60']);
        $this->webOrder($this->org, $this->store, [['variant' => $this->soap, 'quantity' => '5', 'unit_price' => '100', 'tax_rate' => '10', 'unit_cost' => '40']],
            ['status' => 'confirmed', 'placed_at' => $this->dhaka('2026-11-03 09:00')]);
        $this->webRefund($this->org, $w3['id'], [['line' => $w3['lines'][0], 'quantity' => '1', 'amount' => '50', 'cost' => '20', 'restock' => true]], $this->dhaka('2026-11-03 15:00'));
        $this->travelTo($this->dhaka('2026-11-05 10:00'));

        return ['a' => $a, 'c' => $c];
    }

    public function test_daily_sales_count_pos_and_delivered_web_orders_net_of_returns_and_cancellations(): void
    {
        $this->scenario();

        $response = $this->report('sales_daily', ['date_from' => '2026-11-01', 'date_to' => '2026-11-04'])->assertOk();
        $rows = collect($response->json('data'))->keyBy('date');

        $this->assertSame(['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04'], $rows->keys()->all(), 'every day of the range, in order');
        $this->assertSame([
            'date' => '2026-11-02', 'orders' => 2, 'gross_sales' => '350.00', 'discounts' => '25.00', 'returns' => '0.00', 'net_sales' => '325.00',
            'tax' => '18.00', 'delivery_income' => '60.00', 'average_ticket' => '162.50', 'cost' => '140.00', 'gross_profit' => '185.00', 'margin' => '56.92',
        ], $rows['2026-11-02']);
        $this->assertSame([
            'date' => '2026-11-03', 'orders' => 2, 'gross_sales' => '250.00', 'discounts' => '10.00', 'returns' => '190.00', 'net_sales' => '50.00',
            'tax' => '0.00', 'delivery_income' => '60.00', 'average_ticket' => '25.00', 'cost' => '40.00', 'gross_profit' => '10.00', 'margin' => '20.00',
        ], $rows['2026-11-03']);
        $this->assertSame('0.00', $rows['2026-11-01']['net_sales']);
        $this->assertNull($rows['2026-11-01']['margin']);

        $response->assertJsonPath('meta.totals', [
            'orders' => 4, 'gross_sales' => '600.00', 'discounts' => '35.00', 'returns' => '190.00', 'net_sales' => '375.00', 'tax' => '18.00',
            'delivery_income' => '120.00', 'average_ticket' => '93.75', 'cost' => '180.00', 'gross_profit' => '195.00', 'margin' => '52.00',
        ]);
        $response->assertJsonPath('meta.params.timezone', 'Asia/Dhaka')
            ->assertJsonPath('meta.params.channel', 'all')
            ->assertJsonPath('meta.pagination.total', 4)
            ->assertJsonPath('meta.omitted_columns', [])
            ->assertJsonPath('meta.sort', 'date');

        // Channels.
        $pos = $this->report('sales_daily', ['date_from' => '2026-11-01', 'date_to' => '2026-11-04', 'channel' => 'pos'])->assertOk();
        $pos->assertJsonPath('meta.totals.net_sales', '235.00')->assertJsonPath('meta.totals.orders', 2)->assertJsonPath('meta.totals.delivery_income', '0.00');
        $online = $this->report('sales_daily', ['date_from' => '2026-11-01', 'date_to' => '2026-11-04', 'channel' => 'online'])->assertOk();
        $online->assertJsonPath('meta.totals.net_sales', '140.00')->assertJsonPath('meta.totals.delivery_income', '120.00')->assertJsonPath('meta.totals.cost', '60.00');

        // Sorting and paging.
        $sorted = $this->report('sales_daily', ['date_from' => '2026-11-01', 'date_to' => '2026-11-04', 'sort' => '-net_sales', 'per_page' => 1, 'page' => 1])->assertOk();
        $sorted->assertJsonPath('data.0.date', '2026-11-02')->assertJsonCount(1, 'data')->assertJsonPath('meta.pagination.last_page', 4);
    }

    public function test_monthly_sales_group_by_organization_month(): void
    {
        $this->scenario();

        $response = $this->report('sales_monthly', ['date_from' => '2026-10-01', 'date_to' => '2026-11-30'])->assertOk();

        $this->assertSame(['2026-10', '2026-11'], array_column($response->json('data'), 'month'));
        $response->assertJsonPath('data.1.net_sales', '375.00')->assertJsonPath('data.1.month_label', 'Nov 2026')->assertJsonPath('data.0.net_sales', '0.00');
    }

    public function test_sales_by_product_category_branch_and_cashier(): void
    {
        $this->scenario();
        $period = ['date_from' => '2026-11-01', 'date_to' => '2026-11-04'];

        $products = $this->rowsBy('sales_by_product', $period, 'product');
        $this->assertSame(['quantity' => '2.000', 'orders' => 2, 'gross_sales' => '300.00', 'discounts' => '30.00', 'returns' => '90.00', 'net_sales' => '180.00',
            'cost' => '80.00', 'gross_profit' => '100.00', 'margin' => '55.56'], array_intersect_key($products['Soap'], array_flip(['quantity', 'orders', 'gross_sales', 'discounts', 'returns', 'net_sales', 'cost', 'gross_profit', 'margin'])));
        $this->assertSame(['4.000', 3, '300.00', '5.00', '100.00', '195.00', '100.00', '95.00', '48.72'],
            [$products['Tea']['quantity'], $products['Tea']['orders'], $products['Tea']['gross_sales'], $products['Tea']['discounts'], $products['Tea']['returns'],
                $products['Tea']['net_sales'], $products['Tea']['cost'], $products['Tea']['gross_profit'], $products['Tea']['margin']]);
        $this->assertSame('Personal care', $products['Soap']['category']);
        $this->assertSame(['Soap', 'Tea'], array_column($this->report('sales_by_product', $period + ['sort' => 'product'])->json('data'), 'product'));
        $this->assertSame(['Tea', 'Soap'], array_column($this->report('sales_by_product', $period)->json('data'), 'product'), 'default: net sales, highest first');
        // Filters: product, category (with sub-categories), brand.
        $this->assertSame(['Soap'], array_column($this->report('sales_by_product', $period + ['product_id' => $this->soap->product_id])->json('data'), 'product'));
        $drinks = $this->inTenant($this->org, fn () => Category::query()->where('name', 'Drinks')->value('id'));
        $this->assertSame(['Tea'], array_column($this->report('sales_by_product', $period + ['category_id' => $drinks])->json('data'), 'product'));

        $categories = $this->rowsBy('sales_by_category', $period, 'category');
        $this->assertSame('180.00', $categories['Personal care']['net_sales']);
        $this->assertSame('48.00', $categories['Personal care']['share']);
        $this->assertSame('52.00', $categories['Drinks']['share']);

        $branches = $this->report('sales_by_branch', $period)->assertOk();
        $branches->assertJsonCount(1, 'data')->assertJsonPath('data.0.net_sales', '375.00')->assertJsonPath('data.0.delivery_income', '120.00')
            ->assertJsonPath('data.0.orders', 4);

        $cashiers = $this->rowsBy('sales_by_cashier', $period, 'cashier');
        $this->assertSame([$this->admin->name, 'Online'], array_keys($cashiers));
        $this->assertSame(['orders' => 2, 'gross_sales' => '400.00', 'discounts' => '25.00', 'returns' => '140.00', 'net_sales' => '235.00', 'tax' => '9.00', 'average_ticket' => '117.50', 'cancelled' => 1],
            array_intersect_key($cashiers[$this->admin->name], array_flip(['orders', 'gross_sales', 'discounts', 'returns', 'net_sales', 'tax', 'average_ticket', 'cancelled'])));
        $this->assertSame(['orders' => 2, 'net_sales' => '140.00', 'tax' => '9.00', 'cancelled' => null], array_intersect_key($cashiers['Online'], array_flip(['orders', 'net_sales', 'tax', 'cancelled'])));
        // A cashier filter leaves web orders out.
        $this->assertSame([$this->admin->name], array_column($this->report('sales_by_cashier', $period + ['cashier_id' => $this->admin->id])->json('data'), 'cashier'));
    }

    public function test_profit_and_loss_with_expenses_other_income_and_the_previous_period(): void
    {
        $this->scenario();
        $this->expense($this->org, $this->branchId, 'Utilities', '100', '2026-11-02');
        $this->expense($this->org, $this->branchId, 'Utilities', '999', '2026-11-03', voided: true);
        $this->expense($this->org, $this->branchId, 'Landed cost', '15', '2026-11-03', onAccount: true);
        $this->expense($this->org, $this->branchId, 'Rent', '50', '2026-11-01');
        $this->expense($this->org, $this->branchId, 'Commission', '30', '2026-11-03', 'income');

        $response = $this->report('profit_and_loss', ['date_from' => '2026-11-02', 'date_to' => '2026-11-03'])->assertOk();
        $lines = collect($response->json('data'))->keyBy('key');

        $this->assertSame(['gross_sales', 'discounts', 'returns', 'net_sales', 'delivery_income', 'total_revenue', 'cost_of_goods_sold', 'gross_profit'],
            array_slice($lines->keys()->all(), 0, 8));
        $amounts = $lines->map(fn ($l) => $l['amount'])->all();
        $this->assertSame('600.00', $amounts['gross_sales']);
        $this->assertSame('-35.00', $amounts['discounts']);
        $this->assertSame('-190.00', $amounts['returns']);
        $this->assertSame('375.00', $amounts['net_sales']);
        $this->assertSame('120.00', $amounts['delivery_income']);
        $this->assertSame('495.00', $amounts['total_revenue']);
        $this->assertSame('-180.00', $amounts['cost_of_goods_sold']);
        $this->assertSame('315.00', $amounts['gross_profit']);
        $this->assertSame('-115.00', $amounts['total_expenses'], 'utilities 100 + on-account 15; voided excluded; rent is in the previous period');
        $this->assertSame('30.00', $amounts['total_other_income']);
        $this->assertSame('230.00', $amounts['net_profit']);
        $this->assertSame(['Landed cost', 'Rent', 'Utilities'], $lines->filter(fn ($l) => str_starts_with($l['key'], 'expense:'))->pluck('label')->values()->all());
        $rent = $lines->first(fn ($l) => $l['label'] === 'Rent');
        $this->assertSame(['0.00', '-50.00'], [$rent['amount'], $rent['previous_amount']]);
        $this->assertSame('-50.00', $lines['net_profit']['previous_amount']);
        $this->assertSame('280.00', $lines['net_profit']['change']);
        $this->assertSame('560.00', $lines['net_profit']['change_pct']);
        $this->assertSame('total', $lines['net_profit']['kind']);
        $response->assertJsonPath('meta.previous_period', ['date_from' => '2026-10-31', 'date_to' => '2026-11-01'])
            ->assertJsonPath('meta.totals', null)
            ->assertJsonPath('meta.summary.net_profit', '230.00');
    }

    public function test_tax_report_nets_output_tax_on_sales_against_input_tax_on_purchases(): void
    {
        $this->scenario();
        $this->travelTo($this->dhaka('2026-11-03 11:00'));
        $supplier = $this->inTenant($this->org, fn () => Supplier::query()->create(['code' => 'SUP-1', 'name' => 'Lever', 'is_active' => true]));
        $this->postJson('/api/v1/purchasing/receipts', [
            'supplier_id' => $supplier->id, 'store_id' => $this->store, 'supplier_invoice_number' => 'LV-1', 'invoice_date' => '2026-11-03',
            'lines' => [['variant_id' => $this->soap->id, 'quantity' => '10', 'unit_cost' => '40', 'tax_rate' => '10']],
        ], ['Idempotency-Key' => (string) Str::uuid()])->assertCreated();
        $this->travelTo($this->dhaka('2026-11-05 10:00'));

        $rows = $this->rowsBy('tax', ['date_from' => '2026-11-01', 'date_to' => '2026-11-04'], 'tax');

        $this->assertSame(['taxable_sales' => '180.00', 'output_tax' => '18.00', 'taxable_purchases' => '400.00', 'input_tax' => '40.00', 'net_tax' => '-22.00'],
            array_intersect_key($rows['10%'], array_flip(['taxable_sales', 'output_tax', 'taxable_purchases', 'input_tax', 'net_tax'])));
        $this->assertSame('195.00', $rows['0%']['taxable_sales']);
        $this->assertSame('10.00', $rows['10%']['rate']);
        $this->report('tax', ['date_from' => '2026-11-01', 'date_to' => '2026-11-04'])
            ->assertJsonPath('meta.totals', ['taxable_sales' => '375.00', 'output_tax' => '18.00', 'taxable_purchases' => '400.00', 'input_tax' => '40.00', 'net_tax' => '-22.00']);
    }

    public function test_tax_inclusive_organizations_report_net_of_tax(): void
    {
        Organization::query()->whereKey($this->org->id)->update(['tax_mode' => 'inclusive']);
        $this->travelTo($this->dhaka('2026-11-02 10:00'));
        // 2 × 100 incl. 10 % VAT = 200, tax 18.18, net 181.82.
        $this->checkout($this->cart($this->store, [[$this->soap, '2']], [['cash', '200']]))->assertCreated()->assertJsonPath('data.total', '200.00');
        $this->webOrder($this->org, $this->store, [['variant' => $this->soap, 'quantity' => '1', 'unit_price' => '110', 'tax_rate' => '10', 'unit_cost' => '40']],
            ['delivered_at' => $this->dhaka('2026-11-02 12:00'), 'tax_mode' => 'inclusive']);

        $this->report('sales_daily', ['date_from' => '2026-11-02', 'date_to' => '2026-11-02'])->assertOk()
            ->assertJsonPath('data.0.gross_sales', '281.82')
            ->assertJsonPath('data.0.net_sales', '281.82')
            ->assertJsonPath('data.0.tax', '28.18')
            ->assertJsonPath('data.0.cost', '120.00');
    }

    public function test_landed_cost_reaches_cogs_through_the_weighted_average(): void
    {
        $this->travelTo($this->dhaka('2026-11-02 09:00'));
        $syrup = $this->sellable($this->org, 'Syrup', '100.00', ['cost' => '40.00']);
        $supplier = $this->inTenant($this->org, fn () => Supplier::query()->create(['code' => 'SUP-2', 'name' => 'Square', 'is_active' => true]));
        // 10 at 40 + freight 50 allocated by value → landed unit cost 45.
        $this->postJson('/api/v1/purchasing/receipts', [
            'supplier_id' => $supplier->id, 'store_id' => $this->store, 'supplier_invoice_number' => 'SQ-1', 'invoice_date' => '2026-11-02',
            'lines' => [['variant_id' => $syrup->id, 'quantity' => '10', 'unit_cost' => '40', 'tax_rate' => '0']],
            'charges' => [['type' => 'freight', 'amount' => '50', 'allocation' => 'value']],
        ], ['Idempotency-Key' => (string) Str::uuid()])->assertCreated();
        $this->checkout($this->cart($this->store, [[$syrup, '2']], [['cash', '200']]))->assertCreated();

        $this->report('sales_by_product', ['date_from' => '2026-11-02', 'date_to' => '2026-11-02', 'product_id' => $syrup->product_id])->assertOk()
            ->assertJsonPath('data.0.cost', '90.00')
            ->assertJsonPath('data.0.gross_profit', '110.00');
        $this->report('purchases', ['date_from' => '2026-11-02', 'date_to' => '2026-11-02'])->assertOk()
            ->assertJsonPath('data.0.group', 'Square')
            ->assertJsonPath('data.0.goods', '400.00')
            ->assertJsonPath('data.0.landed_cost', '50.00')
            ->assertJsonPath('data.0.landed_total', '450.00');
    }
}
