<?php

namespace App\Modules\Purchasing\Tests\Feature;

use App\Modules\Inventory\Infrastructure\Models\StockLevel;
use App\Modules\Organizations\Infrastructure\Models\Organization;
use App\Modules\Purchasing\Tests\Concerns\BuildsProcurement;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * ST2a: line discount % and bonus (free) quantity on purchase orders, goods receipts and the
 * returns against them.
 */
class PurchaseDiscountBonusTest extends TestCase
{
    use BuildsProcurement, RefreshDatabase;

    /**
     * @param  list<array<string, mixed>>  $lines
     * @param  array<string, mixed>  $extra
     */
    private function receive(string $supplierId, string $store, array $lines, array $extra = [], int $status = 201): array
    {
        return $this->postJson('/api/v1/purchasing/receipts', $extra + [
            'supplier_id' => $supplierId, 'store_id' => $store, 'invoice_date' => now()->toDateString(), 'lines' => $lines,
        ])->assertStatus($status)->json($status === 201 ? 'data' : 'error') ?? [];
    }

    private function averageCost(Organization $org, string $store, string $variantId): string
    {
        return $this->inTenant($org, fn () => StockLevel::query()->where('store_id', $store)->where('variant_id', $variantId)->firstOrFail()->average_cost);
    }

    private function balance(string $supplierId): string
    {
        return $this->getJson("/api/v1/purchasing/supplier-balances?supplier_ids[]={$supplierId}")->assertOk()->json("data.{$supplierId}");
    }

    public function test_ten_plus_one_bonus_enters_eleven_units_at_the_effective_cost(): void
    {
        ['admin' => $admin, 'org' => $org, 'store' => $store, 'variant' => $juice] = $this->procurementWorld();
        $pran = $this->supplier($org, 'Pran');
        $this->actingAsUser($admin);
        $this->receive($pran->id, $store, [['variant_id' => $juice->id, 'quantity' => '10', 'unit_cost' => '20']]);

        $receipt = $this->receive($pran->id, $store, [['variant_id' => $juice->id, 'quantity' => '10', 'bonus_quantity' => '1', 'unit_cost' => '20']]);

        $this->assertSame('200.00', $receipt['total']);
        $this->assertSame('200.00', $receipt['payable_total']);
        $this->assertSame('1.000', $receipt['lines'][0]['bonus_quantity']);
        $this->assertSame('0.0000', $receipt['lines'][0]['discount_percent']);
        $this->assertSame('18.1818', $receipt['lines'][0]['effective_unit_cost']); // 200 ÷ 11
        $this->assertSame('18.1818', $receipt['lines'][0]['landed_unit_cost']);
        $this->assertSame('21.000', $this->stockRow($juice->id, $store)['quantity']);
        // (10 × 20 + 11 × 18.1818) ÷ 21
        $this->assertSame('19.0476', $this->averageCost($org, $store, $juice->id));
        $this->assertSame('400.00', $this->balance($pran->id));
    }

    public function test_discount_is_taken_before_tax_and_the_catalog_keeps_the_list_cost(): void
    {
        ['admin' => $admin, 'org' => $org, 'store' => $store, 'variant' => $juice] = $this->procurementWorld();
        $pran = $this->supplier($org, 'Pran');
        $this->actingAsUser($admin);
        $this->catalogRow($pran->id, $juice->id, ['unit_cost' => '18']);

        $receipt = $this->receive($pran->id, $store, [['variant_id' => $juice->id, 'quantity' => '10', 'unit_cost' => '18.50', 'tax_rate' => '15', 'discount_percent' => '5']]);

        // 185.00 − 5 % = 175.75; tax 15 % = 26.36
        $this->assertSame(['175.75', '26.36', '202.11', '202.11'], [$receipt['subtotal'], $receipt['tax_total'], $receipt['total'], $receipt['payable_total']]);
        $this->assertSame('5.0000', $receipt['lines'][0]['discount_percent']);
        $this->assertSame('17.5750', $receipt['lines'][0]['effective_unit_cost']);
        $this->assertSame('17.5750', $this->averageCost($org, $store, $juice->id));
        $this->assertSame('202.11', $this->balance($pran->id));
        $this->getJson("/api/v1/purchasing/supplier-products?supplier_id={$pran->id}")->assertJsonPath('data.0.last_purchase_cost', '18.5000');
    }

