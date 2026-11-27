<?php

namespace App\Modules\Purchasing\Tests\Feature;

use App\Modules\Purchasing\Tests\Concerns\BuildsProcurement;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * ST2d: goods receipts and purchase returns move serials through the Inventory serial register.
 */
class PurchaseSerialsTest extends TestCase
{
    use BuildsProcurement, RefreshDatabase;

    /**
     * @param  list<array<string, mixed>>  $lines
     */
    private function receive(string $supplierId, string $store, array $lines): TestResponse
    {
        return $this->postJson('/api/v1/purchasing/receipts', [
            'supplier_id' => $supplierId, 'store_id' => $store, 'invoice_date' => now()->toDateString(), 'lines' => $lines,
        ]);
    }

    /**
     * @return ?array{0: string, 1: ?string}
     */
    private function serialRow(string $serial): ?array
    {
        $row = DB::table('serial_numbers')->whereRaw('lower(serial) = ?', [mb_strtolower($serial)])->first(['status', 'store_id']);

        return $row === null ? null : [$row->status, $row->store_id];
    }

    public function test_a_receipt_registers_one_serial_per_unit_including_free_units(): void
    {
        ['admin' => $admin, 'org' => $org, 'store' => $store, 'variant' => $juice] = $this->procurementWorld();
        $phone = $this->stockedVariant($org, 'Phone', ['track_serials' => true]);
        $supplier = $this->supplier($org, 'Samsung BD');
        $this->actingAsUser($admin);

        // Count = quantity + bonus; serials only on serial-tracked lines.
        $this->receive($supplier->id, $store, [['variant_id' => $phone->id, 'quantity' => '2', 'bonus_quantity' => '1', 'unit_cost' => '15000', 'serials' => ['S-1', 'S-2']]])
            ->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['lines.0.serials']]]);
        $this->receive($supplier->id, $store, [['variant_id' => $phone->id, 'quantity' => '2', 'unit_cost' => '15000', 'serials' => ['S-1', 's-1']]])
            ->assertStatus(422)->assertJsonPath('error.details', ['lines.0.serials' => ['Serial s-1 is entered twice.']]);
        $this->receive($supplier->id, $store, [['variant_id' => $juice->id, 'quantity' => '1', 'unit_cost' => '10', 'serials' => ['J-1']]])
            ->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['lines.0.serials']]]);

        $receipt = $this->receive($supplier->id, $store, [
            ['variant_id' => $phone->id, 'quantity' => '2', 'bonus_quantity' => '1', 'unit_cost' => '15000', 'serials' => [' S-1 ', 'S-2', 'S-3']],
            ['variant_id' => $juice->id, 'quantity' => '5', 'unit_cost' => '10'],
        ])->assertCreated()
            ->assertJsonPath('data.lines.0.serials', ['S-1', 'S-2', 'S-3'])
            ->assertJsonPath('data.lines.0.variant.track_serials', true)
            ->assertJsonPath('data.lines.1.serials', null)
            ->json('data');

        $this->assertSame('3.000', $this->stockRow($phone->id, $store)['quantity']);
        foreach (['S-1', 'S-2', 'S-3'] as $serial) {
            $this->assertSame(['in_stock', $store], $this->serialRow($serial));
        }
        $this->assertSame(3, DB::table('serial_number_events')->where('type', 'received')->where('reference_type', 'goods_receipt')->where('reference_number', $receipt['number'])->count());
        $this->getJson("/api/v1/purchasing/receipts/{$receipt['id']}")->assertOk()->assertJsonPath('data.lines.0.serials', ['S-1', 'S-2', 'S-3']);

        // A serial already in stock is refused and nothing is posted.
        $this->receive($supplier->id, $store, [['variant_id' => $phone->id, 'quantity' => '1', 'unit_cost' => '15000', 'serials' => ['s-2']]])
            ->assertStatus(422)->assertJsonPath('error.code', 'SERIAL_IN_STOCK')->assertJsonPath('error.details.serials', ['S-2']);
        $this->assertSame('3.000', $this->stockRow($phone->id, $store)['quantity']);
        $this->assertSame(1, DB::table('goods_receipts')->count());
    }

    public function test_a_receipt_return_sends_back_only_serials_of_that_receipt_still_in_stock(): void
    {
        ['admin' => $admin, 'org' => $org, 'store' => $store] = $this->procurementWorld();
        $phone = $this->stockedVariant($org, 'Phone', ['track_serials' => true]);
        $supplier = $this->supplier($org, 'Samsung BD');
        $this->actingAsUser($admin);
        $first = $this->receive($supplier->id, $store, [['variant_id' => $phone->id, 'quantity' => '2', 'unit_cost' => '15000', 'serials' => ['S-1', 'S-2']]])->assertCreated()->json('data');
        $this->receive($supplier->id, $store, [['variant_id' => $phone->id, 'quantity' => '1', 'unit_cost' => '15000', 'serials' => ['S-9']]])->assertCreated();
        $return = fn (array $serials, string $quantity = '1') => $this->postJson("/api/v1/purchasing/receipts/{$first['id']}/returns", [
            'reason' => 'Faulty', 'lines' => [['goods_receipt_line_id' => $first['lines'][0]['id'], 'quantity' => $quantity, 'serials' => $serials]],
        ]);

        $return([])->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['lines.0.serials']]]);
        $return(['S-9'])->assertStatus(422)->assertJsonPath('error.details', ['lines.0.serials' => ['Not received on this line: S-9.']]);

        $posted = $return(['s-1'])->assertCreated()->assertJsonPath('data.lines.0.serials', ['S-1'])->assertJsonPath('data.lines.0.variant.track_serials', true)->json('data');
        // Order lines say so too, so a receipt loaded from an order asks for serials.
        $order = $this->draftOrder($supplier->id, $store, [['variant_id' => $phone->id, 'quantity' => '1', 'unit_cost' => '15000']]);
        $this->assertTrue($order['lines'][0]['variant']['track_serials']);
        $this->assertSame(['returned_to_supplier', null], $this->serialRow('S-1'));
        $this->assertSame($posted['number'], DB::table('serial_number_events')->where('type', 'returned_to_supplier')->value('reference_number'));
        $this->assertSame('2.000', $this->stockRow($phone->id, $store)['quantity']);

        // Already returned: the register refuses it (the line still has one returnable unit).
        $return(['S-1'])->assertStatus(422)->assertJsonPath('error.code', 'SERIAL_NOT_IN_STOCK')->assertJsonPath('error.details.serials', ['S-1']);
        $this->assertSame('2.000', $this->stockRow($phone->id, $store)['quantity']);
    }

    public function test_a_direct_return_sends_back_serials_in_stock(): void
    {
        ['admin' => $admin, 'org' => $org, 'store' => $store] = $this->procurementWorld();
        $phone = $this->stockedVariant($org, 'Phone', ['track_serials' => true]);
        $supplier = $this->supplier($org, 'Samsung BD');
        $this->actingAsUser($admin);
        $this->receive($supplier->id, $store, [['variant_id' => $phone->id, 'quantity' => '2', 'unit_cost' => '15000', 'serials' => ['S-1', 'S-2']]])->assertCreated();
        $direct = fn (array $serials) => $this->postJson('/api/v1/purchasing/returns', [
            'supplier_id' => $supplier->id, 'store_id' => $store, 'reason' => 'Faulty', 'lines' => [['variant_id' => $phone->id, 'quantity' => '1', 'serials' => $serials]],
        ]);

        $direct(['S-1', 'S-2'])->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['lines.0.serials']]]);
        // Every unit is registered, so an unknown serial is not in stock.
        $direct(['S-7'])->assertStatus(422)->assertJsonPath('error.code', 'SERIAL_NOT_IN_STOCK');

        $direct(['S-2'])->assertCreated()->assertJsonPath('data.lines.0.serials', ['S-2']);
        $this->assertSame(['returned_to_supplier', null], $this->serialRow('S-2'));
        $this->assertSame(['in_stock', $store], $this->serialRow('S-1'));
        $this->assertSame('1.000', $this->stockRow($phone->id, $store)['quantity']);
    }
}
