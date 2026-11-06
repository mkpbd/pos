<?php

namespace App\Modules\Reports\Tests\Feature;

use App\Modules\Catalog\Infrastructure\Models\Category;
use App\Modules\Inventory\Infrastructure\Models\StockReorderRule;
use App\Modules\Reports\Tests\Concerns\BuildsReportData;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Suppliers\Infrastructure\Models\Supplier;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Phase 7 inventory, purchasing, receivable/payable, collection and expense reports on
 * hand-computed data (Asia/Dhaka; "today" is 7 Nov 2026 unless stated).
 */
class OperationalReportsTest extends TestCase
{
    use BuildsReportData, InteractsWithTenancy, RefreshDatabase;

    public function test_inventory_valuation_movements_low_stock_and_expiry(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $this->actingAsUser($admin);
        $this->travelTo($this->dhaka('2026-11-01 10:00'));
        $drinks = $this->inTenant($org, fn () => Category::query()->create(['name' => 'Drinks'])->id);
        $juice = $this->stockedVariant($org, 'Juice', ['category_id' => $drinks], '10');
        $syrup = $this->sellable($org, 'Syrup', '80.00', ['batches' => true]);
        $ruled = $this->stockedVariant($org, 'Ruled', [], '0');
        $store = $this->mainStoreId($org);
        $this->stockUp($store, $juice, '4', '20.00');
        $this->stockUp($store, $syrup, '5', '30.00', 'SOON', '2026-11-12');
        $this->stockUp($store, $syrup, '3', '35.00', 'LATER', '2027-06-01');
        $this->stockUp($store, $syrup, '2', '30.00', 'OLD', '2026-11-05');
        $this->inTenant($org, fn () => StockReorderRule::query()->create(['branch_id' => $branch->id, 'store_id' => $store, 'variant_id' => $ruled->id, 'min_qty' => '5']));
        $this->travelTo($this->dhaka('2026-11-02 10:00'));
        $this->checkout($this->cart($store, [[$juice, '1']], [['cash', '15']]))->assertCreated();
        $this->travelTo($this->dhaka('2026-11-07 10:00'));

        // Valuation: juice 3 × 20 = 60, syrup 5 × 30 + 3 × 35 + 2 × 30 = 315.
        $byStore = $this->report('inventory_valuation')->assertOk();
        $byStore->assertJsonPath('data.0.group', 'Main Store')->assertJsonPath('data.0.items', 2)->assertJsonPath('data.0.quantity', '13.000')
            ->assertJsonPath('data.0.value', '375.00')->assertJsonPath('meta.totals.value', '375.00')->assertJsonPath('meta.columns.0.label', 'Store');
        $byCategory = $this->rowsBy('inventory_valuation', ['group_by' => 'category'], 'group');
        $this->assertSame(['60.00', '16.00'], [$byCategory['Drinks']['value'], $byCategory['Drinks']['share']]);
        $this->assertSame('315.00', $byCategory['Uncategorized']['value']);
        $this->assertSame(['Syrup', 'Juice'], array_column($this->report('inventory_valuation', ['group_by' => 'product'])->json('data'), 'group'));
        $this->report('inventory_valuation', ['category_id' => $drinks])->assertJsonPath('meta.totals.value', '60.00');

        // Movements of juice: opening 4 (1 Nov), sale −1 on 2 Nov.
        $movements = $this->report('stock_movements', ['date_from' => '2026-11-02', 'date_to' => '2026-11-07', 'product_id' => $juice->product_id])->assertOk();
        $movements->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.type', 'Sale')->assertJsonPath('data.0.quantity_out', '1.000')->assertJsonPath('data.0.balance_after', '3.000')
            ->assertJsonPath('data.0.value', '-20.00')
            ->assertJsonPath('meta.totals', ['quantity_in' => '0.000', 'quantity_out' => '1.000', 'value' => '-20.00', 'opening_quantity' => '4.000', 'closing_quantity' => '3.000']);
        $this->assertStringStartsWith('2026-11-02T10:00:00+06:00', $movements->json('data.0.date'));
        $all = $this->report('stock_movements', ['date_from' => '2026-11-01', 'date_to' => '2026-11-07', 'per_page' => 2, 'sort' => '-date'])->assertOk();
        $all->assertJsonPath('meta.pagination.total', 5)->assertJsonCount(2, 'data')->assertJsonPath('data.0.type', 'Sale')->assertJsonMissingPath('meta.totals.opening_quantity');
        $this->report('stock_movements', ['date_from' => '2026-11-01', 'date_to' => '2026-11-07', 'type' => 'sale'])->assertJsonPath('meta.pagination.total', 1);

        // Low stock: juice 3 ≤ 10 (reorder level), the ruled item has no stock row (0 ≤ 5). The SC1
        // calculator adds cover for the 1 sold in 30 days: target 10 + ceil(1/30 × 14) = 11 → buy 8.
        $low = $this->rowsBy('low_stock', [], 'sku');
        $this->assertCount(2, $low);
        $this->assertSame(['3.000', '10.000', '7.000', '8.000'], [$low[$juice->sku]['on_hand'], $low[$juice->sku]['reorder_point'], $low[$juice->sku]['shortfall'], $low[$juice->sku]['suggested_purchase']]);
        $this->assertSame(['0.000', '5.000', '5.000'], [$low[$ruled->sku]['on_hand'], $low[$ruled->sku]['reorder_point'], $low[$ruled->sku]['suggested_purchase']]);
        $this->assertSame('Ruled', $this->report('low_stock')->json('data.1.product'), 'largest shortfall first');

        // Expiry within 30 days: SOON (5 days left) and OLD (expired 2 days ago); LATER is outside.
        $expiry = $this->rowsBy('expiry', ['days' => 30], 'batch');
        $this->assertSame(['OLD', 'SOON'], array_keys($expiry));
        $this->assertSame([-2, 'Expired', '2.000', '60.00'], [$expiry['OLD']['days_left'], $expiry['OLD']['status'], $expiry['OLD']['quantity'], $expiry['OLD']['value']]);
        $this->assertSame([5, 'Expiring'], [$expiry['SOON']['days_left'], $expiry['SOON']['status']]);
        $this->report('expiry', ['days' => 30, 'include_expired' => 'false'])->assertJsonCount(1, 'data')->assertJsonPath('data.0.batch', 'SOON');
        $this->report('expiry', ['days' => 365])->assertJsonPath('meta.totals.quantity', '10.000')->assertJsonPath('meta.totals.expired_batches', 1);
    }

