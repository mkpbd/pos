<?php

namespace App\Modules\Sales\Tests\Feature;

use App\Modules\Branches\Infrastructure\Models\Store;
use App\Modules\Customers\Infrastructure\Models\Customer;
use App\Modules\Organizations\Infrastructure\Models\Organization;
use App\Modules\Payments\Infrastructure\Models\Payment;
use App\Modules\Pos\Infrastructure\Models\PosApproval;
use App\Modules\Products\Infrastructure\Models\ProductVariant;
use App\Modules\Sales\Infrastructure\Models\Sale;
use App\Modules\Sales\Infrastructure\Models\SalePayment;
use App\Modules\Sales\Infrastructure\Models\SaleReturn;
use App\Modules\Sales\Tests\Concerns\InteractsWithSales;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * POS1c §1: exchanges at the till — the return and the new sale in one transaction, the
 * returned value paying the new sale, the difference paid or refunded.
 */
class ExchangeTest extends TestCase
{
    use InteractsWithSales, InteractsWithTenancy, RefreshDatabase;

    private Organization $org;

    private User $admin;

    private User $cashier;

    private User $manager;

    private string $branchId;

    private string $store;

    private ProductVariant $shirt;

    private ProductVariant $shirtL;

    private ProductVariant $jeans;

    private ProductVariant $socks;

    protected function setUp(): void
    {
        parent::setUp();
        ['admin' => $this->admin, 'organization' => $this->org, 'branch' => $branch] = $this->provisionTenant();
        $this->branchId = $branch->id;
        $this->store = $this->mainStoreId($this->org);
        $this->cashier = $this->createUserWithRole($this->org, SystemRole::Cashier, [$branch->id]);
        $this->manager = $this->createUserWithRole($this->org, SystemRole::BranchManager, [$branch->id]);
        $this->shirt = $this->sellable($this->org, 'Shirt M', '500.00');
        $this->shirtL = $this->sellable($this->org, 'Shirt L', '500.00');
        $this->jeans = $this->sellable($this->org, 'Jeans', '800.00');
        $this->socks = $this->sellable($this->org, 'Socks', '100.00');
        $this->actingAsUser($this->admin);
        foreach ([$this->shirt, $this->shirtL, $this->jeans, $this->socks] as $variant) {
            $this->stockUp($this->store, $variant, '10');
        }
    }

    public function test_an_even_exchange_needs_no_payment_and_links_both_documents(): void
    {
        $sale = $this->checkout($this->cart($this->store, [[$this->shirt, '1']], [['cash', '500']]))->assertCreated()->json('data');

        $result = $this->exchange($this->payload($sale, [[$this->shirt, '1']], [[$this->shirtL, '1']]))
            ->assertCreated()
            ->assertJsonPath('data.sale.total', '500.00')
            ->assertJsonPath('data.sale.paid_total', '500.00')
            ->assertJsonPath('data.sale.due_total', '0.00')
            ->assertJsonPath('data.sale.change_total', '0.00')
            ->assertJsonCount(1, 'data.sale.payments')
            ->assertJsonPath('data.sale.payments.0.method', 'exchange')
            ->assertJsonPath('data.sale.payments.0.method_label', 'Exchange')
            ->assertJsonPath('data.sale.payments.0.amount', '500.00')
            ->assertJsonPath('data.sale.payments.0.reference', 'RET-MAIN-000001')
            ->assertJsonPath('data.return.number', 'RET-MAIN-000001')
            ->assertJsonPath('data.return.status', 'completed')
            ->assertJsonPath('data.return.total', '500.00')
            ->assertJsonPath('data.return.refunded_total', '500.00')
            ->assertJsonCount(1, 'data.return.refunds')
            ->assertJsonPath('data.return.refunds.0.method', 'exchange')
            ->assertJsonPath('data.return.refunds.0.amount', '500.00')
            ->assertJsonPath('data.credit_note', null)
            ->json('data');

        // The return's exchange refund names the new sale; the sale's exchange payment names the return.
        $this->assertSame($result['sale']['number'], $result['return']['refunds'][0]['reference']);
        $return = SaleReturn::query()->withoutGlobalScopes()->findOrFail($result['return']['id']);
        $this->assertSame($result['sale']['id'], $return->exchange_sale_id);
        $this->assertSame($sale['id'], $return->sale_id);
        // Value moved between documents: nothing in the payments ledger.
        $this->assertSame(0, Payment::query()->withoutGlobalScopes()->whereIn('source_id', [$result['sale']['id'], $return->id])->count());
        $this->assertSame('10.000', $this->stockRow($this->shirt->id, $this->store)['quantity']);
        $this->assertSame('9.000', $this->stockRow($this->shirtL->id, $this->store)['quantity']);

        $audit = $this->getJson('/api/v1/audit-logs?action=sale.exchanged')->assertOk()->assertJsonCount(1, 'data')->json('data.0');
        $this->assertEquals(['sale' => $result['sale']['number'], 'return' => 'RET-MAIN-000001', 'original_sale' => $sale['number'], 'value' => '500.00', 'applied' => '500.00'], $audit['new_values']);
        $this->getJson('/api/v1/audit-logs?action=sale_return.completed')->assertOk()->assertJsonCount(1, 'data');

        // The original invoice keeps its completed return; it can no longer be cancelled.
        $this->postJson("/api/v1/sales/{$sale['id']}/cancel", ['reason' => 'x'])->assertStatus(422)->assertJsonPath('error.code', 'SALE_HAS_RETURNS');
    }

