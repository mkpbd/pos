<?php

namespace App\Modules\StoredValue\Tests\Feature;

use App\Modules\Customers\Infrastructure\Models\Customer;
use App\Modules\Payments\Infrastructure\Models\Payment;
use App\Modules\Sales\Application\Contracts\StoreCredit;
use App\Modules\Sales\Infrastructure\Models\SalePayment;
use App\Modules\Sales\Tests\Concerns\InteractsWithSales;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\StoredValue\Infrastructure\Models\StoreCreditEntry;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * POS1b §3: paying a sale with store credit / a gift card, cancelling it, and refunding a
 * return to store credit or as a credit note. Neither touches the payments ledger.
 */
class StoredValuePaymentsTest extends TestCase
{
    use InteractsWithSales, InteractsWithTenancy, RefreshDatabase;

    public function test_a_sale_is_paid_partly_with_store_credit_and_cancelling_gives_it_back(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $rice = $this->sellable($org, 'Rice', '100.00');
        $store = $this->mainStoreId($org);
        $rina = $this->customer($org, 'Rina');
        $this->actingAsUser($admin);
        $this->stockUp($store, $rice, '100');
        $this->adjustCredit($rina, '150');

        // No customer, too much, more than due: refused and nothing spent.
        $this->checkout($this->cart($store, [[$rice, '2']], [['store_credit', '50'], ['cash', '150']]))
            ->assertStatus(422)->assertJsonPath('error.code', 'CUSTOMER_REQUIRED');
        $this->checkout($this->cart($store, [[$rice, '2']], [['store_credit', '150.01'], ['cash', '49.99']], ['customer_id' => $rina->id]))
            ->assertStatus(422)->assertJsonPath('error.code', 'INSUFFICIENT_STORE_CREDIT')->assertJsonPath('error.details.balance', '150.00');
        $this->checkout($this->cart($store, [[$rice, '1']], [['store_credit', '120']], ['customer_id' => $rina->id]))
            ->assertStatus(422)->assertJsonPath('error.code', 'NON_CASH_OVERPAYMENT');
        $this->assertSame('150.00', $this->balance($rina));

        $payload = $this->cart($store, [[$rice, '2']], [['store_credit', '120'], ['cash', '100']], ['customer_id' => $rina->id]);
        $payload['payments'][0]['reference'] = 'ignored';
        $sale = $this->checkout($payload)
            ->assertCreated()
            ->assertJsonPath('data.payments.0.reference', null)
            ->assertJsonPath('data.paid_total', '200.00')
            ->assertJsonPath('data.change_total', '20.00')
            ->assertJsonPath('data.payments.0.method', 'store_credit')
            ->assertJsonPath('data.payments.0.method_label', 'Store credit')
            ->assertJsonPath('data.payments.0.amount', '120.00')
            ->assertJsonPath('data.payments.1.amount', '80.00')
            ->assertJsonPath('data.receipt.customer_store_credit_balance', '30.00')
            ->json('data');
        $this->assertSame('30.00', $this->balance($rina));
        // Only the cash is money in the ledger.
        $this->assertSame(['cash'], Payment::query()->where('source_id', $sale['id'])->pluck('method')->map(fn ($m) => $m->value)->all());
        $entry = StoreCreditEntry::query()->where('type', 'sale_payment')->firstOrFail();
        $this->assertSame('-120.00', $entry->amount);
        $this->assertSame($sale['number'], $entry->reference_number);

        $this->getJson("/api/v1/sales/{$sale['id']}")->assertOk()->assertJsonPath('data.receipt.customer_store_credit_balance', '30.00');

        $this->postJson("/api/v1/sales/{$sale['id']}/cancel", ['reason' => 'Mistake'])->assertOk();
        $this->assertSame('150.00', $this->balance($rina));
        $this->assertSame(['cash'], Payment::query()->where('source_type', 'sale_cancellation')->pluck('method')->map(fn ($m) => $m->value)->all());

        // Reversal is idempotent.
        $this->inTenant($org, fn () => app(StoreCredit::class)->reverseSale($sale['id']));
        $this->assertSame('150.00', $this->balance($rina));
        $this->assertSame(1, StoreCreditEntry::query()->where('type', 'sale_reversal')->count());
    }

