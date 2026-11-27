<?php

namespace App\Modules\Sales\Tests\Feature;

use App\Modules\Branches\Infrastructure\Models\Store;
use App\Modules\Customers\Infrastructure\Models\Customer;
use App\Modules\Customers\Infrastructure\Models\CustomerGroup;
use App\Modules\Organizations\Infrastructure\Models\Organization;
use App\Modules\Pos\Infrastructure\Models\PosApproval;
use App\Modules\Products\Infrastructure\Models\ProductVariant;
use App\Modules\Promotions\Tests\Concerns\BuildsPromotions;
use App\Modules\Sales\Infrastructure\Models\SaleLine;
use App\Modules\Sales\Tests\Concerns\InteractsWithSales;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * ST2c §2: the till's list price — branch price, wholesale price for wholesale customers,
 * quantity breaks — and how promotions, price changes, held carts and checkout use it.
 */
class TillListPriceTest extends TestCase
{
    use BuildsPromotions, InteractsWithSales, InteractsWithTenancy, RefreshDatabase;

    private Organization $org;

    private User $admin;

    private User $cashier;

    private string $store;

    private string $branchId;

    private ProductVariant $soap;

    protected function setUp(): void
    {
        parent::setUp();
        ['admin' => $this->admin, 'organization' => $this->org, 'branch' => $branch] = $this->provisionTenant();
        $this->store = $this->mainStoreId($this->org);
        $this->branchId = $branch->id;
        $this->cashier = $this->createUserWithRole($this->org, SystemRole::Cashier, [$branch->id]);
        $this->soap = $this->sellable($this->org, 'Soap', '100.00');
        $this->actingAsUser($this->admin);
        $this->stockUp($this->store, $this->soap, '200');
    }

    /**
     * Wholesale price, quantity breaks ([min, price]) and branch prices (branch id => price) as
     * the product form saves them.
     *
     * @param  list<array{0: string, 1: string}>  $tiers
     * @param  array<string, string>  $branchPrices
     */
    private function prices(ProductVariant $variant, ?string $wholesale = null, array $tiers = [], array $branchPrices = []): void
    {
        DB::table('product_variants')->where('id', $variant->id)->update(['wholesale_price' => $wholesale]);
        foreach ($tiers as [$min, $price]) {
            DB::table('product_price_tiers')->insert(['id' => (string) Str::uuid(), 'organization_id' => $variant->organization_id, 'variant_id' => $variant->id, 'min_quantity' => $min, 'price' => $price]);
        }
        foreach ($branchPrices as $branchId => $price) {
            DB::table('product_branch_prices')->insert(['id' => (string) Str::uuid(), 'organization_id' => $variant->organization_id, 'variant_id' => $variant->id, 'branch_id' => $branchId, 'price' => $price]);
        }
    }

    private function wholesaleCustomer(string $name, string $groupDiscount = '0'): Customer
    {
        return $this->inTenant($this->org, function () use ($name, $groupDiscount) {
            $group = CustomerGroup::query()->create(['name' => "Trade {$groupDiscount}", 'discount_percent' => $groupDiscount, 'price_level' => 'wholesale']);

            return Customer::query()->create(['code' => 'CUS-'.Str::upper(Str::random(6)), 'name' => $name, 'customer_group_id' => $group->id, 'credit_limit' => '0', 'opening_balance' => '0', 'is_active' => true]);
        });
    }

    /**
     * @param  array<string, mixed>  $extra
     * @return array{0: string, 1: string, 2: string} unit price, list price, source of line 0
     */
    private function line0(string $quantity, array $extra = [], ?string $store = null, ?ProductVariant $variant = null): array
    {
        $line = $this->postJson('/api/v1/pos/price', $this->cart($store ?? $this->store, [[$variant ?? $this->soap, $quantity]], [], $extra))->assertOk()->json('data.lines.0');

        return [$line['unit_price'], $line['list_price'], $line['price_source']];
    }

    public function test_the_stores_branch_price_replaces_the_selling_price_at_that_branch_only(): void
    {
        $this->postJson('/api/v1/branches', ['code' => 'NORTH', 'name' => 'North'])->assertCreated();
        $north = Store::query()->withoutGlobalScopes()->where('organization_id', $this->org->id)->where('branch_id', '!=', $this->branchId)->firstOrFail();
        $other = $this->provisionTenant('Other Retail');
        $this->prices($this->soap, branchPrices: [$this->branchId => '90.00']);

        $this->assertSame(['90.00', '90.00', 'catalog'], $this->line0('1'));
        $this->assertSame(['100.00', '100.00', 'catalog'], $this->line0('1', store: $north->id));

        $this->prices($this->soap, branchPrices: [$north->branch_id => '95.50']);
        $this->assertSame(['95.50', '95.50', 'catalog'], $this->line0('2', store: $north->id));

        // Another organization's branch prices never price this one's carts.
        $theirs = $this->sellable($other['organization'], 'Soap', '100.00');
        $this->prices($theirs, branchPrices: [$other['branch']->id => '10.00']);
        DB::table('product_branch_prices')->where('variant_id', $this->soap->id)->delete();
        $this->assertSame(['100.00', '100.00', 'catalog'], $this->line0('1'));
    }