    public function test_landed_cost_is_spread_over_the_bonus_units_too(): void
    {
        ['admin' => $admin, 'org' => $org, 'store' => $store, 'variant' => $juice] = $this->procurementWorld();
        $pran = $this->supplier($org, 'Pran');
        $this->actingAsUser($admin);

        $receipt = $this->receive($pran->id, $store, [['variant_id' => $juice->id, 'quantity' => '10', 'bonus_quantity' => '1', 'unit_cost' => '20']], [
            'charges' => [['type' => 'freight', 'amount' => '22', 'allocation' => 'quantity']],
        ]);

        // 18.1818 + 22 ÷ 11
        $this->assertSame('20.1818', $receipt['lines'][0]['landed_unit_cost']);
        $this->assertSame('222.00', $receipt['payable_total']);
        $this->assertSame('20.1818', $this->averageCost($org, $store, $juice->id));
        $this->assertSame('11.000', $this->stockRow($juice->id, $store)['quantity']);
    }

    public function test_without_discount_or_bonus_the_effective_cost_is_exactly_the_unit_cost(): void
    {
        ['admin' => $admin, 'org' => $org, 'store' => $store, 'variant' => $juice] = $this->procurementWorld();
        $pran = $this->supplier($org, 'Pran');
        $this->actingAsUser($admin);

        // The line rounds to 1.01, but the stock still enters at 0.3350 (not 1.01 ÷ 3).
        $receipt = $this->receive($pran->id, $store, [['variant_id' => $juice->id, 'quantity' => '3', 'unit_cost' => '0.335']]);

        $this->assertSame('1.01', $receipt['lines'][0]['line_subtotal']);
        $this->assertSame(['0.3350', '0.3350'], [$receipt['lines'][0]['effective_unit_cost'], $receipt['lines'][0]['landed_unit_cost']]);
        $this->assertSame('0.3350', $this->averageCost($org, $store, $juice->id));
    }

    public function test_a_later_landed_cost_voucher_counts_the_bonus_units_as_received(): void
    {
        ['admin' => $admin, 'org' => $org, 'branch' => $branch, 'store' => $store, 'variant' => $juice] = $this->procurementWorld();
        $pran = $this->supplier($org, 'Pran');
        $forwarder = $this->supplier($org, 'Sea Freight Co');
        $this->actingAsUser($admin);
        $receipt = $this->receive($pran->id, $store, [['variant_id' => $juice->id, 'quantity' => '10', 'bonus_quantity' => '1', 'unit_cost' => '20']]);

        $this->postJson('/api/v1/purchasing/landed-cost-vouchers/preview', [
            'branch_id' => $branch->id, 'voucher_date' => now()->toDateString(), 'charge_supplier_id' => $forwarder->id,
            'charges' => [['type' => 'freight', 'amount' => '11', 'allocation' => 'quantity']], 'receipt_ids' => [$receipt['id']],
        ])->assertOk()
            ->assertJsonPath('data.allocations.0.received_quantity', '11.000')
            ->assertJsonPath('data.allocations.0.on_hand_quantity', '11.000')
            ->assertJsonPath('data.allocations.0.consumed_amount', '0.00')
            ->assertJsonPath('data.allocations.0.new_landed_unit_cost', '19.1818') // 18.1818 + 11 ÷ 11
            ->assertJsonPath('data.allocations.0.average_cost_after', '19.1818');
    }

    public function test_order_lines_carry_discount_and_bonus_and_bonus_never_consumes_the_open_quantity(): void
    {
        ['admin' => $admin, 'org' => $org, 'store' => $store, 'variant' => $juice] = $this->procurementWorld();
        $pran = $this->supplier($org, 'Pran');
        $this->actingAsUser($admin);
        $order = $this->draftOrder($pran->id, $store, [['variant_id' => $juice->id, 'quantity' => '10', 'unit_cost' => '20', 'discount_percent' => '10', 'bonus_quantity' => '2']]);
        $this->assertSame(['180.00', '10.0000', '2.000'], [$order['total'], $order['lines'][0]['discount_percent'], $order['lines'][0]['bonus_quantity']]);
        $this->postJson("/api/v1/purchasing/orders/{$order['id']}/place")->assertOk();
        $line = ['variant_id' => $juice->id, 'purchase_order_line_id' => $order['lines'][0]['id'], 'unit_cost' => '20'];

        // Discount and bonus default to the order line's values.
        $first = $this->receive($pran->id, $store, [$line + ['quantity' => '4']], ['purchase_order_id' => $order['id']]);
        $this->assertSame(['72.00', '10.0000', '2.000', '12.0000'], [$first['total'], $first['lines'][0]['discount_percent'], $first['lines'][0]['bonus_quantity'], $first['lines'][0]['effective_unit_cost']]);
        $this->assertSame('6.000', $this->stockRow($juice->id, $store)['quantity']);
        $this->getJson("/api/v1/purchasing/orders/{$order['id']}")
            ->assertJsonPath('data.status', 'partially_received')
            ->assertJsonPath('data.lines.0.received_quantity', '4.000');

        // 6 still open: the 2 free units did not count against the order.
        $this->receive($pran->id, $store, [$line + ['quantity' => '7', 'bonus_quantity' => '0']], ['purchase_order_id' => $order['id']], 422);
        // A later part-delivery does not default to the free units again (they came with the first one).
        $second = $this->receive($pran->id, $store, [$line + ['quantity' => '6']], ['purchase_order_id' => $order['id']]);
        $this->assertSame('0.000', $second['lines'][0]['bonus_quantity']);
        $this->getJson("/api/v1/purchasing/orders/{$order['id']}")->assertJsonPath('data.status', 'received')->assertJsonPath('data.lines.0.received_quantity', '10.000');
        $this->assertSame('12.000', $this->stockRow($juice->id, $store)['quantity']);
    }