    public function test_store_credit_paid_part_still_earns_loyalty_points(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $rice = $this->sellable($org, 'Rice', '100.00');
        $store = $this->mainStoreId($org);
        $rina = $this->customer($org, 'Rina');
        $this->actingAsUser($admin);
        $this->stockUp($store, $rice, '10');
        $this->adjustCredit($rina, '300');
        $this->putJson('/api/v1/loyalty/settings', ['is_enabled' => true, 'spend_amount' => '100', 'points_per_spend' => 1, 'point_value' => '1.00'])->assertOk();

        $this->checkout($this->cart($store, [[$rice, '3']], [['store_credit', '300']], ['customer_id' => $rina->id]))->assertCreated();
        $this->getJson("/api/v1/loyalty/balances?customer_ids[]={$rina->id}")->assertJsonPath("data.{$rina->id}", 3);
    }

    public function test_a_gift_card_pays_part_of_a_sale_and_its_code_is_never_kept(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $rice = $this->sellable($org, 'Rice', '100.00');
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $this->stockUp($store, $rice, '100');
        $card = $this->postJson('/api/v1/gift-cards/vouchers', ['amount' => '150', 'reason' => 'Raffle prize'], ['Idempotency-Key' => (string) Str::uuid()])
            ->assertCreated()->json('data.gift_card');
        $code = $card['code'];

        $this->checkoutWith($store, [[$rice, '1']], [['method' => 'gift_card', 'amount' => '50']])
            ->assertStatus(422)->assertJsonValidationErrors(['payments.0.reference'], 'error.details');
        $this->checkoutWith($store, [[$rice, '1']], [['method' => 'gift_card', 'amount' => '50', 'reference' => 'ABCD-EFGH-JKLM-NPQR'], ['method' => 'cash', 'amount' => '50']])
            ->assertStatus(422)->assertJsonPath('error.code', 'GIFT_CARD_INVALID')->assertJsonPath('error.details.reason', 'not_found');
        $this->checkoutWith($store, [[$rice, '2']], [['method' => 'gift_card', 'amount' => '150.01', 'reference' => $code], ['method' => 'cash', 'amount' => '49.99']])
            ->assertStatus(422)->assertJsonPath('error.code', 'GIFT_CARD_INVALID')->assertJsonPath('error.details.reason', 'insufficient');

        // Walk-in sale: the gift card pays 120 (written lower-case, without dashes), cash the rest.
        $sale = $this->checkoutWith($store, [[$rice, '2']], [['method' => 'gift_card', 'amount' => '120', 'reference' => strtolower(str_replace('-', '', $code))], ['method' => 'cash', 'amount' => '80']])
            ->assertCreated()
            ->assertJsonPath('data.payments.0.method', 'gift_card')
            ->assertJsonPath('data.payments.0.method_label', 'Gift card')
            ->assertJsonPath('data.payments.0.reference', 'Gift card ••••'.$card['code_last4'])
            ->assertJsonPath('data.payments.0.gift_card_last4', $card['code_last4'])
            ->assertJsonPath('data.receipt.customer_store_credit_balance', null)
            ->json('data');
        $this->assertSame('30.00', $this->lookup($code)['balance']);
        $this->assertSame(['cash'], Payment::query()->where('source_id', $sale['id'])->pluck('method')->map(fn ($m) => $m->value)->all());
        $this->assertSame(0, SalePayment::query()->where('reference', 'like', '%'.substr(str_replace('-', '', $code), 0, 8).'%')->count());
        $this->assertStringNotContainsString(str_replace('-', '', $code), json_encode($this->getJson("/api/v1/sales/{$sale['id']}")->json()));

        $this->postJson("/api/v1/sales/{$sale['id']}/cancel", ['reason' => 'Mistake'])->assertOk();
        $this->assertSame('150.00', $this->lookup($code)['balance']);
    }