    public function test_the_customer_pays_the_difference_with_any_till_method(): void
    {
        $sale = $this->checkout($this->cart($this->store, [[$this->socks, '3']], [['card', '300']]))->assertCreated()->json('data');

        // Return one pair (100), take jeans (800): 700 to pay — cash with change.
        $result = $this->exchange($this->payload($sale, [[$this->socks, '1']], [[$this->jeans, '1']], [['cash', '1000']]))
            ->assertCreated()
            ->assertJsonPath('data.sale.total', '800.00')
            ->assertJsonPath('data.sale.paid_total', '800.00')
            ->assertJsonPath('data.sale.change_total', '300.00')
            ->assertJsonPath('data.sale.payments.0.method', 'exchange')
            ->assertJsonPath('data.sale.payments.0.amount', '100.00')
            ->assertJsonPath('data.sale.payments.1.method', 'cash')
            ->assertJsonPath('data.sale.payments.1.amount', '700.00')
            ->assertJsonPath('data.return.refunds.0.method', 'exchange')
            ->assertJsonPath('data.return.refunds.0.amount', '100.00')
            ->json('data');
        $this->assertSame([['in', 'cash', '700.00']], $this->ledger($result['sale']['id']));
        $this->assertSame([], $this->ledger($result['return']['id']));

        // A card may not over-pay; card for the exact difference works.
        $this->exchange($this->payload($sale, [[$this->socks, '1']], [[$this->jeans, '1']], [['card', '701']]))
            ->assertStatus(422)->assertJsonPath('error.code', 'NON_CASH_OVERPAYMENT');
        $this->exchange($this->payload($sale, [[$this->socks, '1']], [[$this->jeans, '1']], [['card', '700']]))
            ->assertCreated()->assertJsonPath('data.sale.payments.1.method', 'card');

        // A gift card pays the rest.
        $card = $this->postJson('/api/v1/gift-cards/vouchers', ['amount' => '1000', 'reason' => 'Prize'], ['Idempotency-Key' => (string) Str::uuid()])->assertCreated()->json('data.gift_card');
        $this->exchange($this->payload($sale, [[$this->socks, '1']], [[$this->jeans, '1']], [['gift_card', '700', $card['code']]]))
            ->assertCreated()
            ->assertJsonPath('data.sale.payments.1.method', 'gift_card')
            ->assertJsonPath('data.sale.payments.1.reference', 'Gift card ••••'.$card['code_last4']);
        $this->assertSame('300.00', $this->postJson('/api/v1/gift-cards/lookup', ['code' => $card['code']])->assertOk()->json('data.balance'));

        // Walk-in invoice and nothing paid: the rest cannot stay due.
        $walkIn = $this->checkout($this->cart($this->store, [[$this->socks, '1']], [['cash', '100']]))->assertCreated()->json('data');
        $this->exchange($this->payload($walkIn, [[$this->socks, '1']], [[$this->jeans, '1']]))
            ->assertStatus(422)->assertJsonPath('error.code', 'CUSTOMER_REQUIRED');
    }

