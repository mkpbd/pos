<?php

namespace App\Modules\Sales\Tests\Feature;

use App\Modules\Payments\Infrastructure\Models\Payment;
use App\Modules\Products\Infrastructure\Models\ProductVariant;
use App\Modules\Sales\Infrastructure\Models\Sale;
use App\Modules\Sales\Infrastructure\Models\SaleLine;
use App\Modules\Sales\Tests\Concerns\InteractsWithSales;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * POS1c §2: what an exchange at the till looks like afterwards — the sale and return documents
 * pointing at each other, the cancel guard, later returns of the new sale, and the reports and
 * drawer (an exchange is value, not money).
 */
class ExchangeDocumentsTest extends TestCase
{
    use InteractsWithSales, InteractsWithTenancy, RefreshDatabase;

    public function test_the_sale_and_the_return_point_at_each_other(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $store = $this->mainStoreId($org);
        $shirt = $this->sellable($org, 'Shirt', '100.00');
        $pants = $this->sellable($org, 'Pants', '150.00');
        $this->actingAsUser($admin);
        $this->stockUp($store, $shirt, '10');
        $this->stockUp($store, $pants, '10');
        $original = $this->checkout($this->cart($store, [[$shirt, '2']], [['cash', '200']]))->assertCreated()->json('data');
        $plain = $this->checkout($this->cart($store, [[$shirt, '1']], [['cash', '100']]))->assertCreated()->json('data');

        // Returned 100, took 150: the customer pays 50 more.
        $done = $this->exchange($store, $original['lines'][0]['id'], '1', [[$pants, '1']], [['cash', '50']])->assertCreated()->json('data');
        $saleId = $done['sale']['id'];
        $returnId = $done['return']['id'];
        $returnNumber = $done['return']['number'];

        $sale = $this->getJson("/api/v1/sales/{$saleId}")->assertOk()
            ->assertJsonPath('data.is_exchange', true)
            ->assertJsonPath('data.exchange', [
                'return_id' => $returnId,
                'return_number' => $returnNumber,
                'original_sale_id' => $original['id'],
                'original_sale_number' => $original['number'],
                'value' => '100.00',
                'applied' => '100.00',
                'lines' => [['product_name' => 'Shirt', 'variant_name' => $original['lines'][0]['variant_name'], 'quantity' => '1.000', 'line_total' => '100.00']],
            ])
            ->json('data');
        $exchangePayment = collect($sale['payments'])->firstWhere('method', 'exchange');
        $this->assertSame(['Exchange', '100.00', $returnNumber], [$exchangePayment['method_label'], $exchangePayment['amount'], $exchangePayment['reference']]);
        $this->assertNull($exchangePayment['gift_card_last4']);
        // The checkout response carries the same document.
        $this->assertSame($sale['exchange'], $done['sale']['exchange']);

        $this->getJson("/api/v1/sales/{$original['id']}")->assertOk()->assertJsonPath('data.is_exchange', false)->assertJsonPath('data.exchange', null);
        $list = collect($this->getJson('/api/v1/sales')->assertOk()->json('data'))->keyBy('id');
        $this->assertTrue($list[$saleId]['is_exchange']);
        $this->assertFalse($list[$original['id']]['is_exchange']);
        $this->assertFalse($list[$plain['id']]['is_exchange']);

        $this->getJson("/api/v1/returns/{$returnId}")->assertOk()
            ->assertJsonPath('data.exchange_sale', ['id' => $saleId, 'number' => $sale['number'], 'total' => '150.00'])
            ->assertJsonPath('data.exchange_sale_number', $sale['number'])
            ->assertJsonPath('data.refunds.0.method', 'exchange')
            ->assertJsonPath('data.refunds.0.method_label', 'Exchange');

        // A normal return has neither.
        $normal = $this->postJson('/api/v1/returns', [
            'sale_id' => $plain['id'], 'lines' => [['sale_line_id' => $plain['lines'][0]['id'], 'quantity' => '1']],
            'refunds' => [['method' => 'cash', 'amount' => '100']],
        ], ['Idempotency-Key' => (string) Str::uuid()])->assertCreated()
            ->assertJsonPath('data.exchange_sale', null)
            ->assertJsonPath('data.exchange_sale_number', null)
            ->json('data');
        $returns = collect($this->getJson('/api/v1/returns')->assertOk()->json('data'))->keyBy('id');
        $this->assertSame($sale['number'], $returns[$returnId]['exchange_sale_number']);
        $this->assertNull($returns[$normal['id']]['exchange_sale_number']);

        // Another organization sees none of it.
        ['organization' => $other, 'branch' => $otherBranch] = $this->provisionTenant('Other Shop');
        $this->actingAsUser($this->createUserWithRole($other, SystemRole::BranchManager, [$otherBranch->id]));
        $this->getJson("/api/v1/sales/{$saleId}")->assertNotFound();
        $this->getJson("/api/v1/returns/{$returnId}")->assertNotFound();
        $this->assertSame([], $this->getJson('/api/v1/sales')->assertOk()->json('data'));
    }

