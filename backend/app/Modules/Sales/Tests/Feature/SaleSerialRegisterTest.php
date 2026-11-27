<?php

namespace App\Modules\Sales\Tests\Feature;

use App\Modules\Sales\Tests\Concerns\InteractsWithSales;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * ST2d: checkout, sale returns and cancellations move serials through the Inventory serial register.
 */
class SaleSerialRegisterTest extends TestCase
{
    use InteractsWithSales, InteractsWithTenancy, RefreshDatabase;

    public function test_a_serial_in_stock_sells_once_and_only_at_its_store(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $north = $this->createBranch($org, 'NORTH')->stores()->firstOrFail()->id;
        $phone = $this->sellable($org, 'Phone', '20000.00', ['serials' => true]);
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $this->stockUp($store, $phone, '2', '15000.00', serials: ['IMEI-1', 'IMEI-2']);
        $this->stockUp($north, $phone, '1', '15000.00', serials: ['IMEI-N']);

        // In stock at another store: refused, nothing sold.
        $this->checkout($this->cart($store, [[$phone, '1', ['serials' => ['IMEI-N']]]], [['card', '20000']]))
            ->assertStatus(422)->assertJsonPath('error.code', 'SERIAL_NOT_IN_STOCK')->assertJsonPath('error.details.serials', ['IMEI-N']);
        $this->assertSame(['in_stock', $north], $this->serialRow('IMEI-N'));
        $this->assertSame('2.000', $this->stockRow($phone->id, $store)['quantity']);

        $sale = $this->checkout($this->cart($store, [[$phone, '1', ['serials' => ['imei-1']]]], [['card', '20000']]))->assertCreated()->json('data');
        $this->assertSame(['sold', null], $this->serialRow('IMEI-1'));
        $this->assertSame(['adjusted_in', 'sold'], $this->serialEvents('IMEI-1'));
        $this->assertSame($sale['number'], DB::table('serial_number_events')->where('type', 'sold')->value('reference_number'));

        // Sold twice: refused by the register.
        $this->checkout($this->cart($store, [[$phone, '1', ['serials' => ['IMEI-1']]]], [['card', '20000']]))
            ->assertStatus(422)->assertJsonPath('error.code', 'SERIAL_NOT_IN_STOCK')->assertJsonPath('error.details.serials', ['IMEI-1']);
    }

    public function test_an_unknown_serial_sells_only_from_stock_older_than_the_register(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $phone = $this->sellable($org, 'Phone', '20000.00', ['serials' => true]);
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $this->stockUp($store, $phone, '1', '15000.00'); // before the register: no serials known
        $this->stockUp($store, $phone, '1', '15000.00', serials: ['REG-1']);

        // One unregistered unit: an unknown serial sells and is registered as sold.
        $this->checkout($this->cart($store, [[$phone, '1', ['serials' => ['OLD-1']]]], [['card', '20000']]))->assertCreated();
        $this->assertSame(['sold', null], $this->serialRow('OLD-1'));

        // Only registered units are left: another unknown serial is refused.
        $this->checkout($this->cart($store, [[$phone, '1', ['serials' => ['OLD-2']]]], [['card', '20000']]))
            ->assertStatus(422)->assertJsonPath('error.code', 'SERIAL_NOT_IN_STOCK')->assertJsonPath('error.details.serials', ['OLD-2']);
        $this->assertNull($this->serialRow('OLD-2'));
        $this->checkout($this->cart($store, [[$phone, '1', ['serials' => ['REG-1']]]], [['card', '20000']]))->assertCreated();
    }

    public function test_a_restocked_return_puts_the_serial_back_in_stock_to_sell_again(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $phone = $this->sellable($org, 'Phone', '20000.00', ['serials' => true]);
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $this->stockUp($store, $phone, '1', '15000.00', serials: ['IMEI-1']);
        $sale = $this->checkout($this->cart($store, [[$phone, '1', ['serials' => ['IMEI-1']]]], [['card', '20000']]))->assertCreated()->json('data');

        $this->postJson('/api/v1/returns', [
            'sale_id' => $sale['id'],
            'lines' => [['sale_line_id' => $sale['lines'][0]['id'], 'quantity' => '1', 'restock' => true, 'serials' => ['IMEI-1']]],
            'refunds' => [['method' => 'card', 'amount' => '20000']],
        ], ['Idempotency-Key' => (string) Str::uuid()])->assertCreated()->assertJsonPath('data.status', 'completed');

        $this->assertSame(['in_stock', $store], $this->serialRow('IMEI-1'));
        $this->assertSame(['returned'], $this->serialEvents('IMEI-1', 'sale_return'));
        $this->assertSame('1.000', $this->stockRow($phone->id, $store)['quantity']);
        $this->checkout($this->cart($store, [[$phone, '1', ['serials' => ['IMEI-1']]]], [['card', '20000']]))->assertCreated();
        $this->assertSame(['sold', null], $this->serialRow('IMEI-1'));
    }

    public function test_cancelling_a_sale_puts_its_serials_back_in_stock(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $phone = $this->sellable($org, 'Phone', '20000.00', ['serials' => true]);
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $this->stockUp($store, $phone, '2', '15000.00', serials: ['IMEI-1', 'IMEI-2']);
        $sale = $this->checkout($this->cart($store, [[$phone, '2', ['serials' => ['IMEI-1', 'IMEI-2']]]], [['card', '40000']]))->assertCreated()->json('data');

        $this->postJson("/api/v1/sales/{$sale['id']}/cancel", ['reason' => 'Wrong model'])->assertOk();

        foreach (['IMEI-1', 'IMEI-2'] as $serial) {
            $this->assertSame(['in_stock', $store], $this->serialRow($serial));
            $this->assertSame(['returned'], $this->serialEvents($serial, 'sale_cancellation'));
        }
        $this->checkout($this->cart($store, [[$phone, '1', ['serials' => ['IMEI-2']]]], [['card', '20000']]))->assertCreated();
    }
}