    public function test_the_difference_is_refunded_in_cash_store_credit_or_as_a_credit_note(): void
    {
        $rina = $this->customer($this->org, 'Rina');
        $sale = $this->checkout($this->cart($this->store, [[$this->jeans, '3']], [['cash', '2400']], ['customer_id' => $rina->id]))->assertCreated()->json('data');
        $this->actingAsUser($this->manager);
        $this->openSession($this->manager, $this->branchId, '1000.00');

        // Return jeans (800), take socks (100): 700 back.
        $this->exchange($this->payload($sale, [[$this->jeans, '1']], [[$this->socks, '1']], [], [['cash', '600']]))
            ->assertStatus(422)->assertJsonPath('error.code', 'REFUND_MISMATCH')->assertJsonPath('error.details.refund_due', '700.00');
        $this->exchange($this->payload($sale, [[$this->jeans, '1']], [[$this->socks, '1']], [], [['card', '700']]))
            ->assertStatus(422)->assertJsonValidationErrors(['refunds.0.method'], 'error.details');
        $result = $this->exchange($this->payload($sale, [[$this->jeans, '1']], [[$this->socks, '1']], [], [['cash', '700']]))
            ->assertCreated()
            ->assertJsonPath('data.sale.total', '100.00')
            ->assertJsonPath('data.sale.customer.id', $rina->id)
            ->assertJsonPath('data.sale.payments.0.method', 'exchange')
            ->assertJsonPath('data.sale.payments.0.amount', '100.00')
            ->assertJsonPath('data.return.refunded_total', '800.00')
            ->assertJsonPath('data.return.refunds.0.method', 'exchange')
            ->assertJsonPath('data.return.refunds.0.amount', '100.00')
            ->assertJsonPath('data.return.refunds.1.method', 'cash')
            ->assertJsonPath('data.return.refunds.1.amount', '700.00')
            ->json('data');
        $this->assertSame([['out', 'cash', '700.00']], $this->ledger($result['return']['id']));
        $this->assertSame([], $this->ledger($result['sale']['id']));
        $session = Payment::query()->withoutGlobalScopes()->where('source_id', $result['return']['id'])->value('cash_register_session_id');
        $this->getJson("/api/v1/register-sessions/{$session}")->assertOk()->assertJsonPath('data.cash.expected', '300.00');

        // More cash than the drawer holds.
        $this->exchange($this->payload($sale, [[$this->jeans, '1']], [[$this->socks, '1']], [], [['cash', '700']]))
            ->assertStatus(422)->assertJsonPath('error.code', 'INSUFFICIENT_CASH');

        // To store credit (the invoice has a customer).
        $this->exchange($this->payload($sale, [[$this->jeans, '1']], [[$this->socks, '1']], [], [['store_credit', '700']]))
            ->assertCreated()->assertJsonPath('data.return.refunds.1.method', 'store_credit')->assertJsonPath('data.credit_note', null);
        $this->getJson("/api/v1/customers/{$rina->id}/store-credit")->assertOk()->assertJsonPath('data.balance', '700.00');

        // As a credit note, its code shown once (and in an idempotent replay of the same request).
        $key = (string) Str::uuid();
        $payload = $this->payload($sale, [[$this->jeans, '1']], [[$this->socks, '1']], [], [['gift_card', '700']]);
        $note = $this->exchange($payload, $key)
            ->assertCreated()
            ->assertJsonPath('data.credit_note.amount', '700.00')
            ->assertJsonPath('data.return.refunds.1.method', 'gift_card')
            ->json('data');
        $this->assertNotEmpty($note['credit_note']['code']);
        $this->assertSame($note, $this->exchange($payload, $key)->assertCreated()->json('data'));
        $this->getJson("/api/v1/returns/{$note['return']['id']}")->assertOk()->assertJsonPath('data.credit_note', null);
        $this->assertSame('700.00', $this->postJson('/api/v1/gift-cards/lookup', ['code' => $note['credit_note']['code']])->assertOk()->json('data.balance'));
        $this->assertSame(3, Sale::query()->withoutGlobalScopes()->where('total', '100.00')->count(), 'the replay made no new sale');
    }

