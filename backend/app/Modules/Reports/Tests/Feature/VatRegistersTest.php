<?php

namespace App\Modules\Reports\Tests\Feature;

use App\Modules\Branches\Infrastructure\Models\Store;
use App\Modules\Organizations\Infrastructure\Models\Organization;
use App\Modules\Products\Infrastructure\Models\ProductVariant;
use App\Modules\Reports\Tests\Concerns\BuildsReportData;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Shared\Tests\Concerns\ReadsExports;
use App\Modules\Suppliers\Infrastructure\Models\Supplier;
use App\Modules\Users\Domain\Roles\SystemRole;
use App\Modules\Users\Infrastructure\Models\Role;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * VAT1: the Mushak-6.2 sales register, the Mushak-6.1 purchase register and the monthly VAT
 * summary for Mushak-9.1 on one hand-computed scenario (exclusive tax, Asia/Dhaka):
 *
 * Soap 100 + VAT 10 %; Tea 50, no VAT. Customer Acme Traders, BIN 000111222-0101.
 * Sales (November, local time):
 *   1 Nov 00:30  A  walk-in, 1 tea                                   value 50.00, VAT 0
 *   2 Nov 10:00  B  Acme, 2 soap + 1 tea, invoice discount 25 →  soap 180.00 / 18.00, tea 45.00 / 0
 *   2 Nov 12:00  W1 web, Acme, 1 soap less 10                        90.00 / 9.00
 *   2 Nov 13:00  W3 web, Rina (no customer), 2 tea                   100.00 / 0
 *   3 Nov 10:00  return of 1 soap from B                            −90.00 / −9.00
 *   3 Nov 15:00  refund of 1 tea from W3                            −50.00 / 0
 *   W2 confirmed only (not a sale); 1 Dec 00:30 sale C, 1 soap 100.00 / 10.00 (December).
 *   → November: value 325.00, VAT 18.00, total 343.00 (POS 185.00 / 9.00, web 140.00 / 9.00).
 * Purchases (supplier Lever, BIN 000222333-0202):
 *   GRN 3 Nov, invoice LV-1: 10 soap at 40 less 5 % = 380.00 / 38.00; 4 tea at 20 = 80.00 / 0
 *   4 Nov: return of 2 soap from that receipt −76.00 / −7.60; direct return of 1 tea −20.00 / 0
 *   GRN invoice date 1 Dec: 1 tea 20.00 (December).
 *   → November: value 364.00, VAT 30.40, total 394.40.
 * 9.1 November: output 18.00 − input 30.40 → 12.40 carried forward. December: 10.00 payable.
 */
class VatRegistersTest extends TestCase
{
    use BuildsReportData, InteractsWithTenancy, ReadsExports, RefreshDatabase;

    private Organization $org;

    private User $admin;

    private string $branchId;

    private string $store;

    private ProductVariant $soap;

    private ProductVariant $tea;

    private Supplier $lever;

    private const NOV = ['date_from' => '2026-11-01', 'date_to' => '2026-11-30'];

    protected function setUp(): void
    {
        parent::setUp();
        ['admin' => $this->admin, 'organization' => $this->org, 'branch' => $branch] = $this->provisionTenant('Vat Mart');
        $this->branchId = $branch->id;
        $this->store = $this->mainStoreId($this->org);
        $this->soap = $this->sellable($this->org, 'Soap', '100.00', ['tax' => '10', 'cost' => '40.00']);
        $this->tea = $this->sellable($this->org, 'Tea', '50.00', ['cost' => '20.00']);
        $this->lever = $this->inTenant($this->org, fn () => Supplier::query()->create(['code' => 'SUP-1', 'name' => 'Lever', 'tax_number' => '000222333-0202', 'is_active' => true]));
        $this->actingAsUser($this->admin);
        $this->travelTo($this->dhaka('2026-10-30 09:00'));
        $this->stockUp($this->store, $this->soap, '20', '40.00');
        $this->stockUp($this->store, $this->tea, '20', '20.00');
    }

