<?php

namespace App\Modules\Sales\Tests\Feature;

use App\Modules\Payments\Infrastructure\Models\Payment;
use App\Modules\Sales\Tests\Concerns\InteractsWithSales;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * Accounts receivable: collecting dues, statements, and the payments ledger behind them.
 */
class CustomerPaymentTest extends TestCase
{
    use InteractsWithSales, InteractsWithTenancy, RefreshDatabase;

    public function test_collections_reduce_the_balance_and_never_exceed_it(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $tv = $this->sellable($org, 'TV', '1000.00');
        $store = $this->mainStoreId($org);
        $customer = $this->customer($org, 'Rina', creditLimit: '5000', openingBalance: '100');
        $this->actingAsUser($admin);
        $this->stockUp($store, $tv, '5');
        $this->checkout($this->cart($store, [[$tv, '1']], [['cash', '300']], ['customer_id' => $customer->id]))->assertCreated();

        // Owes 100 opening + 700 due.
        $this->collect(['customer_id' => $customer->id, 'branch_id' => $branch->id, 'amount' => '800.01', 'method' => 'cash'])
            ->assertStatus(422)->assertJsonPath('error.code', 'PAYMENT_EXCEEDS_BALANCE')->assertJsonPath('error.details.outstanding', '800.00');
        $this->collect(['customer_id' => $customer->id, 'branch_id' => $branch->id, 'amount' => '500', 'method' => 'bank_transfer', 'reference' => 'TRX-1'])
            ->assertCreated()
            ->assertJsonPath('data.number', 'RCP-000001')
            ->assertJsonPath('data.method_label', 'Bank transfer')
            ->assertJsonPath('data.customer.name', 'Rina');
        $this->collect(['customer_id' => $customer->id, 'branch_id' => $branch->id, 'amount' => '200', 'method' => 'cash'])->assertCreated();
        $this->getJson("/api/v1/sales/customer-balances?customer_ids[]={$customer->id}")->assertJsonPath("data.{$customer->id}", '100.00');

        $ledger = Payment::query()->where('source_type', 'customer_payment')->orderBy('amount')->get();
        $this->assertSame([['cash', '200.00'], ['bank_transfer', '500.00']], $ledger->map(fn (Payment $p) => [$p->method->value, $p->amount])->all());
        $this->assertNotNull($ledger[0]->cash_register_session_id, 'cash goes into the drawer');
        $this->assertSame($customer->id, $ledger[1]->customer_id);
        $this->getJson("/api/v1/payments?customer_id={$customer->id}")->assertOk()->assertJsonPath('meta.totals.in', '1000.00');

        $statement = $this->getJson("/api/v1/customers/{$customer->id}/statement")->assertOk()->json('data');
        $this->assertSame('100.00', $statement['opening_balance']);
        $this->assertSame(['sale', 'sale_payment', 'payment', 'payment'], array_column($statement['entries'], 'type'));
        $this->assertSame(['1100.00', '800.00', '300.00', '100.00'], array_column($statement['entries'], 'balance'));
        $this->assertSame('100.00', $statement['closing_balance']);
    }

    public function test_cash_collections_need_an_open_session_and_the_permission(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $customer = $this->customer($org, 'Rina', openingBalance: '300');
        $this->actingAsUser($admin);

        $this->collect(['customer_id' => $customer->id, 'branch_id' => $branch->id, 'amount' => '50', 'method' => 'cash'])
            ->assertStatus(422)->assertJsonPath('error.code', 'CASH_SESSION_REQUIRED');
        $this->collect(['customer_id' => $customer->id, 'branch_id' => $branch->id, 'amount' => '50', 'method' => 'card'])->assertCreated();

        $accountant = $this->createUserWithRole($org, SystemRole::InventoryManager, [$branch->id]);
        $this->actingAsUser($accountant);
        $this->collect(['customer_id' => $customer->id, 'branch_id' => $branch->id, 'amount' => '50', 'method' => 'card'])->assertForbidden();
        $this->getJson("/api/v1/customers/{$customer->id}/statement")->assertForbidden();

        ['admin' => $stranger, 'branch' => $theirBranch] = $this->provisionTenant('Other Shop');
        $this->actingAsUser($stranger);
        $this->collect(['customer_id' => $customer->id, 'branch_id' => $theirBranch->id, 'amount' => '50', 'method' => 'card'])
            ->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['customer_id']]]);
        $this->getJson("/api/v1/customers/{$customer->id}/statement")->assertNotFound();
    }

    public function test_every_checkout_needs_an_open_session_and_feeds_the_ledger(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $soap = $this->sellable($org, 'Soap', '10.00');
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $this->stockUp($store, $soap, '10');

        $this->checkout($this->cart($store, [[$soap, '1']], [['card', '10']]), openSession: false)
            ->assertStatus(422)->assertJsonPath('error.code', 'CASH_SESSION_REQUIRED');
        $this->assertSame('10.000', $this->stockRow($soap->id, $store)['quantity']);

        $session = $this->openSession($admin, $branch->id, '20.00');
        $sale = $this->checkout($this->cart($store, [[$soap, '3']], [['card', '10'], ['cash', '50']]))->assertCreated()->json('data');
        $this->getJson("/api/v1/register-sessions/{$session->id}")
            ->assertOk()
            ->assertJsonPath('data.cash.expected', '40.00')
            ->assertJsonPath('data.by_source.0.source_type', 'sale');

        $this->postJson("/api/v1/sales/{$sale['id']}/cancel", ['reason' => 'Mistake'])->assertOk();
        $this->getJson("/api/v1/register-sessions/{$session->id}")->assertOk()->assertJsonPath('data.cash.expected', '20.00');
        $this->assertSame(2, Payment::query()->where('source_type', 'sale_cancellation')->count());
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function collect(array $payload): TestResponse
    {
        return $this->postJson('/api/v1/customer-payments', $payload, ['Idempotency-Key' => (string) Str::uuid()]);
    }
}