    public function test_bonus_units_can_be_returned_at_the_effective_cost(): void
    {
        ['admin' => $admin, 'org' => $org, 'store' => $store, 'variant' => $juice] = $this->procurementWorld();
        $pran = $this->supplier($org, 'Pran');
        $this->actingAsUser($admin);
        $receipt = $this->receive($pran->id, $store, [['variant_id' => $juice->id, 'quantity' => '10', 'bonus_quantity' => '1', 'unit_cost' => '20', 'tax_rate' => '10']]);
        $return = fn (string $qty, int $status = 201) => $this->postJson("/api/v1/purchasing/receipts/{$receipt['id']}/returns", [
            'reason' => 'Expired', 'lines' => [['goods_receipt_line_id' => $receipt['lines'][0]['id'], 'quantity' => $qty]],
        ])->assertStatus($status);

        // 11 × 18.1818 = 199.9998 → 200.00 + 10 % tax
        $return('11')->assertJsonPath('data.lines.0.unit_cost', '18.1818')->assertJsonPath('data.total', '220.00');
        $return('1', 422)->assertJsonPath('error.details', ['lines.0.quantity' => ['Only 0.000 can still be returned.']]);
        $this->assertSame('0.000', $this->stockRow($juice->id, $store)['quantity']);
        $this->getJson("/api/v1/purchasing/receipts/{$receipt['id']}")->assertJsonPath('data.lines.0.returned_quantity', '11.000');
        $this->assertSame('0.00', $this->balance($pran->id));
    }

    public function test_discount_and_bonus_validation(): void
    {
        ['admin' => $admin, 'org' => $org, 'store' => $store, 'variant' => $juice] = $this->procurementWorld();
        $rice = $this->stockedVariant($org, 'Miniket Rice', decimalUnit: true);
        $pran = $this->supplier($org, 'Pran');
        $this->actingAsUser($admin);
        $order = fn (array $line) => $this->postJson('/api/v1/purchasing/orders', [
            'supplier_id' => $pran->id, 'store_id' => $store, 'order_date' => now()->toDateString(),
            'lines' => [$line + ['variant_id' => $juice->id, 'quantity' => '10', 'unit_cost' => '20']],
        ]);

        $order(['discount_percent' => '100'])->assertStatus(422)->assertJsonPath('error.details', ['lines.0.discount_percent' => ['The discount must be below 100 %.']]);
        $order(['discount_percent' => '-1'])->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['lines.0.discount_percent']]]);
        $order(['bonus_quantity' => '-1'])->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['lines.0.bonus_quantity']]]);
        $order(['bonus_quantity' => '0.5'])->assertStatus(422)->assertJsonPath('error.details', ['lines.0.bonus_quantity' => ['Mango Juice is sold in whole units (pcs).']]);
        $order(['discount_percent' => '99.9999', 'bonus_quantity' => '1'])->assertCreated();

        $error = $this->receive($pran->id, $store, [['variant_id' => $juice->id, 'quantity' => '1', 'unit_cost' => '1', 'bonus_quantity' => '0.5']], [], 422);
        $this->assertSame(['lines.0.bonus_quantity'], array_keys($error['details']));
        $this->receive($pran->id, $store, [['variant_id' => $juice->id, 'quantity' => '1', 'unit_cost' => '1', 'discount_percent' => '100']], [], 422);
        $receipt = $this->receive($pran->id, $store, [['variant_id' => $rice->id, 'quantity' => '2.5', 'unit_cost' => '60', 'bonus_quantity' => '0.5']]);
        $this->assertSame('3.000', $this->stockRow($rice->id, $store)['quantity']);
        $this->assertSame('50.0000', $receipt['lines'][0]['effective_unit_cost']); // 150 ÷ 3
    }
}