    private function scenario(): void
    {
        $acme = $this->customer($this->org, 'Acme Traders');
        DB::table('customers')->where('id', $acme->id)->update(['tax_number' => '000111222-0101']);

        $this->travelTo($this->dhaka('2026-11-01 00:30'));
        $this->checkout($this->cart($this->store, [[$this->tea, '1']], [['cash', '50']]))->assertCreated();

        $this->travelTo($this->dhaka('2026-11-02 10:00'));
        $b = $this->checkout($this->cart($this->store, [[$this->soap, '2'], [$this->tea, '1']], [['cash', '243']],
            ['customer_id' => $acme->id, 'invoice_discount' => ['type' => 'amount', 'value' => '25']]))->assertCreated()->assertJsonPath('data.total', '243.00')->json('data');
        $w1 = $this->webOrder($this->org, $this->store, [['variant' => $this->soap, 'quantity' => '1', 'unit_price' => '100', 'discount' => '10', 'tax_rate' => '10', 'unit_cost' => '40']],
            ['delivered_at' => $this->dhaka('2026-11-02 12:00')]);
        DB::table('orders')->where('id', $w1['id'])->update(['customer_id' => $acme->id, 'contact_name' => 'Acme buyer']);
        $w3 = $this->webOrder($this->org, $this->store, [['variant' => $this->tea, 'quantity' => '2', 'unit_price' => '50', 'unit_cost' => '20']],
            ['delivered_at' => $this->dhaka('2026-11-02 13:00')]);

        $this->travelTo($this->dhaka('2026-11-03 10:00'));
        $soapLine = collect($b['lines'])->firstWhere('variant_id', $this->soap->id)['id'];
        $this->posReturn($b['id'], [[$soapLine, '1', true]], [['cash', '99']])->assertCreated()->assertJsonPath('data.status', 'completed');
        $this->webOrder($this->org, $this->store, [['variant' => $this->soap, 'quantity' => '5', 'unit_price' => '100', 'tax_rate' => '10', 'unit_cost' => '40']],
            ['status' => 'confirmed', 'placed_at' => $this->dhaka('2026-11-03 09:00')]);
        $this->webRefund($this->org, $w3['id'], [['line' => $w3['lines'][0], 'quantity' => '1', 'amount' => '50', 'cost' => '20', 'restock' => true]], $this->dhaka('2026-11-03 15:00'));

        $this->travelTo($this->dhaka('2026-11-03 11:00'));
        $receipt = $this->receive('2026-11-03', 'LV-1', [
            ['variant_id' => $this->soap->id, 'quantity' => '10', 'unit_cost' => '40', 'tax_rate' => '10', 'discount_percent' => '5'],
            ['variant_id' => $this->tea->id, 'quantity' => '4', 'unit_cost' => '20', 'tax_rate' => '0'],
        ])->assertJsonPath('data.total', '498.00')->json('data');

        $this->travelTo($this->dhaka('2026-11-04 10:00'));
        $receiptSoap = collect($receipt['lines'])->firstWhere('variant.id', $this->soap->id)['id'];
        $this->postJson("/api/v1/purchasing/receipts/{$receipt['id']}/returns", ['reason' => 'Damaged', 'lines' => [['goods_receipt_line_id' => $receiptSoap, 'quantity' => '2']]],
            ['Idempotency-Key' => (string) Str::uuid()])->assertCreated()->assertJsonPath('data.total', '83.60');
        $this->postJson('/api/v1/purchasing/returns', ['supplier_id' => $this->lever->id, 'store_id' => $this->store, 'reason' => 'Old stock', 'lines' => [['variant_id' => $this->tea->id, 'quantity' => '1']]],
            ['Idempotency-Key' => (string) Str::uuid()])->assertCreated()->assertJsonPath('data.total', '20.00');

        // December (local): sale C at 00:30 on 1 Dec (18:30 UTC on 30 Nov) and a receipt dated 1 Dec.
        $this->travelTo($this->dhaka('2026-12-01 00:30'));
        $this->checkout($this->cart($this->store, [[$this->soap, '1']], [['cash', '110']]))->assertCreated();
        $this->receive('2026-12-01', 'LV-2', [['variant_id' => $this->tea->id, 'quantity' => '1', 'unit_cost' => '20', 'tax_rate' => '0']]);
        $this->travelTo($this->dhaka('2026-12-05 10:00'));
    }