    public function test_the_exchange_applies_up_to_the_new_sale_and_neither_sale_can_be_cancelled(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $store = $this->mainStoreId($org);
        $shirt = $this->sellable($org, 'Shirt', '100.00');
        $pants = $this->sellable($org, 'Pants', '150.00');
        $this->actingAsUser($admin);
        $this->stockUp($store, $shirt, '10');
        $this->stockUp($store, $pants, '10');
        $original = $this->checkout($this->cart($store, [[$shirt, '2']], [['card', '200']]))->assertCreated()->json('data');

        // Returned 200, took 150: 50 refunded to the card it was paid with.
        $done = $this->exchange($store, $original['lines'][0]['id'], '2', [[$pants, '1']], [], [['card', '50']])->assertCreated()
            ->assertJsonPath('data.sale.total', '150.00')
            ->json('data');
        $saleId = $done['sale']['id'];

        $this->getJson("/api/v1/sales/{$saleId}")->assertOk()
            ->assertJsonPath('data.exchange.value', '200.00')
            ->assertJsonPath('data.exchange.applied', '150.00')
            ->assertJsonPath('data.exchange.lines.0.quantity', '2.000')
            ->assertJsonPath('data.exchange.lines.0.line_total', '200.00');

        $this->postJson("/api/v1/sales/{$saleId}/cancel", ['reason' => 'Mistake'])
            ->assertStatus(422)->assertJsonPath('error.code', 'EXCHANGE_SALE_NOT_CANCELLABLE');
        // The original invoice has a completed return.
        $this->postJson("/api/v1/sales/{$original['id']}/cancel", ['reason' => 'Mistake'])
            ->assertStatus(422)->assertJsonPath('error.code', 'SALE_HAS_RETURNS');
        $this->getJson("/api/v1/sales/{$saleId}")->assertJsonPath('data.status', 'completed');
        $this->getJson("/api/v1/sales/{$original['id']}")->assertJsonPath('data.status', 'completed');
    }

    public function test_the_new_sale_is_returned_later_like_any_sale(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $store = $this->mainStoreId($org);
        $shirt = $this->sellable($org, 'Shirt', '100.00');
        $pants = $this->sellable($org, 'Pants', '150.00');
        $customer = $this->customer($org, 'Rina');
        $this->actingAsUser($admin);
        $this->stockUp($store, $shirt, '10');
        $this->stockUp($store, $pants, '10');
        $original = $this->checkout($this->cart($store, [[$shirt, '1']], [['cash', '100']], ['customer_id' => $customer->id]))->assertCreated()->json('data');
        // Returned 100, took 150: 50 more by card. The customer is the invoice's.
        $sale = $this->exchange($store, $original['lines'][0]['id'], '1', [[$pants, '1']], [['card', '50']])->assertCreated()->json('data.sale');
        $this->assertSame($customer->id, $sale['customer']['id']);

        $preview = $this->postJson('/api/v1/returns/preview', [
            'sale_id' => $sale['id'], 'lines' => [['sale_line_id' => $sale['lines'][0]['id'], 'quantity' => '1']],
        ])->assertOk()->assertJsonPath('data.settlement.refund_due', '150.00')->json('data.settlement');
        $this->assertSame(
            [['cash', null], ['card', '50.00'], ['store_credit', null], ['gift_card', null]],
            array_map(fn (array $r) => [$r['method'], $r['max']], $preview['refundable']),
        );

        $return = fn (array $refunds) => $this->postJson('/api/v1/returns', [
            'sale_id' => $sale['id'], 'lines' => [['sale_line_id' => $sale['lines'][0]['id'], 'quantity' => '1']], 'refunds' => $refunds,
        ], ['Idempotency-Key' => (string) Str::uuid()]);
        $return([['method' => 'exchange', 'amount' => '150']])->assertStatus(422)->assertJsonValidationErrors('refunds.0.method', 'error.details');
        $return([['method' => 'card', 'amount' => '100'], ['method' => 'cash', 'amount' => '50']])
            ->assertStatus(422)->assertJsonValidationErrors('refunds.0.amount', 'error.details');
        $return([['method' => 'card', 'amount' => '50'], ['method' => 'cash', 'amount' => '100']])->assertCreated()
            ->assertJsonPath('data.status', 'completed')
            ->assertJsonPath('data.refunded_total', '150.00')
            ->assertJsonPath('data.exchange_sale', null);

        $this->assertSame('10.000', $this->stockRow($pants->id, $store)['quantity']);
        $this->getJson("/api/v1/sales/{$sale['id']}")->assertOk()
            ->assertJsonPath('data.is_exchange', true)
            ->assertJsonPath('data.lines.0.returned_quantity', '1.000');
        $this->assertSame(
            [['card', '50.00'], ['cash', '100.00']],
            // The exchange's own return wrote nothing to the ledger.
            Payment::query()->where('source_type', 'sale_return')->orderBy('method')->get()
                ->map(fn (Payment $p) => [$p->method->value, $p->amount])->all(),
        );
    }

