<?php

namespace App\Modules\Sales\Tests\Feature;

use App\Modules\Sales\Tests\Concerns\InteractsWithSales;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Critical workflows #5 and #6 end to end: discounts and taxes are validated and computed
 * on the server, identically for the price preview and for checkout.
 */
class DiscountAndTaxTest extends TestCase
{
    use InteractsWithSales, InteractsWithTenancy, RefreshDatabase;

    public function test_preview_and_checkout_agree_on_every_amount(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $rice = $this->sellable($org, 'Rice', '33.33', ['tax' => '15']);
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $this->stockUp($store, $rice, '10');
        $cart = $this->cart($store, [[$rice, '3', ['discount' => ['type' => 'percent', 'value' => '10']]]], [], ['invoice_discount' => ['type' => 'amount', 'value' => '5.00']]);

        $preview = $this->postJson('/api/v1/pos/price', $cart)->assertOk()
            ->assertJsonPath('data.subtotal', '99.99')
            ->assertJsonPath('data.item_discount_total', '10.00')
            ->assertJsonPath('data.invoice_discount_total', '5.00')
            ->assertJsonPath('data.invoice_discount.source', 'manual')
            ->assertJsonPath('data.tax_total', '12.75')
            ->assertJsonPath('data.total', '97.74')
            ->assertJsonPath('data.lines.0.available', '10.000')
            ->assertJsonMissingPath('data.lines.0.purchase_price')
            ->json('data');

        $sale = $this->checkout(['payments' => [['method' => 'cash', 'amount' => '100']]] + $cart)->assertCreated()->json('data');
        foreach (['subtotal', 'item_discount_total', 'invoice_discount_total', 'tax_total', 'total'] as $field) {
            $this->assertSame($preview[$field], $sale[$field], $field);
        }
        $this->assertSame('2.26', $sale['change_total']);
    }

    public function test_tax_inclusive_prices_contain_the_tax(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $this->inTenant($org, fn () => $org->update(['tax_mode' => 'inclusive']));
        $soap = $this->sellable($org, 'Soap', '115.00', ['tax' => '15']);
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $this->stockUp($store, $soap, '5');

        $this->checkout($this->cart($store, [[$soap, '2']], [['card', '230']]))
            ->assertCreated()
            ->assertJsonPath('data.tax_mode', 'inclusive')
            ->assertJsonPath('data.total', '230.00')
            ->assertJsonPath('data.tax_total', '30.00')
            ->assertJsonPath('data.lines.0.net_amount', '200.00');
    }

    public function test_cashiers_cannot_give_manual_discounts(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $soap = $this->sellable($org, 'Soap', '50.00');
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $this->stockUp($store, $soap, '5');
        $this->actingAsUser($this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]));

        $this->postJson('/api/v1/pos/price', $this->cart($store, [[$soap, '1', ['discount' => ['type' => 'amount', 'value' => '5']]]]))
            ->assertStatus(422)->assertJsonPath('error.code', 'DISCOUNT_NOT_ALLOWED');
        $this->postJson('/api/v1/pos/price', $this->cart($store, [[$soap, '1']], [], ['invoice_discount' => ['type' => 'percent', 'value' => '5']]))
            ->assertStatus(422)->assertJsonPath('error.code', 'DISCOUNT_NOT_ALLOWED');
        $this->postJson('/api/v1/pos/price', $this->cart($store, [[$soap, '1']]))->assertOk()->assertJsonPath('data.total', '50.00');
    }

    public function test_item_discounts_respect_the_product_limit(): void
    {
        ['organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $soap = $this->sellable($org, 'Soap', '200.00', ['max_discount' => '10']);
        $store = $this->mainStoreId($org);
        $this->actingAsUser($this->createUserWithRole($org, SystemRole::BranchManager, [$branch->id]));

        // 25.00 of 200.00 is 12.5 % > 10 %.
        $this->postJson('/api/v1/pos/price', $this->cart($store, [[$soap, '1', ['discount' => ['type' => 'amount', 'value' => '25']]]]))
            ->assertStatus(422)
            ->assertJsonPath('error.code', 'DISCOUNT_NOT_ALLOWED')
            ->assertJsonPath('error.details.max_percent', '10.00');
        $this->postJson('/api/v1/pos/price', $this->cart($store, [[$soap, '1', ['discount' => ['type' => 'percent', 'value' => '10']]]]))
            ->assertOk()->assertJsonPath('data.total', '180.00');
        $this->postJson('/api/v1/pos/price', $this->cart($store, [[$soap, '1', ['discount' => ['type' => 'percent', 'value' => '101']]]]))
            ->assertStatus(422)->assertJsonPath('error.details', ['lines.0.discount.value' => ['A percentage discount cannot exceed 100%.']]);
    }

    public function test_customer_group_discount_applies_automatically_without_permission(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $soap = $this->sellable($org, 'Soap', '100.00');
        $store = $this->mainStoreId($org);
        $wholesale = $this->customer($org, 'Corner Store', groupDiscount: '5');
        $this->actingAsUser($admin);
        $this->stockUp($store, $soap, '5');
        $this->actingAsUser($this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]));

        $this->postJson('/api/v1/pos/price', $this->cart($store, [[$soap, '2']], [], ['customer_id' => $wholesale->id]))
            ->assertOk()
            ->assertJsonPath('data.invoice_discount', ['type' => 'percent', 'value' => '5.00', 'source' => 'customer_group'])
            ->assertJsonPath('data.total', '190.00')
            ->assertJsonPath('data.customer.credit.available', '0.00');

        // Explicitly removing it needs no permission either.
        $this->postJson('/api/v1/pos/price', $this->cart($store, [[$soap, '2']], [], ['customer_id' => $wholesale->id, 'invoice_discount' => null]))
            ->assertOk()->assertJsonPath('data.total', '200.00');
    }

    public function test_quantities_follow_the_unit(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $soap = $this->sellable($org, 'Soap', '10.00');
        $this->actingAsUser($admin);

        $this->postJson('/api/v1/pos/price', $this->cart($this->mainStoreId($org), [[$soap, '1.5']]))
            ->assertStatus(422)->assertJsonPath('error.details', ['lines.0.quantity' => ['Soap is sold in whole units (pcs).']]);
    }
}