    /**
     * @param  list<array<string, string>>  $lines
     */
    private function receive(string $invoiceDate, string $invoice, array $lines): TestResponse
    {
        return $this->postJson('/api/v1/purchasing/receipts', [
            'supplier_id' => $this->lever->id, 'store_id' => $this->store, 'supplier_invoice_number' => $invoice, 'invoice_date' => $invoiceDate, 'lines' => $lines,
        ], ['Idempotency-Key' => (string) Str::uuid()])->assertCreated();
    }

    /**
     * @param  array<string, mixed>  $row
     * @return list<mixed>
     */
    private static function pick(array $row, array $keys): array
    {
        return array_map(fn (string $k) => $row[$k], $keys);
    }

    public function test_the_sales_register_lists_every_sales_line_with_returns_negative(): void
    {
        $this->scenario();

        $response = $this->report('mushak_6_2', self::NOV + ['per_page' => 500])->assertOk();
        $keys = ['date', 'type', 'buyer_name', 'buyer_bin', 'description', 'quantity', 'value', 'sd', 'vat_rate', 'vat', 'total'];
        $this->assertSame([
            ['2026-11-01', 'Sale', 'Walk-in customer', null, 'Tea', '1.000', '50.00', '0.00', '0.00', '0.00', '50.00'],
            ['2026-11-02', 'Sale', 'Acme Traders', '000111222-0101', 'Soap', '2.000', '180.00', '0.00', '10.00', '18.00', '198.00'],
            ['2026-11-02', 'Sale', 'Acme Traders', '000111222-0101', 'Tea', '1.000', '45.00', '0.00', '0.00', '0.00', '45.00'],
            ['2026-11-02', 'Sale', 'Acme buyer', '000111222-0101', 'Line 0', '1.000', '90.00', '0.00', '10.00', '9.00', '99.00'],
            ['2026-11-02', 'Sale', 'Rina Akter', null, 'Line 0', '2.000', '100.00', '0.00', '0.00', '0.00', '100.00'],
            ['2026-11-03', 'Return', 'Acme Traders', '000111222-0101', 'Soap', '-1.000', '-90.00', '0.00', '10.00', '-9.00', '-99.00'],
            ['2026-11-03', 'Return', 'Rina Akter', null, 'Line 0', '-1.000', '-50.00', '0.00', '0.00', '0.00', '-50.00'],
        ], array_map(fn (array $r) => self::pick($r, $keys), $response->json('data')));
        $this->assertSame(['pos', 'pos', 'pos', 'online', 'online', 'pos', 'online'], array_column($response->json('data'), 'channel'));
        $this->assertSame(['WEB-000001', 'WEB-000002'], [$response->json('data.3.invoice_number'), $response->json('data.4.invoice_number')]);
        $this->assertSame($response->json('data.1.invoice_number'), $response->json('data.2.invoice_number'), 'one till invoice, two lines');
        $this->assertNotSame($response->json('data.1.invoice_number'), $response->json('data.5.invoice_number'), 'a return carries its own number');
        $response->assertJsonPath('meta.totals', ['value' => '325.00', 'sd' => '0.00', 'vat' => '18.00', 'total' => '343.00'])
            ->assertJsonPath('meta.pagination.total', 7)
            ->assertJsonPath('meta.sort', 'date');

        // Newest first; paging in SQL.
        $latest = $this->report('mushak_6_2', self::NOV + ['sort' => '-date', 'per_page' => 2])->assertOk();
        $this->assertSame(['-50.00', '-90.00'], array_column($latest->json('data'), 'value'));
        $latest->assertJsonPath('meta.pagination.last_page', 4)->assertJsonPath('meta.totals.total', '343.00');

        // Channels.
        $this->report('mushak_6_2', self::NOV + ['channel' => 'pos'])->assertOk()
            ->assertJsonPath('meta.pagination.total', 4)->assertJsonPath('meta.totals', ['value' => '185.00', 'sd' => '0.00', 'vat' => '9.00', 'total' => '194.00']);
        $this->report('mushak_6_2', self::NOV + ['channel' => 'online'])->assertOk()
            ->assertJsonPath('meta.pagination.total', 3)->assertJsonPath('meta.totals', ['value' => '140.00', 'sd' => '0.00', 'vat' => '9.00', 'total' => '149.00']);

        // Local days: 1 Dec 00:30 in Dhaka is December even though it is 30 Nov in UTC.
        $this->report('mushak_6_2', ['date_from' => '2026-11-30', 'date_to' => '2026-11-30'])->assertJsonPath('meta.pagination.total', 0)->assertJsonPath('meta.totals.value', '0.00');
        $this->report('mushak_6_2', ['date_from' => '2026-12-01', 'date_to' => '2026-12-01'])->assertJsonPath('data.0.value', '100.00')->assertJsonPath('data.0.vat', '10.00');
        $this->report('mushak_6_2', ['date_from' => '2026-11-01', 'date_to' => '2026-11-01'])->assertJsonPath('meta.pagination.total', 1)->assertJsonPath('data.0.description', 'Tea');
    }

