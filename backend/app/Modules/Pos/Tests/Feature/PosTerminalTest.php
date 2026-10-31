<?php

namespace App\Modules\Pos\Tests\Feature;

use App\Modules\Products\Infrastructure\Models\Product;
use App\Modules\Sales\Tests\Concerns\InteractsWithSales;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Critical workflows #3 (POS product selection) and #4 (barcode scanning), plus held carts.
 */
class PosTerminalTest extends TestCase
{
    use InteractsWithSales, InteractsWithTenancy, RefreshDatabase;

    public function test_product_grid_shows_price_tax_and_stock_of_the_store(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $juice = $this->sellable($org, 'Mango Juice', '25.00', ['tax' => '5']);
        $this->sellable($org, 'Apple Juice', '30.00');
        $repair = $this->sellable($org, 'Repair', '100.00', ['service' => true]);
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $this->stockUp($store, $juice, '12');

        $items = $this->getJson("/api/v1/pos/catalog?store_id={$store}")->assertOk()
            ->assertJsonPath('meta.pagination.total', 3)
            ->json('data');
        $this->assertSame(['Apple Juice', 'Mango Juice', 'Repair'], array_column($items, 'product_name'));
        $this->assertSame(['0.000', '12.000', null], array_column($items, 'on_hand'));
        $this->assertSame('5.0000', $items[1]['tax_rate']);
        $this->assertArrayNotHasKey('purchase_price', $items[1]);

        $this->getJson("/api/v1/pos/catalog?store_id={$store}&search=mango")->assertOk()->assertJsonCount(1, 'data');
        $this->inTenant($org, fn () => Product::query()->whereKey($repair->product_id)->update(['is_active' => false]));
        $this->getJson("/api/v1/pos/catalog?store_id={$store}")->assertOk()->assertJsonCount(2, 'data');
    }

    public function test_scanning_a_barcode_finds_the_variant(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $juice = $this->sellable($org, 'Mango Juice', '25.00', ['barcodes' => ['4006381333931']]);
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);

        $this->getJson("/api/v1/pos/lookup?store_id={$store}&code=4006381333931")->assertOk()
            ->assertJsonPath('data.variant_id', $juice->id)
            ->assertJsonPath('data.price', '25.00');
        $this->getJson("/api/v1/pos/lookup?store_id={$store}&code=".strtolower($juice->sku))->assertOk()->assertJsonPath('data.variant_id', $juice->id);
        $this->getJson("/api/v1/pos/lookup?store_id={$store}&code=0000000000000")->assertNotFound();

        $this->inTenant($org, fn () => Product::query()->whereKey($juice->product_id)->update(['is_active' => false]));
        $this->getJson("/api/v1/pos/lookup?store_id={$store}&code=4006381333931")
            ->assertStatus(422)->assertJsonPath('error.code', 'PRODUCT_NOT_SELLABLE');
    }

    public function test_held_carts_resume_and_are_consumed_by_checkout(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $soap = $this->sellable($org, 'Soap', '10.00');
        $store = $this->mainStoreId($org);
        $customer = $this->customer($org, 'Rina');
        $this->actingAsUser($admin);
        $this->stockUp($store, $soap, '5');
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]);
        $this->actingAsUser($cashier);

        $cart = ['store_id' => $store, 'customer_id' => $customer->id, 'lines' => [['variant_id' => $soap->id, 'quantity' => '2', 'discount' => null]]];
        $held = $this->postJson('/api/v1/pos/held', $cart + ['label' => 'Lady in red'])->assertCreated()
            ->assertJsonPath('data.customer.name', 'Rina')
            ->assertJsonPath('data.lines_count', 1)
            ->json('data');

        $this->getJson('/api/v1/pos/held')->assertOk()->assertJsonPath('data.0.label', 'Lady in red');
        $this->getJson("/api/v1/pos/held/{$held['id']}")->assertOk()->assertJsonPath('data.cart.lines.0.quantity', '2');

        $payload = $cart + ['held_sale_id' => $held['id'], 'payments' => [['method' => 'cash', 'amount' => '20']]];
        $this->checkout($payload)->assertCreated();
        $this->getJson('/api/v1/pos/held')->assertOk()->assertJsonCount(0, 'data');
        $this->checkout($payload)->assertStatus(422)->assertJsonPath('error.code', 'HELD_SALE_GONE');
    }

    public function test_the_terminal_requires_pos_permission(): void
    {
        ['organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $store = $this->mainStoreId($org);
        $this->actingAsUser($this->createUserWithRole($org, SystemRole::InventoryManager, [$branch->id]));

        $this->getJson("/api/v1/pos/catalog?store_id={$store}")->assertForbidden();
        $this->getJson('/api/v1/sales')->assertForbidden();
    }
}
