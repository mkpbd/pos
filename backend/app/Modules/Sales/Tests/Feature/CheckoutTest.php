<?php

namespace App\Modules\Sales\Tests\Feature;

use App\Modules\Inventory\Infrastructure\Models\StockMovement;
use App\Modules\Sales\Infrastructure\Models\Sale;
use App\Modules\Sales\Infrastructure\Models\SaleLine;
use App\Modules\Sales\Tests\Concerns\InteractsWithSales;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use LogicException;
use Tests\TestCase;

/**
 * Critical workflows #3, #7, #8, #9: POS product selection, payments, checkout, inventory deduction.
 */
class CheckoutTest extends TestCase
{
    use InteractsWithSales, InteractsWithTenancy, RefreshDatabase;

    public function test_cash_checkout_deducts_stock_and_posts_an_immutable_invoice(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $juice = $this->sellable($org, 'Mango Juice', '15.00', ['tax' => '15', 'cost' => '10.00']);
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $this->stockUp($store, $juice, '10', '10.00');

        $sale = $this->checkout($this->cart($store, [[$juice, '3']], [['cash', '60']]))
            ->assertCreated()
            ->assertJsonPath('data.number', 'INV-MAIN-000001')
            ->assertJsonPath('data.status', 'completed')
            ->assertJsonPath('data.subtotal', '45.00')
            ->assertJsonPath('data.tax_total', '6.75')
            ->assertJsonPath('data.total', '51.75')
            ->assertJsonPath('data.paid_total', '51.75')
            ->assertJsonPath('data.change_total', '8.25')
            ->assertJsonPath('data.due_total', '0.00')
            ->assertJsonPath('data.cost_total', '30.00')
            ->assertJsonPath('data.lines.0.unit_cost', '10.0000')
            ->assertJsonPath('data.payments.0.amount', '51.75')
            ->assertJsonPath('data.payments.0.tendered', '60.00')
            ->assertJsonPath('data.receipt.branch.code', 'MAIN')
            ->json('data');

        $this->assertSame('7.000', $this->stockRow($juice->id, $store)['quantity']);
        $movement = StockMovement::query()->where('reference_id', $sale['id'])->sole();
        $this->assertSame(['sale', '-3.000', 'INV-MAIN-000001'], [$movement->type->value, $movement->quantity, $movement->reference_number]);

        $this->expectException(LogicException::class);
        SaleLine::query()->firstOrFail()->update(['unit_price' => '1.00']);
    }

    public function test_prices_and_totals_sent_by_the_client_are_ignored(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $juice = $this->sellable($org, 'Mango Juice', '15.00');
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $this->stockUp($store, $juice, '5');

        $payload = $this->cart($store, [[$juice, '2', ['unit_price' => '0.01', 'line_total' => '0.02']]], [['card', '30']]);
        $this->checkout($payload + ['total' => '0.02', 'subtotal' => '0.02'])
            ->assertCreated()
            ->assertJsonPath('data.lines.0.unit_price', '15.00')
            ->assertJsonPath('data.total', '30.00');
    }

    public function test_insufficient_stock_rolls_back_the_whole_sale(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $a = $this->sellable($org, 'A', '10.00');
        $b = $this->sellable($org, 'B', '10.00');
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $this->stockUp($store, $a, '5');
        $this->stockUp($store, $b, '1');

        $this->checkout($this->cart($store, [[$a, '2'], [$b, '2']], [['cash', '40']]))
            ->assertStatus(422)
            ->assertJsonPath('error.code', 'INSUFFICIENT_STOCK')
            ->assertJsonPath('error.details.available', '1.000');

        $this->assertSame(0, Sale::query()->count());
        $this->assertSame('5.000', $this->stockRow($a->id, $store)['quantity']);
        // The invoice number was not used up either.
        $this->checkout($this->cart($store, [[$a, '1']], [['cash', '10']]))->assertJsonPath('data.number', 'INV-MAIN-000001');
    }

    public function test_negative_stock_is_allowed_only_when_the_branch_says_so(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $a = $this->sellable($org, 'A', '10.00');
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $this->inTenant($org, fn () => $branch->update(['allow_negative_stock' => true]));

        $this->checkout($this->cart($store, [[$a, '2']], [['cash', '20']]))->assertCreated();
        $this->assertSame('-2.000', $this->stockRow($a->id, $store)['quantity']);
    }