    public function test_an_exchange_is_not_money_in_the_reports_or_the_drawer(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $store = $this->mainStoreId($org);
        $shirt = $this->sellable($org, 'Shirt', '100.00');
        $pants = $this->sellable($org, 'Pants', '150.00');
        $socks = $this->sellable($org, 'Socks', '30.00');
        $this->actingAsUser($admin);
        $this->stockUp($store, $shirt, '10');
        $this->stockUp($store, $pants, '10');
        $this->stockUp($store, $socks, '10');
        $session = $this->openSession($admin, $branch->id, '500.00');

        $first = $this->checkout($this->cart($store, [[$shirt, '1']], [['cash', '100']]))->assertCreated()->json('data');
        $second = $this->checkout($this->cart($store, [[$shirt, '1']], [['card', '100']]))->assertCreated()->json('data');
        // 100 back, 150 taken: 50 cash in. 100 back, 30 taken: 70 cash out.
        $this->exchange($store, $first['lines'][0]['id'], '1', [[$pants, '1']], [['cash', '50']])->assertCreated();
        $this->exchange($store, $second['lines'][0]['id'], '1', [[$socks, '1']], [], [['cash', '70']])->assertCreated()
            ->assertJsonPath('data.sale.total', '30.00');

        // Only real money is in the ledger: 100 + 100 + 50 in, 70 out.
        $this->assertSame(
            [['in', 'card', '100.00'], ['in', 'cash', '50.00'], ['in', 'cash', '100.00'], ['out', 'cash', '70.00']],
            Payment::query()->orderBy('direction')->orderBy('method')->orderBy('amount')->get()
                ->map(fn (Payment $p) => [$p->direction->value, $p->method->value, $p->amount])->all(),
        );
        $this->getJson("/api/v1/register-sessions/{$session->id}")->assertOk()
            ->assertJsonPath('data.cash.expected', '580.00')
            ->assertJsonPath('data.cash.cash_in', '150.00')
            ->assertJsonPath('data.cash.cash_out', '70.00');

        // The day's summary lists the exchange value apart from the money taken.
        $summary = $this->getJson('/api/v1/sales/summary')->assertOk()->json('data');
        $payments = collect($summary['payments'])->keyBy('method');
        $this->assertSame(['Exchange', '130.00'], [$payments['exchange']['label'], $payments['exchange']['amount']]);
        $this->assertSame('150.00', $payments['cash']['amount']);
        $this->assertSame('100.00', $payments['card']['amount']);

        // Payment collections (the ledger): collected 250, refunded 70; no exchange row.
        $range = ['date_from' => now()->subDay()->toDateString(), 'date_to' => now()->addDay()->toDateString()];
        $report = $this->getJson('/api/v1/reports/payment_collections?'.http_build_query($range))->assertOk();
        $report->assertJsonPath('meta.totals.collected', '250.00')->assertJsonPath('meta.totals.refunded', '70.00');
        $this->assertEqualsCanonicalizing(['cash', 'card'], collect($report->json('data'))->pluck('group_key')->all());
    }

    /**
     * Exchanges items of an invoice at the till as the authenticated user (who may approve returns).
     *
     * @param  list<array{0: ProductVariant, 1: string}>  $lines  the new items
     * @param  list<array{0: string, 1: string}>  $payments
     * @param  list<array{0: string, 1: string}>  $refunds
     */
    private function exchange(string $store, string $saleLineId, string $quantity, array $lines, array $payments, array $refunds = []): TestResponse
    {
        $sale = Sale::query()->withoutGlobalScopes()->findOrFail(SaleLine::query()->withoutGlobalScopes()->findOrFail($saleLineId)->sale_id);
        /** @var User $user */
        $user = auth()->user();
        $this->openSession($user, $sale->branch_id);

        return $this->postJson('/api/v1/pos/exchanges', $this->cart($store, $lines, $payments) + [
            'return' => ['sale_id' => $sale->id, 'lines' => [['sale_line_id' => $saleLineId, 'quantity' => $quantity]]],
            'refunds' => array_map(fn (array $r) => ['method' => $r[0], 'amount' => $r[1]], $refunds),
        ], ['Idempotency-Key' => (string) Str::uuid()]);
    }
}