    public function test_the_purchase_register_lists_receipt_lines_after_discount_and_returns_negative(): void
    {
        $this->scenario();

        $response = $this->report('mushak_6_1', self::NOV + ['per_page' => 500])->assertOk();
        $keys = ['date', 'type', 'supplier_name', 'supplier_bin', 'supplier_invoice_number', 'quantity', 'value', 'sd', 'vat_rate', 'vat', 'total'];
        $rows = collect($response->json('data'))->keyBy(fn (array $r) => $r['type'].' '.$r['description'])->map(fn (array $r) => self::pick($r, $keys))->all();
        $this->assertSame([
            'Purchase Soap' => ['2026-11-03', 'Purchase', 'Lever', '000222333-0202', 'LV-1', '10.000', '380.00', '0.00', '10.00', '38.00', '418.00'],
            'Purchase Tea' => ['2026-11-03', 'Purchase', 'Lever', '000222333-0202', 'LV-1', '4.000', '80.00', '0.00', '0.00', '0.00', '80.00'],
            'Return Soap' => ['2026-11-04', 'Return', 'Lever', '000222333-0202', 'LV-1', '-2.000', '-76.00', '0.00', '10.00', '-7.60', '-83.60'],
            'Return Tea' => ['2026-11-04', 'Return', 'Lever', '000222333-0202', null, '-1.000', '-20.00', '0.00', '0.00', '0.00', '-20.00'],
        ], $rows);
        $this->assertSame(['2026-11-03', '2026-11-03', '2026-11-04', '2026-11-04'], array_column($response->json('data'), 'date'));
        $this->assertStringStartsWith('GRN', (string) $response->json('data.0.receipt_number'));
        $response->assertJsonPath('meta.totals', ['value' => '364.00', 'sd' => '0.00', 'vat' => '30.40', 'total' => '394.40'])
            ->assertJsonPath('meta.pagination.total', 4);

        // The invoice date decides the month of a receipt.
        $this->report('mushak_6_1', ['date_from' => '2026-12-01', 'date_to' => '2026-12-31'])->assertOk()
            ->assertJsonPath('meta.pagination.total', 1)->assertJsonPath('data.0.supplier_invoice_number', 'LV-2')->assertJsonPath('meta.totals.value', '20.00');
    }