    public function test_services_sell_without_stock_and_cost_their_purchase_price(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $repair = $this->sellable($org, 'Screen repair', '500.00', ['service' => true, 'cost' => '200.00']);
        $this->actingAsUser($admin);

        $this->checkout($this->cart($this->mainStoreId($org), [[$repair, '1']], [['mobile_banking', '500']]))
            ->assertCreated()
            ->assertJsonPath('data.cost_total', '200.00');
        $this->assertSame(0, StockMovement::query()->count());
    }

    public function test_checkout_is_idempotent(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $juice = $this->sellable($org, 'Mango Juice', '15.00');
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $this->stockUp($store, $juice, '10');
        $payload = $this->cart($store, [[$juice, '1']], [['cash', '15']]);

        $first = $this->checkout($payload, 'till-1-sale-0001')->assertCreated();
        $replay = $this->checkout($payload, 'till-1-sale-0001')->assertCreated()->assertHeader('Idempotent-Replayed', 'true');

        $this->assertSame($first->json('data.id'), $replay->json('data.id'));
        $this->assertSame(1, Sale::query()->count());
        $this->assertSame('9.000', $this->stockRow($juice->id, $store)['quantity']);

        $this->checkout($this->cart($store, [[$juice, '2']], [['cash', '30']]), 'till-1-sale-0001')
            ->assertStatus(409)->assertJsonPath('error.code', 'IDEMPOTENCY_KEY_REUSED');
        $this->postJson('/api/v1/pos/checkout', $payload)
            ->assertStatus(428)->assertJsonPath('error.code', 'IDEMPOTENCY_KEY_REQUIRED');
    }

    public function test_a_failed_checkout_releases_its_idempotency_key(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $juice = $this->sellable($org, 'Mango Juice', '15.00');
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $payload = $this->cart($store, [[$juice, '1']], [['cash', '15']]);

        $this->checkout($payload, 'retry-after-restock')->assertStatus(422);
        $this->stockUp($store, $juice, '1');
        $this->checkout($payload, 'retry-after-restock')->assertCreated();
    }

    public function test_split_partial_and_credit_payments(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $tv = $this->sellable($org, 'Television', '100.00');
        $store = $this->mainStoreId($org);
        $rahim = $this->customer($org, 'Rahim Traders', creditLimit: '150.00', openingBalance: '20.00');
        $this->actingAsUser($admin);
        $this->stockUp($store, $tv, '10');

        // Card 100 + cash 80 on 200 → 20 due on Rahim's account (opening 20 → outstanding 40).
        $this->checkout($this->cart($store, [[$tv, '2']], [['card', '100'], ['cash', '80']], ['customer_id' => $rahim->id]))
            ->assertCreated()
            ->assertJsonPath('data.paid_total', '180.00')
            ->assertJsonPath('data.due_total', '20.00');

        // Another 120 due would make 160 > 150.
        $this->checkout($this->cart($store, [[$tv, '2']], [['cash', '80']], ['customer_id' => $rahim->id]))
            ->assertStatus(422)
            ->assertJsonPath('error.code', 'CREDIT_LIMIT_EXCEEDED')
            ->assertJsonPath('error.details.outstanding', '40.00');

        $this->getJson("/api/v1/sales/customer-balances?customer_ids[]={$rahim->id}")
            ->assertOk()->assertJsonPath("data.{$rahim->id}", '40.00');

        $this->checkout($this->cart($store, [[$tv, '1']], [['cash', '50']]))
            ->assertStatus(422)->assertJsonPath('error.code', 'CUSTOMER_REQUIRED');
        $this->checkout($this->cart($store, [[$tv, '1']], [['card', '150']]))
            ->assertStatus(422)->assertJsonPath('error.code', 'NON_CASH_OVERPAYMENT');
    }