    public function test_returns_refund_to_store_credit_or_as_a_credit_note(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $rice = $this->sellable($org, 'Rice', '100.00');
        $store = $this->mainStoreId($org);
        $rina = $this->customer($org, 'Rina');
        $this->actingAsUser($admin);
        $this->stockUp($store, $rice, '100');

        // Paid in cash: the refund may still go to store credit (all of it) or a credit note.
        $sale = $this->checkout($this->cart($store, [[$rice, '4']], [['cash', '400']], ['customer_id' => $rina->id]))->assertCreated()->json('data');
        $line = $sale['lines'][0]['id'];
        $methods = collect($this->postJson('/api/v1/returns/preview', ['sale_id' => $sale['id'], 'lines' => [['sale_line_id' => $line, 'quantity' => '1']]])
            ->assertOk()->json('data.settlement.refundable'))->mapWithKeys(fn (array $r) => [$r['method'] => $r['max']])->all();
        $this->assertSame(['cash' => null, 'store_credit' => null, 'gift_card' => null], $methods);

        $this->returnOf($sale, $line, '2', [['method' => 'store_credit', 'amount' => '200']])
            ->assertCreated()
            ->assertJsonPath('data.status', 'completed')
            ->assertJsonPath('data.refunds.0.method', 'store_credit')
            ->assertJsonPath('data.refunds.0.method_label', 'Store credit')
            ->assertJsonPath('data.refunds.0.reference', null)
            ->assertJsonPath('data.credit_note', null);
        $this->assertSame('200.00', $this->balance($rina));
        $refund = StoreCreditEntry::query()->where('type', 'refund')->firstOrFail();
        $this->assertSame('sale_return', $refund->reference_type);

        $return = $this->returnOf($sale, $line, '1', [['method' => 'gift_card', 'amount' => '60'], ['method' => 'cash', 'amount' => '40']])
            ->assertCreated()
            ->assertJsonPath('data.credit_note.amount', '60.00')
            ->assertJsonPath('data.refunds.0.method', 'gift_card')
            ->json('data');
        $note = $return['credit_note'];
        $this->assertSame($note['code_last4'], $return['refunds'][0]['gift_card_last4']);
        $this->assertSame('Credit note ••••'.$note['code_last4'], $return['refunds'][0]['reference']);
        $this->assertSame('60.00', $this->lookup($note['code'])['balance']);
        // Shown once: the return document no longer carries it.
        $this->getJson("/api/v1/returns/{$return['id']}")->assertOk()->assertJsonPath('data.credit_note', null);
        // Only the cash part left the drawer.
        $this->assertSame(['cash'], Payment::query()->where('source_id', $return['id'])->pluck('method')->map(fn ($m) => $m->value)->all());

        // A walk-in sale cannot be refunded to store credit, but can get a credit note.
        $walkIn = $this->checkout($this->cart($store, [[$rice, '1']], [['cash', '100']]))->assertCreated()->json('data');
        $this->returnOf($walkIn, $walkIn['lines'][0]['id'], '1', [['method' => 'store_credit', 'amount' => '100']])
            ->assertStatus(422)->assertJsonPath('error.details', ['refunds.0.method' => ['Only a sale with a customer can be refunded to store credit.']]);
        $this->returnOf($walkIn, $walkIn['lines'][0]['id'], '1', [['method' => 'gift_card', 'amount' => '100']])
            ->assertCreated()->assertJsonPath('data.credit_note.amount', '100.00');
    }

    private function adjustCredit(Customer $customer, string $amount): void
    {
        $this->postJson("/api/v1/customers/{$customer->id}/store-credit/adjustments", ['amount' => $amount, 'reason' => 'Opening credit'], ['Idempotency-Key' => (string) Str::uuid()])->assertCreated();
    }

    private function balance(Customer $customer): string
    {
        return (string) $this->getJson("/api/v1/customers/{$customer->id}/store-credit")->assertOk()->json('data.balance');
    }

    /**
     * @return array<string, mixed>
     */
    private function lookup(string $code): array
    {
        return $this->postJson('/api/v1/gift-cards/lookup', ['code' => $code])->assertOk()->json('data');
    }

    /**
     * @param  list<array{0: mixed, 1: string}>  $lines
     * @param  list<array<string, string>>  $payments
     */
    private function checkoutWith(string $store, array $lines, array $payments): TestResponse
    {
        return $this->checkout(['payments' => $payments] + $this->cart($store, $lines));
    }

    /**
     * @param  array<string, mixed>  $sale
     * @param  list<array<string, string>>  $refunds
     */
    private function returnOf(array $sale, string $lineId, string $quantity, array $refunds): TestResponse
    {
        return $this->postJson('/api/v1/returns', [
            'sale_id' => $sale['id'],
            'lines' => [['sale_line_id' => $lineId, 'quantity' => $quantity]],
            'refunds' => $refunds,
        ], ['Idempotency-Key' => (string) Str::uuid()]);
    }
}