    public function test_the_monthly_summary_equals_the_registers(): void
    {
        $this->scenario();

        $response = $this->report('mushak_9_1', ['month' => '2026-11'])->assertOk();
        $lines = array_map(fn (array $r) => [$r['key'], $r['label'], $r['vat_rate'], $r['value'], $r['sd'], $r['vat']], $response->json('data'));
        $this->assertSame([
            ['output:Sale:0.00', 'Sales at 0%', '0.00', '195.00', '0.00', '0.00'],
            ['output:Return:0.00', 'Less sales returns at 0%', '0.00', '-50.00', '0.00', '0.00'],
            ['output:Sale:10.00', 'Sales at 10%', '10.00', '270.00', '0.00', '27.00'],
            ['output:Return:10.00', 'Less sales returns at 10%', '10.00', '-90.00', '0.00', '-9.00'],
            ['output_total', 'Total output VAT', null, '325.00', '0.00', '18.00'],
            ['input:Purchase:0.00', 'Purchases at 0%', '0.00', '80.00', '0.00', '0.00'],
            ['input:Return:0.00', 'Less purchase returns at 0%', '0.00', '-20.00', '0.00', '0.00'],
            ['input:Purchase:10.00', 'Purchases at 10%', '10.00', '380.00', '0.00', '38.00'],
            ['input:Return:10.00', 'Less purchase returns at 10%', '10.00', '-76.00', '0.00', '-7.60'],
            ['input_total', 'Total input VAT', null, '364.00', '0.00', '30.40'],
            ['carried_forward', 'VAT credit carried forward', null, null, '0.00', '12.40'],
        ], $lines);
        $response->assertJsonPath('meta.summary', [
            'output_value' => '325.00', 'output_vat' => '18.00', 'input_value' => '364.00', 'input_vat' => '30.40',
            'net_vat' => '-12.40', 'payable' => '0.00', 'carried_forward' => '12.40',
        ])->assertJsonPath('meta.period', self::NOV)->assertJsonPath('meta.totals', null)->assertJsonPath('meta.params.month', '2026-11');

        // The registers' totals for the same month.
        $sales = $this->report('mushak_6_2', self::NOV)->json('meta.totals');
        $purchases = $this->report('mushak_6_1', self::NOV)->json('meta.totals');
        $this->assertSame([$sales['value'], $sales['vat']], [$response->json('meta.summary.output_value'), $response->json('meta.summary.output_vat')]);
        $this->assertSame([$purchases['value'], $purchases['vat']], [$response->json('meta.summary.input_value'), $response->json('meta.summary.input_vat')]);

        // December: sale C at 00:30 local on 1 Dec, input 0 → payable.
        $december = $this->report('mushak_9_1', ['month' => '2026-12'])->assertOk();
        $december->assertJsonPath('meta.summary.output_vat', '10.00')->assertJsonPath('meta.summary.input_vat', '0.00')->assertJsonPath('meta.summary.payable', '10.00');
        $last = $december->json('data.'.(count($december->json('data')) - 1));
        $this->assertSame(['net_payable', 'Net VAT payable', '10.00'], [$last['key'], $last['label'], $last['vat']]);
        $this->assertSame($this->report('mushak_6_2', ['date_from' => '2026-12-01', 'date_to' => '2026-12-31'])->json('meta.totals.vat'), $december->json('meta.summary.output_vat'));

        // An empty month: totals only.
        $this->report('mushak_9_1', ['month' => '2026-10'])->assertOk()->assertJsonCount(3, 'data')->assertJsonPath('data.2.key', 'net_payable')->assertJsonPath('data.2.vat', '0.00');

        $this->report('mushak_9_1')->assertStatus(422)->assertJsonValidationErrorFor('month', 'error.details');
        $this->report('mushak_9_1', ['month' => '2026-13'])->assertStatus(422)->assertJsonValidationErrorFor('month', 'error.details');
        $this->report('mushak_9_1', ['month' => '2026-11-01'])->assertStatus(422);
        $this->report('mushak_6_2', self::NOV + ['channel' => 'web'])->assertStatus(422)->assertJsonValidationErrorFor('channel', 'error.details');
    }