    public function test_wholesale_customers_pay_the_wholesale_price_and_keep_their_group_discount(): void
    {
        $oil = $this->sellable($this->org, 'Oil', '50.00');
        $this->stockUp($this->store, $oil, '20');
        $this->prices($this->soap, wholesale: '80.00', branchPrices: [$this->branchId => '90.00']);
        $retail = $this->customer($this->org, 'Walk-in Rina', groupDiscount: '5');
        $trader = $this->wholesaleCustomer('Karim Traders', '5');

        $this->assertSame(['90.00', '90.00', 'catalog'], $this->line0('1'));
        $this->assertSame(['90.00', '90.00', 'catalog'], $this->line0('1', ['customer_id' => $retail->id]));
        $this->assertSame(['80.00', '80.00', 'wholesale'], $this->line0('1', ['customer_id' => $trader->id]));
        // No wholesale price: the usual list price.
        $this->assertSame(['50.00', '50.00', 'catalog'], $this->line0('1', ['customer_id' => $trader->id], variant: $oil));

        // The group discount still comes on top, as the invoice discount.
        $this->postJson('/api/v1/pos/price', $this->cart($this->store, [[$this->soap, '2']], [], ['customer_id' => $trader->id]))->assertOk()
            ->assertJsonPath('data.subtotal', '160.00')
            ->assertJsonPath('data.invoice_discount.source', 'customer_group')
            ->assertJsonPath('data.invoice_discount_total', '8.00')
            ->assertJsonPath('data.total', '152.00')
            ->assertJsonPath('data.savings_total', '8.00');
    }

    public function test_quantity_breaks_give_the_highest_tier_reached_when_lower(): void
    {
        $this->prices($this->soap, tiers: [['50', '85.00'], ['10', '90.00']]);

        $this->assertSame(['100.00', '100.00', 'catalog'], $this->line0('9'));
        $this->assertSame(['90.00', '90.00', 'tier'], $this->line0('10'));
        $this->assertSame(['90.00', '90.00', 'tier'], $this->line0('49'));
        $this->assertSame(['85.00', '85.00', 'tier'], $this->line0('60'));

        // A break that is not below the branch price changes nothing.
        $this->prices($this->soap, branchPrices: [$this->branchId => '88.00']);
        $this->assertSame(['88.00', '88.00', 'catalog'], $this->line0('10'));
        $this->assertSame(['85.00', '85.00', 'tier'], $this->line0('50'));
    }

    public function test_tier_and_wholesale_prices_the_lower_wins(): void
    {
        $this->prices($this->soap, wholesale: '88.00', tiers: [['10', '90.00'], ['50', '85.00']]);
        $trader = $this->wholesaleCustomer('Karim Traders');

        $this->assertSame(['88.00', '88.00', 'wholesale'], $this->line0('10', ['customer_id' => $trader->id]));
        $this->assertSame(['85.00', '85.00', 'tier'], $this->line0('50', ['customer_id' => $trader->id]));
        $this->assertSame(['90.00', '90.00', 'tier'], $this->line0('10'));
    }

    public function test_till_promotions_apply_to_catalog_and_branch_prices_only(): void
    {
        $this->makePromotion($this->org, ['name' => 'Soap week', 'type' => 'percent', 'value' => '10', 'scope' => 'products', 'target_ids' => [$this->productOf($this->soap->id)], 'channels' => ['till']]);
        $this->prices($this->soap, wholesale: '80.00', tiers: [['10', '90.00']], branchPrices: [$this->branchId => '95.00']);
        $trader = $this->wholesaleCustomer('Karim Traders');

        $this->postJson('/api/v1/pos/price', $this->cart($this->store, [[$this->soap, '2']]))->assertOk()
            ->assertJsonPath('data.lines.0.price_source', 'catalog')
            ->assertJsonPath('data.lines.0.promotion', ['name' => 'Soap week', 'amount' => '19.00']);
        $this->postJson('/api/v1/pos/price', $this->cart($this->store, [[$this->soap, '10']]))->assertOk()
            ->assertJsonPath('data.lines.0.price_source', 'tier')
            ->assertJsonPath('data.lines.0.promotion', null)
            ->assertJsonPath('data.lines.0.discount_amount', '0.00')
            ->assertJsonPath('data.promotions', [])
            ->assertJsonPath('data.total', '900.00');
        $this->postJson('/api/v1/pos/price', $this->cart($this->store, [[$this->soap, '1']], [], ['customer_id' => $trader->id]))->assertOk()
            ->assertJsonPath('data.lines.0.price_source', 'wholesale')
            ->assertJsonPath('data.lines.0.promotion', null)
            ->assertJsonPath('data.total', '80.00');
    }

