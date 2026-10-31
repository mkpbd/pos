<?php

namespace App\Modules\Sales\Tests\Feature;

use App\Modules\Payments\Infrastructure\Models\Payment;
use App\Modules\Sales\Infrastructure\Models\SaleReturnLine;
use App\Modules\Sales\Tests\Concerns\InteractsWithSales;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use LogicException;
use Tests\TestCase;

/**
 * Critical workflow #10: sales return and refund.
 */
class SaleReturnTest extends TestCase
{
    use InteractsWithSales, InteractsWithTenancy, RefreshDatabase;

    public function test_a_cashier_requests_a_return_and_a_manager_approves_it_with_a_refund(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $syrup = $this->sellable($org, 'Syrup', '100.00', ['tax' => '10', 'batches' => true, 'cost' => '40.00']);
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $this->stockUp($store, $syrup, '2', '40.00', 'OLD', now()->addMonth()->toDateString());
        $this->stockUp($store, $syrup, '5', '50.00', 'NEW', now()->addYear()->toDateString());

        // 3 × 100 − 10 % invoice discount = 270, + 10 % VAT = 297; FEFO takes 2 × OLD and 1 × NEW.
        $sale = $this->checkout($this->cart($store, [[$syrup, '3']], [['card', '200'], ['cash', '97']], ['invoice_discount' => ['type' => 'percent', 'value' => '10']]))
            ->assertCreated()->json('data');
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]);
        $this->actingAsUser($cashier);

        $request = $this->returnRequest(['sale_id' => $sale['id'], 'lines' => [['sale_line_id' => $sale['lines'][0]['id'], 'quantity' => '2']]])
            ->assertCreated()
            ->assertJsonPath('data.number', 'RET-MAIN-000001')
            ->assertJsonPath('data.status', 'pending')
            ->assertJsonPath('data.total', '198.00')
            ->assertJsonPath('data.tax_total', '18.00')
            ->assertJsonPath('data.subtotal', '180.00')
            ->assertJsonPath('data.settlement.credit', '0.00')
            ->assertJsonPath('data.settlement.refund_due', '198.00')
            ->json('data');
        $this->postJson("/api/v1/returns/{$request['id']}/approve", ['refunds' => [['method' => 'cash', 'amount' => '198']]], ['Idempotency-Key' => (string) Str::uuid()])->assertForbidden();

        // The pending request reserves its quantity.
        $this->returnRequest(['sale_id' => $sale['id'], 'lines' => [['sale_line_id' => $sale['lines'][0]['id'], 'quantity' => '2']]])
            ->assertStatus(422)->assertJsonPath('error.details', ['lines.0.quantity' => ['Only 1.000 can still be returned.']]);

        $this->actingAsUser($admin);
        $this->openSession($admin, $branch->id, '500.00');
        $this->assertSame('4.000', $this->stockRow($syrup->id, $store)['quantity'], 'pending returns do not move stock');
        $approve = fn (array $refunds) => $this->postJson("/api/v1/returns/{$request['id']}/approve", ['refunds' => $refunds], ['Idempotency-Key' => (string) Str::uuid()]);
        $approve([['method' => 'cash', 'amount' => '100']])
            ->assertStatus(422)->assertJsonPath('error.code', 'REFUND_MISMATCH')->assertJsonPath('error.details.refund_due', '198.00');
        $approve([['method' => 'mobile_banking', 'amount' => '198']])
            ->assertStatus(422)->assertJsonPath('error.details', ['refunds.0.method' => ['Nothing was paid this way on the invoice; refund in cash or the way it was paid.']]);
        $approve([['method' => 'card', 'amount' => '150'], ['method' => 'cash', 'amount' => '48']])
            ->assertOk()
            ->assertJsonPath('data.status', 'completed')
            ->assertJsonPath('data.refunded_total', '198.00');

        // The last unit: at most 50 more by card (200 paid, 150 refunded).
        $last = $this->returnRequest(['sale_id' => $sale['id'], 'lines' => [['sale_line_id' => $sale['lines'][0]['id'], 'quantity' => '1']], 'refunds' => [['method' => 'card', 'amount' => '99']]]);
        $last->assertStatus(422)->assertJsonPath('error.details', ['refunds.0.amount' => ['At most 50.00 can be refunded by Card.']]);
        $this->returnRequest(['sale_id' => $sale['id'], 'lines' => [['sale_line_id' => $sale['lines'][0]['id'], 'quantity' => '1']], 'refunds' => [['method' => 'card', 'amount' => '50'], ['method' => 'cash', 'amount' => '49']]])
            ->assertCreated()->assertJsonPath('data.total', '99.00');
        $this->assertSame('7.000', $this->stockRow($syrup->id, $store)['quantity']);
    }

    public function test_approval_restocks_original_batches_and_refunds_through_the_ledger(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $syrup = $this->sellable($org, 'Syrup', '100.00', ['batches' => true, 'cost' => '40.00']);
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $this->stockUp($store, $syrup, '2', '40.00', 'OLD', now()->addMonth()->toDateString());
        $this->stockUp($store, $syrup, '5', '50.00', 'NEW', now()->addYear()->toDateString());
        $sale = $this->checkout($this->cart($store, [[$syrup, '3']], [['card', '150'], ['cash', '150']]))->assertCreated()->json('data');

        $cashier = $this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]);
        $this->actingAsUser($cashier);
        $request = $this->returnRequest(['sale_id' => $sale['id'], 'lines' => [['sale_line_id' => $sale['lines'][0]['id'], 'quantity' => '2']]])->json('data');

        $this->actingAsUser($admin);
        $this->postJson("/api/v1/returns/{$request['id']}/approve", ['refunds' => [['method' => 'card', 'amount' => '150'], ['method' => 'cash', 'amount' => '50']]], ['Idempotency-Key' => (string) Str::uuid()])
            ->assertOk()
            ->assertJsonPath('data.status', 'completed')
            ->assertJsonPath('data.refunded_total', '200.00')
            ->assertJsonPath('data.credited_total', '0.00')
            ->assertJsonPath('data.refunds.0.method', 'card')
            ->assertJsonPath('data.lines.0.batches.0.batch_number', 'NEW')
            ->assertJsonPath('data.lines.0.batches.1.batch_number', 'OLD')
            ->assertJsonPath('data.decided_by.id', $admin->id);

        // Back to the batches they came from (most recent allocation first), at their cost.
        $this->assertSame('6.000', $this->stockRow($syrup->id, $store)['quantity']);
        $movements = collect($this->getJson("/api/v1/inventory/movements?variant_id={$syrup->id}&type=sale_return")->json('data'));
        $this->assertEqualsCanonicalizing(['40.0000', '50.0000'], $movements->pluck('unit_cost')->all());

        $out = Payment::query()->where('source_type', 'sale_return')->orderBy('method')->get();
        $this->assertSame([['card', '150.00'], ['cash', '50.00']], $out->map(fn (Payment $p) => [$p->method->value, $p->amount])->all());
        $this->getJson("/api/v1/register-sessions/{$out[1]->cash_register_session_id}")->assertOk()->assertJsonPath('data.cash.expected', '100.00');

        $this->getJson("/api/v1/sales/{$sale['id']}")
            ->assertOk()
            ->assertJsonPath('data.lines.0.returned_quantity', '2.000')
            ->assertJsonPath('data.returns.0.number', 'RET-MAIN-000001');
        $this->postJson("/api/v1/sales/{$sale['id']}/cancel", ['reason' => 'x'])->assertStatus(422)->assertJsonPath('error.code', 'SALE_HAS_RETURNS');
        $this->postJson("/api/v1/returns/{$request['id']}/approve", ['refunds' => []], ['Idempotency-Key' => (string) Str::uuid()])
            ->assertStatus(422)->assertJsonPath('error.code', 'RETURN_ALREADY_DECIDED');
        $this->getJson('/api/v1/audit-logs?action=sale_return.completed')->assertOk()->assertJsonCount(1, 'data');

        $this->expectException(LogicException::class);
        SaleReturnLine::query()->firstOrFail()->update(['quantity' => '1']);
    }

    public function test_the_last_return_of_a_line_takes_the_exact_remainder(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $pen = $this->sellable($org, 'Pen', '10.00', ['tax' => '15']);
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $this->stockUp($store, $pen, '10');
        // 3 × 10 = 30 − 10.00 invoice discount = 20.00 + 15 % = 23.00
        $sale = $this->checkout($this->cart($store, [[$pen, '3']], [['cash', '23']], ['invoice_discount' => ['type' => 'amount', 'value' => '10']]))->json('data');
        $line = $sale['lines'][0]['id'];

        $totals = [];
        foreach (['1', '1', '1'] as $quantity) {
            $totals[] = $this->returnRequest(['sale_id' => $sale['id'], 'lines' => [['sale_line_id' => $line, 'quantity' => $quantity]], 'refunds' => null], refundAll: true)
                ->assertCreated()->assertJsonPath('data.status', 'completed')->json('data.total');
        }

        $this->assertSame(['7.67', '7.67', '7.66'], $totals);
        $this->returnRequest(['sale_id' => $sale['id'], 'lines' => [['sale_line_id' => $line, 'quantity' => '1']]])
            ->assertStatus(422)->assertJsonPath('error.details', ['lines.0.quantity' => ['This line has already been returned.']]);
    }

    public function test_returns_on_account_reduce_the_due_before_refunding(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $tv = $this->sellable($org, 'TV', '1000.00');
        $store = $this->mainStoreId($org);
        $customer = $this->customer($org, 'Rina', creditLimit: '5000');
        $this->actingAsUser($admin);
        $this->stockUp($store, $tv, '5');
        // 2 000 total, 400 paid, 1 600 due.
        $sale = $this->checkout($this->cart($store, [[$tv, '2']], [['cash', '400']], ['customer_id' => $customer->id]))->json('data');

        $preview = $this->postJson('/api/v1/returns/preview', ['sale_id' => $sale['id'], 'lines' => [['sale_line_id' => $sale['lines'][0]['id'], 'quantity' => '1']]])
            ->assertOk()
            ->assertJsonPath('data.total', '1000.00')
            ->assertJsonPath('data.settlement.credit', '1000.00')
            ->assertJsonPath('data.settlement.refund_due', '0.00')
            ->assertJsonPath('data.completes_immediately', true);
        $this->assertSame(['cash'], array_column($preview->json('data.settlement.refundable'), 'method'));

        $this->returnRequest(['sale_id' => $sale['id'], 'lines' => [['sale_line_id' => $sale['lines'][0]['id'], 'quantity' => '1']]])
            ->assertCreated()->assertJsonPath('data.credited_total', '1000.00')->assertJsonPath('data.refunded_total', '0.00');
        $this->getJson("/api/v1/sales/customer-balances?customer_ids[]={$customer->id}")->assertJsonPath("data.{$customer->id}", '600.00');

        // The second unit: 600 still owed on the invoice, the other 400 comes back in cash.
        $this->returnRequest(['sale_id' => $sale['id'], 'lines' => [['sale_line_id' => $sale['lines'][0]['id'], 'quantity' => '1']], 'refunds' => [['method' => 'cash', 'amount' => '400']]])
            ->assertCreated()->assertJsonPath('data.credited_total', '600.00')->assertJsonPath('data.refunded_total', '400.00');
        $this->getJson("/api/v1/sales/customer-balances?customer_ids[]={$customer->id}")->assertJsonPath("data.{$customer->id}", '0.00');
        $this->assertSame('5.000', $this->stockRow($tv->id, $store)['quantity']);
    }

    public function test_written_off_lines_bring_no_stock_back_and_serials_are_released(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $phone = $this->sellable($org, 'Phone', '20000.00', ['serials' => true]);
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $this->stockUp($store, $phone, '3', '15000.00');
        $damaged = $this->postJson('/api/v1/return-reasons', ['name' => 'Damaged', 'restock_by_default' => false])->assertCreated()->json('data');
        $sale = $this->checkout($this->cart($store, [[$phone, '2', ['serials' => ['IMEI-1', 'IMEI-2']]]], [['card', '40000']]))->json('data');
        $line = $sale['lines'][0]['id'];

        $this->returnRequest(['sale_id' => $sale['id'], 'return_reason_id' => $damaged['id'], 'lines' => [['sale_line_id' => $line, 'quantity' => '1', 'serials' => ['IMEI-9']]]], refundAll: true)
            ->assertStatus(422)->assertJsonPath('error.details', ['lines.0.serials' => ['Serial IMEI-9 was not sold on this line or is already being returned.']]);
        $this->returnRequest(['sale_id' => $sale['id'], 'return_reason_id' => $damaged['id'], 'lines' => [['sale_line_id' => $line, 'quantity' => '1', 'serials' => ['imei-2']]], 'refunds' => [['method' => 'card', 'amount' => '20000']]])
            ->assertCreated()
            ->assertJsonPath('data.reason.name', 'Damaged')
            ->assertJsonPath('data.lines.0.restock', false)
            ->assertJsonPath('data.lines.0.serials', ['IMEI-2']);

        $this->assertSame('1.000', $this->stockRow($phone->id, $store)['quantity'], 'a written-off phone does not come back');
        // IMEI-2 can be sold again; IMEI-1 is still out.
        $this->checkout($this->cart($store, [[$phone, '1', ['serials' => ['IMEI-1']]]], [['card', '20000']]))->assertStatus(422);
        $this->checkout($this->cart($store, [[$phone, '1', ['serials' => ['IMEI-2']]]], [['card', '20000']]))->assertCreated();
        $this->getJson("/api/v1/sales/{$sale['id']}")->assertJsonPath('data.lines.0.returned_serials', ['IMEI-2']);
    }

    public function test_rejected_returns_free_their_quantity_and_returns_are_branch_scoped(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $soap = $this->sellable($org, 'Soap', '10.00');
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $this->stockUp($store, $soap, '5');
        $sale = $this->checkout($this->cart($store, [[$soap, '1']], [['cash', '10']]))->json('data');

        $cashier = $this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]);
        $this->actingAsUser($cashier);
        $request = $this->returnRequest(['sale_id' => $sale['id'], 'lines' => [['sale_line_id' => $sale['lines'][0]['id'], 'quantity' => '1']]])->json('data');

        $this->actingAsUser($admin);
        $this->postJson("/api/v1/returns/{$request['id']}/reject", ['reason' => 'Opened package'])
            ->assertOk()->assertJsonPath('data.status', 'rejected')->assertJsonPath('data.rejection_reason', 'Opened package');
        $this->getJson('/api/v1/returns?status=rejected')->assertOk()->assertJsonPath('meta.pagination.total', 1);
        $this->returnRequest(['sale_id' => $sale['id'], 'lines' => [['sale_line_id' => $sale['lines'][0]['id'], 'quantity' => '1']]], refundAll: true)->assertCreated();

        $north = $this->createBranch($org, 'NORTH');
        $this->actingAsUser($this->createUserWithRole($org, SystemRole::BranchManager, [$north->id]));
        $this->getJson("/api/v1/returns/{$request['id']}")->assertNotFound();
        $this->getJson('/api/v1/returns')->assertOk()->assertJsonPath('meta.pagination.total', 0);
        $this->returnRequest(['sale_id' => $sale['id'], 'lines' => [['sale_line_id' => $sale['lines'][0]['id'], 'quantity' => '1']]])
            ->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['sale_id']]]);

        ['admin' => $stranger] = $this->provisionTenant('Other Shop');
        $this->actingAsUser($stranger);
        $this->getJson("/api/v1/returns/{$request['id']}")->assertNotFound();
    }

    /**
     * @param  array<string, mixed>  $payload
     * @param  bool  $refundAll  refund whatever the preview says is due, in cash
     */
    private function returnRequest(array $payload, bool $refundAll = false): TestResponse
    {
        $payload = array_filter($payload, fn ($v) => $v !== null);
        if ($refundAll) {
            $preview = $this->postJson('/api/v1/returns/preview', $payload);
            if ($preview->status() !== 200) {
                return $preview;
            }
            $due = $preview->json('data.settlement.refund_due');
            $payload['refunds'] = $due === '0.00' ? [] : [['method' => 'cash', 'amount' => $due]];
        }

        return $this->postJson('/api/v1/returns', $payload, ['Idempotency-Key' => (string) Str::uuid()]);
    }
}