    public function test_a_cashier_cannot_sell_on_credit(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $tv = $this->sellable($org, 'Television', '100.00');
        $store = $this->mainStoreId($org);
        $customer = $this->customer($org, 'Rina', creditLimit: '1000');
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]);
        $this->actingAsUser($admin);
        $this->stockUp($store, $tv, '5');
        $this->actingAsUser($cashier);

        $this->checkout($this->cart($store, [[$tv, '1']], [['cash', '50']], ['customer_id' => $customer->id]))
            ->assertStatus(422)->assertJsonPath('error.code', 'CREDIT_SALE_NOT_ALLOWED');
        $this->checkout($this->cart($store, [[$tv, '1']], [['cash', '100']], ['customer_id' => $customer->id]))->assertCreated();
    }

    public function test_batches_are_sold_first_expiry_first_out_and_expired_stock_never(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $syrup = $this->sellable($org, 'Cough Syrup', '80.00', ['batches' => true]);
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $this->stockUp($store, $syrup, '2', '50.00', 'LATE', now()->addMonths(6)->toDateString());
        $this->stockUp($store, $syrup, '3', '40.00', 'EARLY', now()->addMonth()->toDateString());
        $this->stockUp($store, $syrup, '5', '30.00', 'OLD', now()->subDay()->toDateString());

        $this->checkout($this->cart($store, [[$syrup, '4']], [['cash', '320']]))
            ->assertCreated()
            ->assertJsonPath('data.lines.0.batches.0.batch_number', 'EARLY')
            ->assertJsonPath('data.lines.0.batches.0.quantity', '3.000')
            ->assertJsonPath('data.lines.0.batches.1.batch_number', 'LATE')
            ->assertJsonPath('data.lines.0.batches.1.quantity', '1.000')
            // (3 × 40 + 1 × 50) / 4
            ->assertJsonPath('data.lines.0.unit_cost', '42.5000');

        $this->checkout($this->cart($store, [[$syrup, '2']], [['cash', '160']]))
            ->assertStatus(422)
            ->assertJsonPath('error.code', 'INSUFFICIENT_STOCK')
            ->assertJsonPath('error.details.available', '1.000');
    }

    public function test_serial_numbers_are_captured_once_per_unit(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $phone = $this->sellable($org, 'Phone X', '20000.00', ['serials' => true]);
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $this->stockUp($store, $phone, '5', '15000.00');

        $this->checkout($this->cart($store, [[$phone, '2', ['serials' => ['IMEI-1']]]], [['card', '40000']]))
            ->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['lines.0.serials']]]);
        $this->checkout($this->cart($store, [[$phone, '2', ['serials' => ['IMEI-1', 'imei-1']]]], [['card', '40000']]))
            ->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['lines.0.serials']]]);

        $sale = $this->checkout($this->cart($store, [[$phone, '2', ['serials' => ['IMEI-1', 'IMEI-2']]]], [['card', '40000']]))
            ->assertCreated()
            ->assertJsonPath('data.lines.0.serials', ['IMEI-1', 'IMEI-2'])
            ->json('data');

        $this->checkout($this->cart($store, [[$phone, '1', ['serials' => ['imei-2']]]], [['card', '20000']]))
            ->assertStatus(422)->assertJsonPath('error.details', ['lines.0.serials' => ['Already sold: IMEI-2.']]);

        // Cancelling the sale releases the serials.
        $this->postJson("/api/v1/sales/{$sale['id']}/cancel", ['reason' => 'Wrong model'])->assertOk();
        $this->checkout($this->cart($store, [[$phone, '1', ['serials' => ['IMEI-2']]]], [['card', '20000']]))->assertCreated();
    }

    public function test_sales_of_other_organizations_and_branches_are_invisible(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $juice = $this->sellable($org, 'Juice', '15.00');
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $this->stockUp($store, $juice, '5');
        $saleId = $this->checkout($this->cart($store, [[$juice, '1']], [['cash', '15']]))->json('data.id');

        $north = $this->createBranch($org, 'NORTH');
        $northCashier = $this->createUserWithRole($org, SystemRole::Cashier, [$north->id]);
        $this->actingAsUser($northCashier);
        $this->getJson("/api/v1/sales/{$saleId}")->assertNotFound();
        $this->assertSame([], $this->getJson('/api/v1/sales')->assertOk()->json('data'));
        $this->checkout($this->cart($store, [[$juice, '1']], [['cash', '15']]), openSession: false)->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['store_id']]]);

        ['admin' => $stranger] = $this->provisionTenant('Other Shop');
        $this->actingAsUser($stranger);
        $this->getJson("/api/v1/sales/{$saleId}")->assertNotFound();
    }
}
