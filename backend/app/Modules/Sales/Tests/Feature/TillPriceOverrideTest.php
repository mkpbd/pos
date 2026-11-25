<?php

namespace App\Modules\Sales\Tests\Feature;

use App\Modules\Branches\Infrastructure\Models\Store;
use App\Modules\Organizations\Infrastructure\Models\Organization;
use App\Modules\Pos\Infrastructure\Models\PosApproval;
use App\Modules\Sales\Infrastructure\Models\SaleLine;
use App\Modules\Sales\Tests\Concerns\InteractsWithSales;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * POS1a §3: open-price products, price overrides and manual discounts with a manager's
 * approval, and what the sale keeps of them.
 */
class TillPriceOverrideTest extends TestCase
{
    use InteractsWithSales, InteractsWithTenancy, RefreshDatabase;

    private Organization $org;

    private User $admin;

    private User $cashier;

    private User $manager;

    private string $store;

    protected function setUp(): void
    {
        parent::setUp();
        ['admin' => $this->admin, 'organization' => $this->org, 'branch' => $branch] = $this->provisionTenant();
        $this->store = $this->mainStoreId($this->org);
        $this->cashier = $this->createUserWithRole($this->org, SystemRole::Cashier, [$branch->id]);
        $this->manager = $this->createUserWithRole($this->org, SystemRole::BranchManager, [$branch->id]);
    }

    /**
     * An approval as `POST /pos/approvals` stores it (the PIN check is the Pos module's).
     *
     * @param  array<string, mixed>  $details
     */
    private function approval(string $action, array $details = [], ?User $requester = null, ?string $expires = '+10 minutes', ?Organization $org = null, ?string $store = null): string
    {
        $org ??= $this->org;

        return $this->inTenant($org, fn () => PosApproval::query()->create([
            'organization_id' => $org->id,
            'store_id' => $store ?? $this->store,
            'action' => $action,
            'approver_id' => $this->manager->id,
            'requester_id' => ($requester ?? $this->cashier)->id,
            'details' => $details,
            'expires_at' => now()->modify($expires),
            'created_at' => now(),
        ]))->id;
    }

    public function test_open_price_products_need_a_price_and_sell_at_it(): void
    {
        $cake = $this->stockedVariant($this->org, 'Custom cake', ['open_price' => true]);
        $this->actingAsUser($this->admin);
        $this->stockUp($this->store, $cake, '5');
        $this->getJson("/api/v1/pos/catalog?store_id={$this->store}&search=Custom")->assertOk()->assertJsonPath('data.0.open_price', true);

        $this->actingAsUser($this->cashier);
        $this->postJson('/api/v1/pos/price', $this->cart($this->store, [[$cake, '1']]))
            ->assertStatus(422)->assertJsonPath('error.code', 'PRICE_REQUIRED')->assertJsonPath('error.details.line', 0);
        $this->postJson('/api/v1/pos/price', $this->cart($this->store, [[$cake, '1', ['unit_price' => '0']]]))
            ->assertStatus(422)->assertJsonValidationErrors('lines.0.unit_price', 'error.details');
        $this->postJson('/api/v1/pos/price', $this->cart($this->store, [[$cake, '1', ['unit_price' => '100000000.00']]]))
            ->assertStatus(422)->assertJsonValidationErrors('lines.0.unit_price', 'error.details');

        // No approval needed, even for a cashier.
        $this->postJson('/api/v1/pos/price', $this->cart($this->store, [[$cake, '2', ['unit_price' => '750.50']]]))->assertOk()
            ->assertJsonPath('data.lines.0.open_price', true)
            ->assertJsonPath('data.lines.0.price_source', 'open')
            ->assertJsonPath('data.lines.0.list_price', null)
            ->assertJsonPath('data.lines.0.unit_price', '750.50')
            ->assertJsonPath('data.total', '1501.00')
            ->assertJsonPath('data.savings_total', '0.00');

        $sale = $this->checkout($this->cart($this->store, [[$cake, '2', ['unit_price' => '750.50']]], [['cash', '1501.00']]))->assertCreated()
            ->assertJsonPath('data.lines.0.price_source', 'open')
            ->assertJsonPath('data.lines.0.list_price', null)
            ->assertJsonPath('data.lines.0.unit_price', '750.50')
            ->json('data');
        $this->assertSame('1501.00', $sale['total']);
    }