    public function test_customer_dues_are_aged_from_invoice_dates_with_credits_settling_the_oldest_first(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $soap = $this->sellable($org, 'Soap', '100.00');
        $store = $this->mainStoreId($org);
        $rina = $this->customer($org, 'Rina', creditLimit: '1000', openingBalance: '50');
        $paid = $this->customer($org, 'Paid up', creditLimit: '1000');
        $this->actingAsUser($admin);
        $this->travelTo($this->dhaka('2026-07-01 10:00'));
        $this->stockUp($store, $soap, '50');
        $sale = fn (string $quantity, string $cash, string $customer) => $this->checkout($this->cart($store, [[$soap, $quantity]], $cash === '0' ? [] : [['cash', $cash]], ['customer_id' => $customer]))->assertCreated();
        $sale('3', '0', $rina->id);                                   // 300 due, 129 days old
        $this->travelTo($this->dhaka('2026-10-01 10:00'));
        $sale('3', '100', $rina->id);                                 // 200 due, 37 days old
        $sale('1', '0', $paid->id);
        $this->travelTo($this->dhaka('2026-11-05 10:00'));
        $sale('1', '0', $rina->id);                                   // 100 due, 2 days old
        $this->travelTo($this->dhaka('2026-11-06 10:00'));
        $pay = fn (string $customer, string $amount) => $this->postJson('/api/v1/customer-payments', ['customer_id' => $customer, 'branch_id' => $branch->id, 'amount' => $amount, 'method' => 'bank_transfer'],
            ['Idempotency-Key' => (string) Str::uuid()])->assertCreated();
        $pay($rina->id, '400');
        $pay($paid->id, '100');
        $this->travelTo($this->dhaka('2026-11-07 10:00'));

        $response = $this->report('customer_dues')->assertOk();
        $response->assertJsonCount(1, 'data');
        $this->assertSame(['customer' => 'Rina', 'credit_limit' => '1000.00', 'outstanding' => '250.00', 'days_0_30' => '100.00', 'days_31_60' => '150.00', 'days_61_90' => '0.00',
            'days_over_90' => '0.00', 'last_payment_on' => '2026-11-06'],
            array_intersect_key($response->json('data.0'), array_flip(['customer', 'outstanding', 'days_0_30', 'days_31_60', 'days_61_90', 'days_over_90', 'credit_limit', 'last_payment_on'])));
        $response->assertJsonPath('meta.totals.outstanding', '250.00')->assertJsonPath('meta.includes_opening_balances', true);
        // The same balance as the customer's account (CustomerCredit).
        $this->getJson('/api/v1/sales/customer-balances?'.http_build_query(['customer_ids' => [$rina->id]]))->assertJsonPath("data.{$rina->id}", '250.00');
        // A branch filter leaves the (branch-less) opening balance out.
        $this->report('customer_dues', ['branch_id' => $branch->id])->assertJsonPath('data.0.outstanding', '200.00')->assertJsonPath('meta.includes_opening_balances', false);
    }