    public function test_what_the_customer_still_owes_on_the_invoice_is_credited_first(): void
    {
        $rina = $this->customer($this->org, 'Rina', creditLimit: '5000');
        // 2 × 800 = 1600; 1100 paid, 500 due.
        $sale = $this->checkout($this->cart($this->store, [[$this->jeans, '2']], [['cash', '1100']], ['customer_id' => $rina->id]))->assertCreated()->json('data');

        // Return one pair (800): 500 against the due, V = 300; take socks (100): 200 back in cash.
        $result = $this->exchange($this->payload($sale, [[$this->jeans, '1']], [[$this->socks, '1']], [], [['cash', '200']]))
            ->assertCreated()
            ->assertJsonPath('data.return.credited_total', '500.00')
            ->assertJsonPath('data.return.refunded_total', '300.00')
            ->assertJsonPath('data.return.refunds.0.method', 'exchange')
            ->assertJsonPath('data.return.refunds.0.amount', '100.00')
            ->assertJsonPath('data.sale.payments.0.amount', '100.00')
            ->json('data');
        $this->getJson("/api/v1/sales/customer-balances?customer_ids[]={$rina->id}")->assertJsonPath("data.{$rina->id}", '0.00');
        $this->assertSame('100.00', $result['sale']['paid_total']);

        // Nothing left to credit or refund: the whole new sale is paid by the customer.
        $sale2 = $this->checkout($this->cart($this->store, [[$this->jeans, '1']], [], ['customer_id' => $rina->id]))->assertCreated()->json('data');
        $this->exchange($this->payload($sale2, [[$this->jeans, '1']], [[$this->socks, '2']], [['cash', '200']]))
            ->assertCreated()
            ->assertJsonPath('data.return.credited_total', '800.00')
            ->assertJsonPath('data.return.refunded_total', '0.00')
            ->assertJsonCount(0, 'data.return.refunds')
            ->assertJsonCount(1, 'data.sale.payments')
            ->assertJsonPath('data.sale.payments.0.method', 'cash');
    }

    public function test_serial_items_and_batches_go_back_and_out_exactly(): void
    {
        $phone = $this->sellable($this->org, 'Phone', '20000.00', ['serials' => true]);
        $syrup = $this->sellable($this->org, 'Syrup', '100.00', ['batches' => true]);
        $this->stockUp($this->store, $phone, '2', '15000.00');
        $this->stockUp($this->store, $syrup, '2', '40.00', 'OLD', now()->addMonth()->toDateString());
        $this->stockUp($this->store, $syrup, '5', '50.00', 'NEW', now()->addYear()->toDateString());
        $sale = $this->checkout($this->cart($this->store, [[$phone, '1', ['serials' => ['IMEI-1']]], [$syrup, '2']], [['card', '20200']]))->assertCreated()->json('data');

        // The phone with IMEI-1 comes back, IMEI-2 goes out; one syrup back to OLD, one sold again (FEFO: OLD).
        $payload = $this->payload($sale, [], [[$phone, '1', ['serials' => ['IMEI-2']]], [$syrup, '1']]);
        $payload['return']['lines'] = [
            ['sale_line_id' => $sale['lines'][0]['id'], 'quantity' => '1'],
            ['sale_line_id' => $sale['lines'][1]['id'], 'quantity' => '1'],
        ];
        $this->exchange($payload)->assertStatus(422)->assertJsonValidationErrors(['return.lines.0.serials'], 'error.details');
        $payload['return']['lines'][0]['serials'] = ['IMEI-1'];
        $result = $this->exchange($payload)
            ->assertCreated()
            ->assertJsonPath('data.return.lines.0.serials', ['IMEI-1'])
            ->assertJsonPath('data.return.lines.1.batches.0.batch_number', 'OLD')
            ->assertJsonPath('data.sale.lines.0.serials', ['IMEI-2'])
            ->assertJsonPath('data.sale.total', '20100.00')
            ->json('data');
        $this->assertSame('20100.00', $result['sale']['payments'][0]['amount']);

        $this->assertSame('1.000', $this->stockRow($phone->id, $this->store)['quantity']);
        $this->assertSame('5.000', $this->stockRow($syrup->id, $this->store)['quantity']);
        // ST2d: the exchange goes through the return and checkout paths of the serial register.
        $this->assertSame(['in_stock', $this->store], $this->serialRow('IMEI-1'));
        $this->assertSame(['sold', 'returned'], $this->serialEvents('IMEI-1'));
        $this->assertSame(['sold', null], $this->serialRow('IMEI-2'));
        $batches = collect($this->getJson("/api/v1/inventory/movements?variant_id={$syrup->id}")->json('data'))->groupBy('type')->map->count()->all();
        $this->assertSame(2, $batches['sale'] ?? 0);
        $this->assertSame(1, $batches['sale_return'] ?? 0);

        // IMEI-1 is sellable again; IMEI-2 is out.
        $this->checkout($this->cart($this->store, [[$phone, '1', ['serials' => ['IMEI-2']]]], [['card', '20000']]))->assertStatus(422);
        $this->checkout($this->cart($this->store, [[$phone, '1', ['serials' => ['IMEI-1']]]], [['card', '20000']]))->assertCreated();
    }