    public function test_a_price_change_needs_the_permission_or_an_approval_for_that_product(): void
    {
        $soap = $this->sellable($this->org, 'Soap', '50.00');
        $oil = $this->sellable($this->org, 'Oil', '200.00');
        $this->actingAsUser($this->admin);
        $this->stockUp($this->store, $soap, '10');
        $this->stockUp($this->store, $oil, '10');

        // With sales.price_override (the admin): direct, no approver recorded.
        $this->postJson('/api/v1/pos/price', $this->cart($this->store, [[$soap, '2', ['unit_price' => '40']]]))->assertOk()
            ->assertJsonPath('data.lines.0.price_source', 'override')
            ->assertJsonPath('data.lines.0.list_price', '50.00')
            ->assertJsonPath('data.lines.0.unit_price', '40.00')
            ->assertJsonPath('data.lines.0.price_approved_by', null)
            ->assertJsonPath('data.total', '80.00')
            ->assertJsonPath('data.savings_total', '20.00');

        $this->actingAsUser($this->cashier);
        // The catalog price sent back is no change.
        $this->postJson('/api/v1/pos/price', $this->cart($this->store, [[$soap, '1', ['unit_price' => '50.00']]]))->assertOk()
            ->assertJsonPath('data.lines.0.price_source', 'catalog');
        $this->postJson('/api/v1/pos/price', $this->cart($this->store, [[$oil, '1'], [$soap, '1', ['unit_price' => '40']]]))
            ->assertStatus(422)->assertJsonPath('error.code', 'APPROVAL_REQUIRED')
            ->assertJsonPath('error.details.action', 'price_override')->assertJsonPath('error.details.line', 1);

        // An approval is bound to its product, its action, its cashier and its store, and expires.
        $forSoap = $this->approval('price_override', ['variant_id' => $soap->id]);
        foreach ([
            $this->approval('price_override', ['variant_id' => $oil->id]),
            $this->approval('discount'),
            $this->approval('price_override', ['variant_id' => $soap->id], requester: $this->manager),
            $this->approval('price_override', ['variant_id' => $soap->id], expires: '-1 minute'),
        ] as $wrong) {
            $this->postJson('/api/v1/pos/price', $this->cart($this->store, [[$soap, '1', ['unit_price' => '40', 'price_approval_id' => $wrong]]]))
                ->assertStatus(422)->assertJsonPath('error.code', 'APPROVAL_INVALID');
        }

        $this->postJson('/api/v1/pos/price', $this->cart($this->store, [[$soap, '1', ['unit_price' => '40', 'price_approval_id' => $forSoap]], [$soap, '2', ['unit_price' => '45', 'price_approval_id' => $forSoap]]]))->assertOk()
            ->assertJsonPath('data.lines.0.price_approved_by.id', $this->manager->id)
            ->assertJsonPath('data.lines.0.price_approved_by.name', $this->manager->name)
            ->assertJsonPath('data.lines.1.unit_price', '45.00')
            ->assertJsonPath('data.total', '130.00');

        // Checkout consumes it (once, for both lines) and keeps who approved.
        $payload = $this->cart($this->store, [[$soap, '1', ['unit_price' => '40', 'price_approval_id' => $forSoap]], [$soap, '2', ['unit_price' => '45', 'price_approval_id' => $forSoap]]], [['cash', '130.00']]);
        $sale = $this->checkout($payload)->assertCreated()
            ->assertJsonPath('data.lines.0.price_source', 'override')
            ->assertJsonPath('data.lines.0.list_price', '50.00')
            ->assertJsonPath('data.lines.0.price_approved_by.id', $this->manager->id)
            ->assertJsonPath('data.savings_total', '20.00')
            ->json('data');
        $approval = PosApproval::query()->withoutGlobalScopes()->findOrFail($forSoap);
        $this->assertNotNull($approval->used_at);
        $this->assertSame($sale['id'], $approval->sale_id);
        $line = SaleLine::query()->withoutGlobalScopes()->where('sale_id', $sale['id'])->where('position', 0)->firstOrFail();
        $this->assertSame([$this->manager->id, $forSoap, 'override', '50.00'], [$line->price_approved_by, $line->price_approval_id, $line->price_source, (string) $line->list_price]);

        // Used: a second sale cannot reuse it.
        $this->checkout($payload)->assertStatus(422)->assertJsonPath('error.code', 'APPROVAL_INVALID');
        $this->postJson('/api/v1/pos/price', $payload)->assertStatus(422)->assertJsonPath('error.code', 'APPROVAL_INVALID');
    }