    public function test_branch_scope_and_tenant_isolation(): void
    {
        $ctg = $this->createBranch($this->org, 'CTG');
        $ctgStore = $this->inTenant($this->org, fn () => Store::query()->where('branch_id', $ctg->id)->value('id'));
        $this->stockUp($ctgStore, $this->soap, '10', '40.00');
        $this->travelTo($this->dhaka('2026-11-02 10:00'));
        $this->checkout($this->cart($this->store, [[$this->tea, '1']], [['cash', '50']]))->assertCreated();
        $this->receive('2026-11-02', 'LV-9', [['variant_id' => $this->tea->id, 'quantity' => '1', 'unit_cost' => '20', 'tax_rate' => '0']]);
        $this->postJson('/api/v1/purchasing/receipts', [
            'supplier_id' => $this->lever->id, 'store_id' => $ctgStore, 'supplier_invoice_number' => 'CTG-1', 'invoice_date' => '2026-11-02',
            'lines' => [['variant_id' => $this->soap->id, 'quantity' => '1', 'unit_cost' => '40', 'tax_rate' => '10']],
        ], ['Idempotency-Key' => (string) Str::uuid()])->assertCreated();
        // A user has one open register session at a time: the CTG sale is rung up by CTG staff.
        $ctgManager = $this->createUserWithRole($this->org, SystemRole::BranchManager, [$ctg->id]);
        $this->actingAsUser($ctgManager);
        $this->checkout($this->cart($ctgStore, [[$this->soap, '2']], [['cash', '220']]))->assertCreated();
        $this->webOrder($this->org, $ctgStore, [['variant' => $this->soap, 'quantity' => '1', 'unit_price' => '100', 'tax_rate' => '10', 'unit_cost' => '40']],
            ['delivered_at' => $this->dhaka('2026-11-02 12:00')]);
        // Another organization's documents never show.
        ['admin' => $rivalAdmin, 'organization' => $rival] = $this->provisionTenant('Rival Shop');
        $rivalTea = $this->sellable($rival, 'Tea', '999.00');
        $rivalStore = $this->mainStoreId($rival);
        $this->actingAsUser($rivalAdmin);
        $this->stockUp($rivalStore, $rivalTea, '5');
        $this->checkout($this->cart($rivalStore, [[$rivalTea, '1']], [['cash', '999']]))->assertCreated();
        $this->travelTo($this->dhaka('2026-11-05 10:00'));

        $this->actingAsUser($this->admin);
        // Main: 1 tea 50.00; CTG: 2 soap 200.00 / 20.00 at the till + 1 soap 100.00 / 10.00 on the web.
        $this->report('mushak_6_2', self::NOV)->assertJsonPath('meta.totals.total', '380.00')->assertJsonPath('meta.pagination.total', 3);
        $this->report('mushak_6_2', self::NOV + ['branch_id' => $ctg->id])->assertJsonPath('meta.totals.value', '300.00')->assertJsonPath('meta.totals.vat', '30.00');
        $this->report('mushak_6_1', self::NOV)->assertJsonPath('meta.totals.total', '64.00');
        $this->report('mushak_6_1', self::NOV + ['branch_id' => $this->branchId])->assertJsonPath('meta.totals.total', '20.00');
        $this->report('mushak_9_1', ['month' => '2026-11', 'branch_id' => $ctg->id])->assertJsonPath('meta.summary.output_vat', '30.00')->assertJsonPath('meta.summary.input_vat', '4.00')
            ->assertJsonPath('meta.summary.payable', '26.00');

        $this->actingAsUser($ctgManager);
        $this->report('mushak_6_2', self::NOV)->assertJsonPath('meta.totals.value', '300.00')->assertJsonPath('meta.pagination.total', 2);
        $this->report('mushak_6_1', self::NOV)->assertJsonPath('meta.totals.value', '40.00');
        $this->report('mushak_9_1', ['month' => '2026-11'])->assertJsonPath('meta.summary.output_value', '300.00');
        $this->report('mushak_6_2', self::NOV + ['branch_id' => $this->branchId])->assertStatus(422)->assertJsonPath('error.details.branch_id.0', 'You do not have access to this branch.');

        $this->actingAsUser($rivalAdmin);
        $this->report('mushak_6_2', self::NOV)->assertJsonPath('meta.pagination.total', 1)->assertJsonPath('meta.totals.value', '999.00');
        $this->report('mushak_6_1', self::NOV)->assertJsonPath('meta.pagination.total', 0);
        $this->report('mushak_9_1', ['month' => '2026-11', 'branch_id' => $ctg->id])->assertStatus(422);
    }