    public function test_loyalty_is_reversed_on_the_return_and_earned_on_the_new_sale(): void
    {
        $this->putJson('/api/v1/loyalty/settings', ['is_enabled' => true, 'spend_amount' => '100', 'points_per_spend' => 1, 'point_value' => '1.00'])->assertOk();
        $rina = $this->customer($this->org, 'Rina');
        $sale = $this->checkout($this->cart($this->store, [[$this->jeans, '1']], [['cash', '800']], ['customer_id' => $rina->id]))->assertCreated()->json('data');
        $this->assertSame(8, $this->points($rina));

        // The customer is the invoice's when none is sent.
        $this->exchange($this->payload($sale, [[$this->jeans, '1']], [[$this->shirt, '1']], [], [['cash', '300']]))
            ->assertCreated()->assertJsonPath('data.sale.customer.id', $rina->id);
        $this->assertSame(5, $this->points($rina));
    }

    public function test_a_cashier_needs_a_managers_approval_for_that_invoice(): void
    {
        $sale = $this->checkout($this->cart($this->store, [[$this->shirt, '2']], [['cash', '1000']]))->assertCreated()->json('data');
        $other = $this->checkout($this->cart($this->store, [[$this->shirt, '1']], [['cash', '500']]))->assertCreated()->json('data');
        $this->actingAsUser($this->cashier);
        $payload = $this->payload($sale, [[$this->shirt, '1']], [[$this->shirtL, '1']]);

        $this->exchange($payload)->assertStatus(422)->assertJsonPath('error.code', 'APPROVAL_REQUIRED')->assertJsonPath('error.details.action', 'return');
        $this->exchange($payload + ['approval_id' => $this->approval($other['id'])])->assertStatus(422)->assertJsonPath('error.code', 'APPROVAL_INVALID');
        $this->exchange($payload + ['approval_id' => $this->approval($sale['id'], requester: $this->manager)])->assertStatus(422)->assertJsonPath('error.code', 'APPROVAL_INVALID');
        $this->assertSame(0, SaleReturn::query()->withoutGlobalScopes()->count());

        $approval = $this->approval($sale['id']);
        $result = $this->exchange($payload + ['approval_id' => $approval])->assertCreated()->json('data');
        $used = PosApproval::query()->withoutGlobalScopes()->findOrFail($approval);
        $this->assertNotNull($used->used_at);
        $this->assertSame($result['sale']['id'], $used->sale_id);

        // Used once.
        $this->exchange($payload + ['approval_id' => $approval])->assertStatus(422)->assertJsonPath('error.code', 'APPROVAL_INVALID');
        $this->assertSame(1, SaleReturn::query()->withoutGlobalScopes()->count());
    }