    public function test_supplier_dues_purchases_collections_and_expenses(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $soap = $this->sellable($org, 'Soap', '100.00', ['tax' => '10']);
        $store = $this->mainStoreId($org);
        $mills = $this->inTenant($org, fn () => Supplier::query()->create(['code' => 'SUP-1', 'name' => 'Mills', 'is_active' => true, 'opening_balance' => '100']));
        $this->actingAsUser($admin);
        $receive = fn (string $date, string $invoice, string $quantity) => $this->postJson('/api/v1/purchasing/receipts', [
            'supplier_id' => $mills->id, 'store_id' => $store, 'supplier_invoice_number' => $invoice, 'invoice_date' => $date,
            'lines' => [['variant_id' => $soap->id, 'quantity' => $quantity, 'unit_cost' => '10', 'tax_rate' => '0']],
        ], ['Idempotency-Key' => (string) Str::uuid()])->assertCreated()->json('data');

        $this->travelTo($this->dhaka('2026-08-20 10:00'));
        $receive('2026-08-20', 'M-1', '30');   // 300, 79 days old on 7 Nov
        $this->travelTo($this->dhaka('2026-11-01 10:00'));
        $second = $receive('2026-11-01', 'M-2', '20');   // 200, 6 days old
        $this->postJson("/api/v1/purchasing/receipts/{$second['id']}/returns", ['reason' => 'Damaged',
            'lines' => [['goods_receipt_line_id' => $second['lines'][0]['id'], 'quantity' => '5']]], ['Idempotency-Key' => (string) Str::uuid()])->assertCreated();
        DB::table('supplier_payments')->insert(['id' => (string) Str::uuid(), 'organization_id' => $org->id, 'number' => 'SPAY-1', 'supplier_id' => $mills->id,
            'branch_id' => null, 'currency' => 'BDT', 'amount' => '120', 'method' => 'bank_transfer', 'paid_on' => '2026-11-02', 'created_at' => now(), 'updated_at' => now()]);
        $this->checkout($this->cart($store, [[$soap, '2']], [['cash', '220']]))->assertCreated();
        $this->ledger($org, $branch->id, 'in', 'cash_on_delivery', '159', 'online_order', $this->dhaka('2026-11-02 12:00'));
        $this->ledger($org, $branch->id, 'out', 'cash', '30', 'online_order_refund', $this->dhaka('2026-11-02 13:00'));
        $this->ledger($org, $branch->id, 'in', 'cash', '500', 'cash_in', $this->dhaka('2026-11-02 13:00'));
        $this->expense($org, $branch->id, 'Utilities', '100', '2026-10-15');
        $this->expense($org, $branch->id, 'Utilities', '40', '2026-11-03');
        $this->expense($org, $branch->id, 'Rent', '999', '2026-11-03', voided: true);
        $this->expense($org, $branch->id, 'Landed cost', '25', '2026-11-04', onAccount: true);
        $this->travelTo($this->dhaka('2026-11-07 10:00'));

        // Payable: opening 100 (over 90) + 300 (61–90) + 200 (0–30) − return 50 − payment 120 → 430,
        // credits settle over 90 (100) then 61–90 (70).
        $dues = $this->report('supplier_dues')->assertOk();
        $this->assertSame(['outstanding' => '430.00', 'days_0_30' => '200.00', 'days_31_60' => '0.00', 'days_61_90' => '230.00', 'days_over_90' => '0.00', 'last_payment_on' => '2026-11-02'],
            array_intersect_key($dues->json('data.0'), array_flip(['outstanding', 'days_0_30', 'days_31_60', 'days_61_90', 'days_over_90', 'last_payment_on'])));
        $this->getJson("/api/v1/purchasing/suppliers/{$mills->id}/statement")->assertJsonPath('data.closing_balance', '430.00');

        $purchases = $this->report('purchases', ['date_from' => '2026-11-01', 'date_to' => '2026-11-07'])->assertOk();
        $this->assertSame(['receipts' => 1, 'quantity' => '20.000', 'goods' => '200.00', 'returned_quantity' => '5.000', 'returns' => '50.00', 'net_purchases' => '150.00'],
            array_intersect_key($purchases->json('data.0'), array_flip(['receipts', 'quantity', 'goods', 'returned_quantity', 'returns', 'net_purchases'])));
        $this->report('purchases', ['date_from' => '2026-08-01', 'date_to' => '2026-11-07', 'group_by' => 'product'])->assertJsonPath('data.0.group', 'Soap')
            ->assertJsonPath('data.0.goods', '500.00')->assertJsonPath('meta.columns.0.label', 'Product');

        // Collections: the POS sale 220 cash, COD 159; refund 30; cash-in is not a collection.
        $methods = $this->rowsBy('payment_collections', ['date_from' => '2026-11-01', 'date_to' => '2026-11-07'], 'group_key');
        $this->assertSame(['cash', 'cash_on_delivery'], array_keys($methods));
        $this->assertSame(['Cash', '220.00', '30.00', '190.00'], [$methods['cash']['group'], $methods['cash']['collected'], $methods['cash']['refunded'], $methods['cash']['net']]);
        $this->report('payment_collections', ['date_from' => '2026-11-01', 'date_to' => '2026-11-07'])
            ->assertJsonPath('meta.totals', ['entries' => 2, 'collected' => '379.00', 'refunded' => '30.00', 'net' => '349.00', 'share' => '100.00']);
        $sources = $this->rowsBy('payment_collections', ['date_from' => '2026-11-01', 'date_to' => '2026-11-07', 'group_by' => 'source'], 'group');
        $this->assertSame(['220.00', '159.00'], [$sources['POS sales']['collected'], $sources['Online orders']['collected']]);
        $this->report('payment_collections', ['date_from' => '2026-11-01', 'date_to' => '2026-11-07', 'channel' => 'online'])->assertJsonPath('meta.totals.net', '129.00');
        $this->report('payment_collections', ['date_from' => '2026-11-01', 'date_to' => '2026-11-07', 'group_by' => 'cashier'])
            ->assertJsonPath('data.0.group', $admin->name)->assertJsonPath('data.1.group', 'System');

        // Expenses: voided excluded, on account flagged.
        $expenses = $this->rowsBy('expenses', ['date_from' => '2026-11-01', 'date_to' => '2026-11-07'], 'group');
        $this->assertSame(['Utilities', 'Landed cost'], array_keys($expenses), 'largest amount first');
        $this->assertSame(['25.00', '25.00'], [$expenses['Landed cost']['amount'], $expenses['Landed cost']['on_account']]);
        $months = $this->report('expenses', ['date_from' => '2026-10-01', 'date_to' => '2026-11-07', 'group_by' => 'month', 'sort' => 'group'])->assertOk();
        $this->assertSame(['2026-10', '2026-11'], array_column($months->json('data'), 'group'));
        $months->assertJsonPath('data.0.group_label', 'Oct 2026')->assertJsonPath('meta.totals.amount', '165.00')->assertJsonPath('meta.totals.on_account', '25.00');
    }
}