    public function test_manual_discounts_with_a_managers_approval_within_product_limits(): void
    {
        $soap = $this->sellable($this->org, 'Soap', '100.00', ['max_discount' => '10']);
        $this->actingAsUser($this->admin);
        $this->stockUp($this->store, $soap, '10');
        $this->actingAsUser($this->cashier);
        $approval = $this->approval('discount');

        $cart = $this->cart($this->store, [[$soap, '2', ['discount' => ['type' => 'percent', 'value' => '10']]]], [], [
            'invoice_discount' => ['type' => 'amount', 'value' => '10.00'],
            'discount_approval_id' => $approval,
        ]);
        $this->postJson('/api/v1/pos/price', $cart)->assertOk()
            ->assertJsonPath('data.item_discount_total', '20.00')
            ->assertJsonPath('data.invoice_discount.source', 'manual')
            ->assertJsonPath('data.discount_approved_by.id', $this->manager->id)
            ->assertJsonPath('data.total', '170.00')
            ->assertJsonPath('data.savings_total', '30.00');

        // The product's limit still applies, approval or not (and for the admin too).
        $over = ['discount' => ['type' => 'percent', 'value' => '15']];
        $this->postJson('/api/v1/pos/price', $this->cart($this->store, [[$soap, '1', $over]], [], ['discount_approval_id' => $approval]))
            ->assertStatus(422)->assertJsonPath('error.code', 'DISCOUNT_NOT_ALLOWED');
        $this->postJson('/api/v1/pos/price', $this->cart($this->store, [[$soap, '1', $over]], [], ['discount_approval_id' => $this->approval('price_override', ['variant_id' => $soap->id])]))
            ->assertStatus(422)->assertJsonPath('error.code', 'APPROVAL_INVALID');

        $sale = $this->checkout(['payments' => [['method' => 'cash', 'amount' => '170.00']]] + $cart)->assertCreated()
            ->assertJsonPath('data.discount_approved_by.id', $this->manager->id)
            ->assertJsonPath('data.discount_approved_by.name', $this->manager->name)
            ->json('data');
        $this->assertSame($sale['id'], PosApproval::query()->withoutGlobalScopes()->findOrFail($approval)->sale_id);
        $this->checkout(['payments' => [['method' => 'cash', 'amount' => '170.00']]] + $cart)->assertStatus(422)->assertJsonPath('error.code', 'APPROVAL_INVALID');

        $this->actingAsUser($this->admin);
        $this->postJson('/api/v1/pos/price', $this->cart($this->store, [[$soap, '1', $over]]))
            ->assertStatus(422)->assertJsonPath('error.code', 'DISCOUNT_NOT_ALLOWED');
        // An approval id is ignored when the cart needs none.
        $this->postJson('/api/v1/pos/price', $this->cart($this->store, [[$soap, '1']], [], ['discount_approval_id' => $this->approval('discount')]))->assertOk()
            ->assertJsonPath('data.discount_approved_by', null);
    }

