<?php

namespace App\Modules\Orders\Tests\Feature;

use App\Modules\CustomerAccounts\Tests\Concerns\ActsAsShopper;
use App\Modules\Customers\Infrastructure\Models\Customer;
use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Orders\Tests\Concerns\BuildsCheckout;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * VAT1: the printed web order invoice's Mushak-6.3 block — only with the seller's BIN, buyer from
 * the order's contact and shipping address (with the linked customer's BIN), issued when placed,
 * product lines from their snapshots, kept (marked) on cancelled orders.
 */
class MushakOrderInvoiceTest extends TestCase
{
    use ActsAsShopper, BuildsCheckout, BuildsOnlineCatalog, InteractsWithTenancy, RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Notification::fake();
        $this->buildShop();
        $this->staff();
    }

    /**
     * Places a guest COD order and returns its id.
     *
     * @param  array<string, string|int>  $items  sku => quantity
     */
    private function order(array $items): string
    {
        $this->clearBrowser();
        foreach ($items as $sku => $quantity) {
            $this->addToCart($sku, $quantity);
        }
        $total = $this->previewCheckout(['address' => ['district_id' => self::DHAKA], 'shipping_method_id' => $this->methods['inside'], 'payment_method' => 'cod'])->json('data.total');
        $number = $this->placeOrder($this->checkoutBody($total))->assertCreated()->json('data.order.number');
        $this->staff();

        return Order::query()->withoutGlobalScopes()->where('number', $number)->value('id');
    }

    private function staff(): void
    {
        $this->clearBrowser();
        $this->actingAsUser($this->tenant['admin']);
    }

    /**
     * @return array<string, mixed>
     */
    private function invoice(string $id): array
    {
        return $this->getJson("/api/v1/web-orders/print?ids[]={$id}&kind=invoice")->assertOk()->json('data.orders.0');
    }

    public function test_the_invoice_is_a_mushak_6_3_only_with_the_sellers_bin(): void
    {
        $id = $this->order(['JUICE' => 2, 'RICE' => 1]);
        $this->assertNull($this->invoice($id)['mushak']);

        DB::table('organizations')->where('id', $this->tenant['organization']->id)->update([
            'legal_name' => 'Berry Kids Ltd.', 'tax_number' => ' BIN-123456 ', 'address' => 'House 1, Dhaka',
        ]);
        $invoice = $this->invoice($id);
        $mushak = $invoice['mushak'];
        $address = $invoice['shipping_address'];
        $this->assertSame('Mushak-6.3', $mushak['form']);
        $this->assertSame(['name' => 'Berry Kids Ltd.', 'bin' => 'BIN-123456', 'address' => 'House 1, Dhaka'], $mushak['seller']);
        $this->assertSame([
            'name' => 'Rina Akter',
            'bin' => null,
            'address' => "House 1, Road 2, Dhanmondi, {$address['district']}, {$address['division']} 1205",
        ], $mushak['buyer']);
        $this->assertSame($invoice['number'], $mushak['invoice_number']);
        // Issued when placed — the date the invoice prints — in the organization's timezone.
        $this->assertStringEndsWith('+06:00', $mushak['issued_at']);
        $this->assertTrue(CarbonImmutable::parse($mushak['issued_at'])->equalTo(CarbonImmutable::parse($invoice['placed_at'])));
        $this->assertFalse($mushak['prices_include_tax']);
        $this->assertFalse($mushak['cancelled']);
        $this->assertSame([
            'description' => 'Juice', 'unit' => null, 'quantity' => '2.000', 'unit_price' => '120.00', 'value' => '240.00',
            'sd_rate' => '0.00', 'sd_amount' => '0.00', 'vat_rate' => '15.00', 'vat_amount' => '36.00', 'total' => '276.00',
        ], $mushak['lines'][0]);
        $this->assertSame(['Rice', '60.50', '0.00', '0.00', '60.50'], [
            $mushak['lines'][1]['description'], $mushak['lines'][1]['value'], $mushak['lines'][1]['vat_rate'], $mushak['lines'][1]['vat_amount'], $mushak['lines'][1]['total'],
        ]);
        // Product lines only: the delivery charge stays out of the 6.3 totals.
        $this->assertSame(['value' => '300.50', 'sd' => '0.00', 'vat' => '36.00', 'total' => '336.50'], $mushak['totals']);
        $this->assertNotSame('0.00', $invoice['shipping_total']);

        // The packing slip has no prices, so no 6.3.
        $slip = $this->getJson("/api/v1/web-orders/print?ids[]={$id}&kind=packing_slip")->assertOk()->json('data.orders.0');
        $this->assertArrayNotHasKey('mushak', $slip);

        // A cancelled order keeps its 6.3, marked.
        $this->postJson("/api/v1/web-orders/{$id}/cancel", ['reason' => 'Customer changed mind'], ['Idempotency-Key' => (string) Str::uuid()])->assertOk();
        $this->assertTrue($this->invoice($id)['mushak']['cancelled']);
    }

    public function test_buyer_bin_from_the_linked_customer_and_tax_inclusive_prices(): void
    {
        $org = $this->tenant['organization'];
        DB::table('organizations')->where('id', $org->id)->update(['tax_number' => 'BIN-123456', 'tax_mode' => 'inclusive']);
        $id = $this->order(['JUICE' => 2]);
        $customer = $this->inTenant($org, fn () => Customer::query()->create(['code' => 'C-1', 'name' => 'Rahim Traders', 'tax_number' => '111222333-0101']));
        DB::table('orders')->where('id', $id)->update(['customer_id' => $customer->id]);

        $mushak = $this->invoice($id)['mushak'];
        // The contact stays the buyer's name; the BIN comes from the customer.
        $this->assertSame(['Rina Akter', '111222333-0101'], [$mushak['buyer']['name'], $mushak['buyer']['bin']]);
        $this->assertTrue($mushak['prices_include_tax']);
        // 120.00 with 15% inside: 104.35 before VAT; the stored net, tax and total of the line.
        $this->assertSame(['104.35', '208.70', '31.30', '240.00'], [
            $mushak['lines'][0]['unit_price'], $mushak['lines'][0]['value'], $mushak['lines'][0]['vat_amount'], $mushak['lines'][0]['total'],
        ]);
        $this->assertSame(['value' => '208.70', 'sd' => '0.00', 'vat' => '31.30', 'total' => '240.00'], $mushak['totals']);
    }

    public function test_isolation(): void
    {
        $id = $this->order(['JUICE' => 1]);
        $other = $this->openStore('Other Shop', 'other.example.test');
        DB::table('organizations')->where('id', $other['organization']->id)->update(['tax_number' => 'BIN-999']);
        $this->getJson("/api/v1/web-orders/print?ids[]={$id}&kind=invoice")->assertNotFound();

        // The other shop's BIN never makes this shop's invoice a 6.3.
        $this->staff();
        $this->assertNull($this->invoice($id)['mushak']);
    }
}
