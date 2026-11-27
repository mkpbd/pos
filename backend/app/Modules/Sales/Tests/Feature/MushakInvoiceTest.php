<?php

namespace App\Modules\Sales\Tests\Feature;

use App\Modules\Customers\Application\Contracts\CustomerDirectory;
use App\Modules\Sales\Tests\Concerns\InteractsWithSales;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * VAT1: the sale document's Mushak-6.3 block — only with the seller's BIN, from the stored
 * line snapshots, buyer from the customer or walk-in, issued when sold (organization timezone).
 */
class MushakInvoiceTest extends TestCase
{
    use InteractsWithSales, InteractsWithTenancy, RefreshDatabase;

    public function test_only_with_the_sellers_bin_seller_and_walk_in_buyer(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant('Alpha');
        $juice = $this->sellable($org, 'Mango Juice', '15.00', ['tax' => '15']);
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $this->stockUp($store, $juice, '10');
        DB::table('branches')->where('id', $branch->id)->update(['address' => 'Shop 4, Gulshan']);

        $sale = $this->checkout($this->cart($store, [[$juice, '2']], [['cash', '34.50']]))->assertCreated()
            ->assertJsonPath('data.mushak', null)
            ->json('data');

        // Set later: the reprint is a 6.3; without a legal name / address the trading name and the branch address.
        $org->forceFill(['tax_number' => ' 000123456-0101 '])->save();
        $mushak = $this->getJson("/api/v1/sales/{$sale['id']}")->assertOk()->json('data.mushak');
        $this->assertSame('Mushak-6.3', $mushak['form']);
        $this->assertSame(['name' => 'Alpha', 'bin' => '000123456-0101', 'address' => 'Shop 4, Gulshan'], $mushak['seller']);
        $this->assertSame(['name' => 'Walk-in customer', 'bin' => null, 'address' => null], $mushak['buyer']);
        $this->assertSame($sale['number'], $mushak['invoice_number']);
        $this->assertStringEndsWith('+06:00', $mushak['issued_at']);
        $this->assertTrue(CarbonImmutable::parse($mushak['issued_at'])->equalTo(CarbonImmutable::parse($sale['sold_at'])));
        $this->assertFalse($mushak['prices_include_tax']);
        $this->assertFalse($mushak['cancelled']);
        $line = $sale['lines'][0];
        $this->assertSame([[
            'description' => $line['variant_name'] === null ? 'Mango Juice' : "Mango Juice — {$line['variant_name']}",
            'unit' => $line['unit_code'],
            'quantity' => '2.000',
            'unit_price' => '15.00',
            'value' => '30.00',
            'sd_rate' => '0.00',
            'sd_amount' => '0.00',
            'vat_rate' => '15.00',
            'vat_amount' => '4.50',
            'total' => '34.50',
        ]], $mushak['lines']);
        $this->assertSame(['value' => '30.00', 'sd' => '0.00', 'vat' => '4.50', 'total' => '34.50'], $mushak['totals']);

        // A cancelled sale keeps the block, marked.
        $this->postJson("/api/v1/sales/{$sale['id']}/cancel", ['reason' => 'Mistake'])->assertOk();
        $this->getJson("/api/v1/sales/{$sale['id']}")->assertOk()->assertJsonPath('data.mushak.cancelled', true);
    }