    public function test_a_price_change_needs_approval_against_the_new_list_price(): void
    {
        $this->prices($this->soap, tiers: [['10', '90.00']]);
        $this->actingAsUser($this->cashier);

        // Sending the tier price back is no change.
        $this->postJson('/api/v1/pos/price', $this->cart($this->store, [[$this->soap, '10', ['unit_price' => '90.00']]]))->assertOk()
            ->assertJsonPath('data.lines.0.price_source', 'tier')
            ->assertJsonPath('data.lines.0.list_price', '90.00');
        $this->postJson('/api/v1/pos/price', $this->cart($this->store, [[$this->soap, '10', ['unit_price' => '85']]]))
            ->assertStatus(422)->assertJsonPath('error.code', 'APPROVAL_REQUIRED')->assertJsonPath('error.details.action', 'price_override');

        $approval = $this->inTenant($this->org, fn () => PosApproval::query()->create([
            'organization_id' => $this->org->id, 'store_id' => $this->store, 'action' => 'price_override', 'approver_id' => $this->admin->id,
            'requester_id' => $this->cashier->id, 'details' => ['variant_id' => $this->soap->id], 'expires_at' => now()->addMinutes(10), 'created_at' => now(),
        ]))->id;
        $cart = $this->cart($this->store, [[$this->soap, '10', ['unit_price' => '85', 'price_approval_id' => $approval]]], [['cash', '850.00']]);
        $this->postJson('/api/v1/pos/price', $cart)->assertOk()
            ->assertJsonPath('data.lines.0.price_source', 'override')
            ->assertJsonPath('data.lines.0.list_price', '90.00')
            ->assertJsonPath('data.savings_total', '50.00');
        $sale = $this->checkout($cart)->assertCreated()->json('data');
        $line = SaleLine::query()->withoutGlobalScopes()->where('sale_id', $sale['id'])->firstOrFail();
        $this->assertSame(['override', '90.00', '85.00'], [$line->price_source, (string) $line->list_price, (string) $line->unit_price]);
    }

    public function test_a_held_cart_is_repriced_when_resumed(): void
    {
        $this->prices($this->soap, tiers: [['10', '90.00']]);
        $trader = $this->wholesaleCustomer('Karim Traders');
        $this->actingAsUser($this->cashier);
        $held = $this->postJson('/api/v1/pos/held', $this->cart($this->store, [[$this->soap, '10']], [], ['customer_id' => $trader->id, 'label' => 'Karim']))->assertCreated()->json('data.id');

        // Meanwhile the break gets cheaper and the soap gets a wholesale price.
        DB::table('product_price_tiers')->where('variant_id', $this->soap->id)->update(['price' => '87.00']);
        DB::table('product_variants')->where('id', $this->soap->id)->update(['wholesale_price' => '86.00']);

        $cart = ['store_id' => $this->store] + $this->getJson("/api/v1/pos/held/{$held}")->assertOk()->json('data.cart');
        $this->postJson('/api/v1/pos/price', $cart)->assertOk()
            ->assertJsonPath('data.lines.0.unit_price', '86.00')
            ->assertJsonPath('data.lines.0.price_source', 'wholesale')
            ->assertJsonPath('data.total', '860.00');
        $this->checkout(['held_sale_id' => $held, 'payments' => [['method' => 'cash', 'amount' => '860.00']]] + $cart)->assertCreated()
            ->assertJsonPath('data.total', '860.00')
            ->assertJsonPath('data.lines.0.price_source', 'wholesale');
    }

    public function test_checkout_charges_exactly_the_price_preview(): void
    {
        $oil = $this->sellable($this->org, 'Oil', '50.00', ['tax' => '15']);
        $rice = $this->sellable($this->org, 'Rice', '70.00');
        $this->stockUp($this->store, $oil, '20');
        $this->stockUp($this->store, $rice, '20');
        $this->prices($this->soap, tiers: [['10', '90.00']]);
        $this->prices($oil, branchPrices: [$this->branchId => '45.00']);
        $this->prices($rice, wholesale: '60.00');
        $trader = $this->wholesaleCustomer('Karim Traders', '2.5');
        $cart = $this->cart($this->store, [[$this->soap, '12'], [$oil, '3'], [$rice, '2']], [], ['customer_id' => $trader->id]);

        $preview = $this->postJson('/api/v1/pos/price', $cart)->assertOk()->json('data');
        $this->assertSame(['tier', 'catalog', 'wholesale'], array_column($preview['lines'], 'price_source'));
        $this->assertSame(['90.00', '45.00', '60.00'], array_column($preview['lines'], 'list_price'));

        $sale = $this->checkout(['payments' => [['method' => 'cash', 'amount' => $preview['total']]]] + $cart)->assertCreated()->json('data');
        foreach (['subtotal', 'item_discount_total', 'invoice_discount_total', 'tax_total', 'total'] as $field) {
            $this->assertSame($preview[$field], $sale[$field], $field);
        }
        $lines = SaleLine::query()->withoutGlobalScopes()->where('sale_id', $sale['id'])->orderBy('position')->get();
        $this->assertSame(['tier', 'catalog', 'wholesale'], $lines->pluck('price_source')->all());
        $this->assertSame(['90.00', '45.00', '60.00'], $lines->map(fn (SaleLine $l) => (string) $l->list_price)->all());
        $this->assertSame(array_column($preview['lines'], 'line_total'), $lines->map(fn (SaleLine $l) => (string) $l->line_total)->all());
    }
}