    public function test_sale_detail_and_held_carts_keep_the_till_fields(): void
    {
        $soap = $this->sellable($this->org, 'Soap', '50.00');
        $this->actingAsUser($this->admin);
        $this->stockUp($this->store, $soap, '10');
        $this->actingAsUser($this->cashier);
        $priceApproval = $this->approval('price_override', ['variant_id' => $soap->id]);
        $discountApproval = $this->approval('discount');
        $cart = $this->cart($this->store, [[$soap, '2', ['unit_price' => '45', 'price_approval_id' => $priceApproval]]], [], [
            'invoice_discount' => ['type' => 'amount', 'value' => '5.00'],
            'discount_approval_id' => $discountApproval,
            'coupon_code' => 'NOPE-1',
        ]);

        $held = $this->postJson('/api/v1/pos/held', $cart + ['label' => 'Table 4'])->assertCreated()->json('data.id');
        $stored = $this->getJson("/api/v1/pos/held/{$held}")->assertOk()->json('data.cart');
        $this->assertSame([$priceApproval, '45', $discountApproval, 'NOPE-1'], [$stored['lines'][0]['price_approval_id'], $stored['lines'][0]['unit_price'], $stored['discount_approval_id'], $stored['coupon_code']]);

        unset($cart['coupon_code']);
        $id = $this->checkout(['payments' => [['method' => 'cash', 'amount' => '85.00']]] + $cart)->assertCreated()->json('data.id');
        $this->actingAsUser($this->admin);
        $this->getJson("/api/v1/sales/{$id}")->assertOk()
            ->assertJsonPath('data.lines.0.list_price', '50.00')
            ->assertJsonPath('data.lines.0.unit_price', '45.00')
            ->assertJsonPath('data.lines.0.price_source', 'override')
            ->assertJsonPath('data.lines.0.price_approved_by.name', $this->manager->name)
            ->assertJsonPath('data.lines.0.promotion', null)
            ->assertJsonPath('data.promotions', [])
            ->assertJsonPath('data.coupon_code', null)
            ->assertJsonPath('data.savings_total', '15.00')
            ->assertJsonPath('data.discount_approved_by.id', $this->manager->id);
    }

    public function test_approvals_of_another_organization_or_store_do_not_count(): void
    {
        $soap = $this->sellable($this->org, 'Soap', '50.00');
        ['organization' => $other, 'admin' => $otherAdmin] = $this->provisionTenant('Other Shop');
        $otherStore = $this->mainStoreId($other);
        $this->actingAsUser($this->admin);
        $this->stockUp($this->store, $soap, '10');
        $this->actingAsUser($this->cashier);

        $foreign = $this->inTenant($other, fn () => PosApproval::query()->create([
            'organization_id' => $other->id,
            'store_id' => $otherStore,
            'action' => 'price_override',
            'approver_id' => $otherAdmin->id,
            'requester_id' => $this->cashier->id,
            'details' => ['variant_id' => $soap->id],
            'expires_at' => now()->addMinutes(10),
            'created_at' => now(),
        ]))->id;
        $this->postJson('/api/v1/pos/price', $this->cart($this->store, [[$soap, '1', ['unit_price' => '40', 'price_approval_id' => $foreign]]]))
            ->assertStatus(422)->assertJsonPath('error.code', 'APPROVAL_INVALID');

        $branch = $this->createBranch($this->org, 'B2');
        $secondStore = $this->inTenant($this->org, fn () => Store::query()->where('branch_id', $branch->id)->firstOrFail()->id);
        $elsewhere = $this->approval('price_override', ['variant_id' => $soap->id], store: $secondStore);
        $this->postJson('/api/v1/pos/price', $this->cart($this->store, [[$soap, '1', ['unit_price' => '40', 'price_approval_id' => $elsewhere]]]))
            ->assertStatus(422)->assertJsonPath('error.code', 'APPROVAL_INVALID');
    }

    public function test_products_accept_and_return_open_price(): void
    {
        $this->actingAsUser($this->admin);
        $soap = $this->sellable($this->org, 'Soap', '50.00');
        $productId = (string) $soap->product_id;

        $product = $this->getJson("/api/v1/products/{$productId}")->assertOk()->assertJsonPath('data.open_price', false)->json('data');
        $body = [
            'name' => $product['name'],
            'type' => $product['type'],
            'unit_id' => $product['unit']['id'],
            'open_price' => true,
            'variants' => array_map(fn (array $v) => ['id' => $v['id'], 'sku' => $v['sku'], 'purchase_price' => $v['purchase_price'], 'selling_price' => $v['selling_price']], $product['variants']),
        ];
        $this->putJson("/api/v1/products/{$productId}", $body)->assertOk()->assertJsonPath('data.open_price', true);
        // Left out on a later save: kept.
        unset($body['open_price']);
        $this->putJson("/api/v1/products/{$productId}", $body + ['name' => 'Soap bar'])->assertOk()->assertJsonPath('data.open_price', true);
        $this->putJson("/api/v1/products/{$productId}", $body + ['open_price' => 'maybe'])->assertStatus(422)->assertJsonValidationErrors('open_price', 'error.details');
    }
}