    public function test_customer_buyer_and_a_discounted_line(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant('Alpha');
        $org->forceFill(['tax_number' => '000123456-0101', 'legal_name' => 'Alpha Traders Ltd.', 'address' => 'House 1, Dhaka'])->save();
        $rice = $this->sellable($org, 'Rice', '33.33', ['tax' => '15']);
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $this->stockUp($store, $rice, '10');
        $rahim = $this->customer($org, 'Rahim Traders');
        $blank = $this->customer($org, 'Karim');
        DB::table('customers')->where('id', $rahim->id)->update(['tax_number' => '111222333-0101', 'address' => 'Motijheel, Dhaka']);
        DB::table('customers')->where('id', $blank->id)->update(['tax_number' => '  ']);

        $cart = $this->cart($store, [[$rice, '3', ['discount' => ['type' => 'percent', 'value' => '10']]]], [['cash', '100']], [
            'invoice_discount' => ['type' => 'amount', 'value' => '5.00'], 'customer_id' => $rahim->id,
        ]);
        $mushak = $this->checkout($cart)->assertCreated()->json('data.mushak');
        // The legal name and the organization's address win over the trading name and the branch.
        $this->assertSame(['name' => 'Alpha Traders Ltd.', 'bin' => '000123456-0101', 'address' => 'House 1, Dhaka'], $mushak['seller']);
        $this->assertSame(['name' => 'Rahim Traders', 'bin' => '111222333-0101', 'address' => 'Motijheel, Dhaka'], $mushak['buyer']);
        // Unit price before discounts; value after the item and invoice discounts (99.99 − 10.00 − 5.00).
        $this->assertSame(['33.33', '84.99', '15.00', '12.75', '97.74'], [
            $mushak['lines'][0]['unit_price'], $mushak['lines'][0]['value'], $mushak['lines'][0]['vat_rate'], $mushak['lines'][0]['vat_amount'], $mushak['lines'][0]['total'],
        ]);
        $this->assertSame(['value' => '84.99', 'sd' => '0.00', 'vat' => '12.75', 'total' => '97.74'], $mushak['totals']);

        // A customer without a BIN (blank) prints none.
        $buyer = $this->checkout($this->cart($store, [[$rice, '1']], [['cash', '38.33']], ['customer_id' => $blank->id]))->assertCreated()->json('data.mushak.buyer');
        $this->assertSame(['name' => 'Karim', 'bin' => null, 'address' => null], $buyer);
    }

    public function test_tax_inclusive_prices_print_tax_exclusive_figures(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant('Alpha');
        $this->inTenant($org, fn () => $org->update(['tax_mode' => 'inclusive']));
        $org->forceFill(['tax_number' => '000123456-0101'])->save();
        $soap = $this->sellable($org, 'Soap', '115.00', ['tax' => '15']);
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $this->stockUp($store, $soap, '5');

        $mushak = $this->checkout($this->cart($store, [[$soap, '2']], [['card', '230']]))->assertCreated()->json('data.mushak');
        $this->assertTrue($mushak['prices_include_tax']);
        $this->assertSame(['100.00', '200.00', '15.00', '30.00', '230.00'], [
            $mushak['lines'][0]['unit_price'], $mushak['lines'][0]['value'], $mushak['lines'][0]['vat_rate'], $mushak['lines'][0]['vat_amount'], $mushak['lines'][0]['total'],
        ]);
        $this->assertSame(['value' => '200.00', 'sd' => '0.00', 'vat' => '30.00', 'total' => '230.00'], $mushak['totals']);
    }

    public function test_isolation(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant('Alpha');
        ['admin' => $otherAdmin, 'organization' => $other] = $this->provisionTenant('Beta');
        $other->forceFill(['tax_number' => '999999999-0202'])->save();
        $juice = $this->sellable($org, 'Mango Juice', '15.00');
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $this->stockUp($store, $juice, '10');
        $rahim = $this->customer($org, 'Rahim');
        DB::table('customers')->where('id', $rahim->id)->update(['tax_number' => '111222333-0101']);

        // Another organization's BIN never makes this shop's sale a 6.3.
        $id = $this->checkout($this->cart($store, [[$juice, '1']], [['cash', '15']], ['customer_id' => $rahim->id]))->assertCreated()
            ->assertJsonPath('data.mushak', null)->json('data.id');

        $this->actingAsUser($otherAdmin);
        $this->getJson("/api/v1/sales/{$id}")->assertNotFound();
        $directory = app(CustomerDirectory::class);
        $this->assertNull($directory->invoiceDetails($other->id, $rahim->id));
        $this->assertSame('111222333-0101', $directory->invoiceDetails($org->id, $rahim->id)['tax_number']);
    }
}