    public function test_only_completed_invoices_of_the_tills_branch_within_what_can_be_returned(): void
    {
        $sale = $this->checkout($this->cart($this->store, [[$this->shirt, '1']], [['cash', '500']]))->assertCreated()->json('data');

        $this->exchange($this->payload($sale, [[$this->shirt, '2']], [[$this->shirtL, '1']]))
            ->assertStatus(422)->assertJsonPath('error.details', ['return.lines.0.quantity' => ['Only 1.000 can still be returned.']]);
        $this->exchange($this->payload($sale, [], [[$this->shirtL, '1']]))
            ->assertStatus(422)->assertJsonValidationErrors(['return.lines'], 'error.details');
        $this->exchange($this->payload($sale, [[$this->shirt, '1']], []))
            ->assertStatus(422)->assertJsonValidationErrors(['lines'], 'error.details');

        // A till of another branch.
        $north = $this->createBranch($this->org, 'NORTH');
        $northStore = $this->inTenant($this->org, fn () => Store::query()->where('branch_id', $north->id)->firstOrFail()->id);
        $this->stockUp($northStore, $this->shirtL, '5');
        $this->exchange(['store_id' => $northStore] + $this->payload($sale, [[$this->shirt, '1']], [[$this->shirtL, '1']]))
            ->assertStatus(422)->assertJsonPath('error.code', 'EXCHANGE_OTHER_BRANCH');

        $cancelled = $this->checkout($this->cart($this->store, [[$this->shirt, '1']], [['cash', '500']]))->assertCreated()->json('data');
        $this->postJson("/api/v1/sales/{$cancelled['id']}/cancel", ['reason' => 'Mistake'])->assertOk();
        $this->exchange($this->payload($cancelled, [[$this->shirt, '1']], [[$this->shirtL, '1']]))
            ->assertStatus(422)->assertJsonPath('error.code', 'SALE_CANCELLED');

        $this->assertSame(0, SaleReturn::query()->withoutGlobalScopes()->count());
    }

    public function test_exchange_is_never_accepted_from_clients(): void
    {
        $sale = $this->checkout($this->cart($this->store, [[$this->jeans, '1']], [['cash', '800']]))->assertCreated()->json('data');

        $this->checkout($this->cart($this->store, [[$this->socks, '1']], [['exchange', '100']]))
            ->assertStatus(422)->assertJsonValidationErrors(['payments.0.method'], 'error.details');
        $this->postJson('/api/v1/returns', ['sale_id' => $sale['id'], 'lines' => [['sale_line_id' => $sale['lines'][0]['id'], 'quantity' => '1']], 'refunds' => [['method' => 'exchange', 'amount' => '800']]], ['Idempotency-Key' => (string) Str::uuid()])
            ->assertStatus(422)->assertJsonValidationErrors(['refunds.0.method'], 'error.details');
        $this->exchange($this->payload($sale, [[$this->jeans, '1']], [[$this->socks, '1']], [['exchange', '100']]))
            ->assertStatus(422)->assertJsonValidationErrors(['payments.0.method'], 'error.details');
        $this->exchange($this->payload($sale, [[$this->jeans, '1']], [[$this->socks, '1']], [], [['exchange', '700']]))
            ->assertStatus(422)->assertJsonValidationErrors(['refunds.0.method'], 'error.details');
        $this->assertSame(0, SaleReturn::query()->withoutGlobalScopes()->count());
        $this->assertSame(0, SalePayment::query()->withoutGlobalScopes()->where('method', 'exchange')->count());
    }

    public function test_a_failure_in_the_sale_half_rolls_the_return_back(): void
    {
        $sale = $this->checkout($this->cart($this->store, [[$this->shirt, '1']], [['cash', '500']]))->assertCreated()->json('data');

        $this->exchange($this->payload($sale, [[$this->shirt, '1']], [[$this->jeans, '50']], [['cash', '50000']]))
            ->assertStatus(422)->assertJsonPath('error.code', 'INSUFFICIENT_STOCK');

        $this->assertSame(0, SaleReturn::query()->withoutGlobalScopes()->count());
        $this->assertSame(1, Sale::query()->withoutGlobalScopes()->count());
        $this->assertSame('9.000', $this->stockRow($this->shirt->id, $this->store)['quantity']);
        $this->getJson("/api/v1/sales/{$sale['id']}")->assertOk()->assertJsonPath('data.lines.0.returned_quantity', '0.000');
    }