    public function test_the_registers_need_reports_financial_and_export(): void
    {
        $this->scenario();
        $roleId = $this->postJson('/api/v1/roles', ['name' => 'Report reader', 'permissions' => ['reports.view']])->assertCreated()->json('data.id');
        $reader = $this->createUserWithRole($this->org, Role::query()->withoutGlobalScopes()->findOrFail($roleId), [$this->branchId]);

        $this->actingAsUser($reader);
        $this->assertSame([], array_values(array_intersect(['mushak_6_2', 'mushak_6_1', 'mushak_9_1'], array_column($this->getJson('/api/v1/reports')->assertOk()->json('data'), 'key'))));
        $this->report('mushak_6_2', self::NOV)->assertForbidden();
        $this->report('mushak_6_1', self::NOV)->assertForbidden();
        $this->report('mushak_9_1', ['month' => '2026-11'])->assertForbidden();

        $this->actingAsUser($this->createUserWithRole($this->org, SystemRole::Accountant, [$this->branchId]));
        $definitions = collect($this->getJson('/api/v1/reports')->assertOk()->json('data'))->keyBy('key');
        $this->assertSame('finance', $definitions['mushak_6_2']['group']);
        $this->assertSame(['date_from', 'date_to', 'branch_id', 'channel'], array_column($definitions['mushak_6_2']['params'], 'name'));
        $this->assertSame(['all', 'pos', 'online'], array_column(collect($definitions['mushak_6_2']['params'])->firstWhere('name', 'channel')['options'], 'value'));
        $this->assertSame(['name' => 'month', 'label' => 'Month', 'type' => 'month', 'required' => true], $definitions['mushak_9_1']['params'][0]);
        $this->assertFalse($definitions['mushak_9_1']['time_based']);
        $this->assertStringContainsString('not the return form', $definitions['mushak_9_1']['description']);
        $this->assertStringContainsString('Landed-cost charges', $definitions['mushak_6_1']['description']);

        $csv = $this->csvRows($this->get('/api/v1/reports/mushak_6_2?date_from=2026-11-01&date_to=2026-11-30&export=csv')->assertOk());
        $this->assertSame(['Date', 'Type', 'Invoice no.', "Buyer's name", "Buyer's BIN", 'Description of goods / services', 'Quantity', 'Value (excl. VAT)',
            'Supplementary duty', 'VAT rate %', 'VAT', 'Total value'], $csv[0]);
        $this->assertCount(1 + 7, $csv);
        $this->assertSame(['2026-11-02', 'Sale', 'Acme Traders', '000111222-0101', 'Soap', '2.000', '180.00', '0.00', '10.00', '18.00', '198.00'],
            [$csv[2][0], $csv[2][1], $csv[2][3], $csv[2][4], $csv[2][5], $csv[2][6], $csv[2][7], $csv[2][8], $csv[2][9], $csv[2][10], $csv[2][11]]);

        $purchases = $this->csvRows($this->get('/api/v1/reports/mushak_6_1?date_from=2026-11-01&date_to=2026-11-30&export=csv')->assertOk());
        $this->assertSame(['Date', 'Type', 'Receipt (GRN) no.', "Supplier's name", "Supplier's BIN", "Supplier's invoice no.", 'Description of goods / services',
            'Quantity', 'Value (excl. VAT)', 'Supplementary duty', 'VAT rate %', 'VAT (input)', 'Total value'], $purchases[0]);
        $this->assertCount(1 + 4, $purchases);

        $summary = $this->csvRows($this->get('/api/v1/reports/mushak_9_1?month=2026-11&export=csv')->assertOk());
        $this->assertSame(['Line', 'VAT rate %', 'Value (excl. VAT)', 'Supplementary duty', 'VAT'], $summary[0]);
        $this->assertSame(['VAT credit carried forward', '', '', '0.00', '12.40'], $summary[count($summary) - 1]);
    }
}