    public function test_idempotent_replays_and_tenant_isolation(): void
    {
        $sale = $this->checkout($this->cart($this->store, [[$this->shirt, '1']], [['cash', '500']]))->assertCreated()->json('data');
        $payload = $this->payload($sale, [[$this->shirt, '1']], [[$this->socks, '1']], [], [['cash', '400']]);
        $key = (string) Str::uuid();

        $first = $this->exchange($payload, $key)->assertCreated()->json('data');
        $this->assertSame($first, $this->exchange($payload, $key)->assertCreated()->json('data'));
        $this->assertSame(1, SaleReturn::query()->withoutGlobalScopes()->count());
        $this->assertSame(2, Sale::query()->withoutGlobalScopes()->count());

        ['admin' => $stranger, 'organization' => $otherOrg] = $this->provisionTenant('Other Shop');
        $otherStore = $this->mainStoreId($otherOrg);
        $this->actingAsUser($stranger);
        $socks = $this->sellable($otherOrg, 'Socks', '100.00');
        $this->stockUp($otherStore, $socks, '5');
        $foreign = ['store_id' => $otherStore, 'lines' => [['variant_id' => $socks->id, 'quantity' => '1']]] + $payload;
        $this->exchange($foreign)->assertStatus(422)->assertJsonValidationErrors(['return.sale_id'], 'error.details');
        $this->exchange($payload)->assertStatus(422)->assertJsonValidationErrors(['store_id'], 'error.details');
        $this->assertSame(1, SaleReturn::query()->withoutGlobalScopes()->count());
    }

    /**
     * The exchange body: the invoice's lines coming back (by variant), the new cart, payments and refunds.
     *
     * @param  array<string, mixed>  $sale
     * @param  list<array{0: ProductVariant, 1: string}>  $returned
     * @param  list<array{0: ProductVariant, 1: string}|array{0: ProductVariant, 1: string, 2: array<string, mixed>}>  $lines
     * @param  list<array{0: string, 1: string, 2?: string}>  $payments
     * @param  list<array{0: string, 1: string}>  $refunds
     * @return array<string, mixed>
     */
    private function payload(array $sale, array $returned, array $lines, array $payments = [], array $refunds = []): array
    {
        $saleLines = collect($sale['lines'])->keyBy('variant_id');
        $payload = $this->cart($this->store, $lines, array_map(fn (array $p) => [$p[0], $p[1]], $payments));
        foreach ($payments as $i => $p) {
            if (isset($p[2])) {
                $payload['payments'][$i]['reference'] = $p[2];
            }
        }

        return $payload + [
            'return' => [
                'sale_id' => $sale['id'],
                'lines' => array_map(fn (array $r) => ['sale_line_id' => $saleLines[$r[0]->id]['id'], 'quantity' => $r[1]], $returned),
            ],
            'refunds' => array_map(fn (array $r) => ['method' => $r[0], 'amount' => $r[1]], $refunds),
        ];
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function exchange(array $payload, ?string $key = null): TestResponse
    {
        $user = auth()->user();
        if ($user instanceof User && $user->organization_id === $this->org->id) {
            $this->openSession($user, $this->branchId);
        }

        return $this->postJson('/api/v1/pos/exchanges', $payload, ['Idempotency-Key' => $key ?? (string) Str::uuid()]);
    }

    private function approval(string $saleId, ?User $requester = null): string
    {
        return $this->inTenant($this->org, fn () => PosApproval::query()->create([
            'organization_id' => $this->org->id,
            'store_id' => $this->store,
            'action' => 'return',
            'approver_id' => $this->manager->id,
            'requester_id' => ($requester ?? $this->cashier)->id,
            'details' => ['sale_id' => $saleId],
            'expires_at' => now()->addMinutes(10),
            'created_at' => now(),
        ]))->id;
    }

    /**
     * @return list<array{0: string, 1: string, 2: string}>
     */
    private function ledger(string $sourceId): array
    {
        return Payment::query()->withoutGlobalScopes()->where('source_id', $sourceId)->orderBy('created_at')->get()
            ->map(fn (Payment $p) => [$p->direction->value, $p->method->value, $p->amount])->all();
    }

    private function points(Customer $customer): int
    {
        return (int) $this->getJson("/api/v1/loyalty/balances?customer_ids[]={$customer->id}")->assertOk()->json("data.{$customer->id}");
    }
}
