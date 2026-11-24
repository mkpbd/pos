<?php

namespace App\Modules\Purchasing\Tests\Feature;

use App\Modules\Inventory\Tests\Concerns\InteractsWithStock;
use App\Modules\Payments\Infrastructure\Models\Payment;
use App\Modules\Payments\Infrastructure\Models\RegisterSession;
use App\Modules\Payments\Tests\Concerns\InteractsWithRegisters;
use App\Modules\Purchasing\Tests\Concerns\BuildsSupplyChain;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * ST1: supplier payments and refunds go through the payments ledger (cash through the
 * recorder's drawer), can be voided, and show on the statement and the supplier dues report.
 */
class SupplierMoneyTest extends TestCase
{
    use BuildsSupplyChain, InteractsWithRegisters, InteractsWithStock, InteractsWithTenancy, RefreshDatabase;

    public function test_cash_payments_refunds_and_voids_move_the_drawer_and_the_statement(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $supplier = $this->supplier($org);
        $variant = $this->stockedVariant($org);
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $this->postJson('/api/v1/purchasing/receipts', [
            'supplier_id' => $supplier->id, 'store_id' => $store, 'invoice_date' => now()->subDays(3)->toDateString(),
            'lines' => [['variant_id' => $variant->id, 'quantity' => '10', 'unit_cost' => '50', 'tax_rate' => '0']],
        ])->assertCreated();
        $today = now()->toDateString();
        $pay = fn (array $data, ?string $key = null) => $this->postJson('/api/v1/purchasing/payments', $data + ['supplier_id' => $supplier->id, 'paid_on' => $today], ['Idempotency-Key' => $key ?? (string) Str::uuid()]);

        // Cash comes out of the recorder's open drawer, like an expense.
        $pay(['amount' => '300', 'method' => 'cash'])->assertStatus(422)->assertJsonPath('error.code', 'CASH_SESSION_REQUIRED');
        $session = $this->openSession($admin, $branch->id, '1000.00');
        $pay(['amount' => '1200', 'method' => 'cash'])->assertStatus(422)->assertJsonPath('error.code', 'INSUFFICIENT_CASH');
        $pay(['amount' => '10', 'method' => 'other'])->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['method']]]);
        $this->postJson('/api/v1/purchasing/payments', ['supplier_id' => $supplier->id, 'paid_on' => $today, 'amount' => '1', 'method' => 'cash'])
            ->assertStatus(428)->assertJsonPath('error.code', 'IDEMPOTENCY_KEY_REQUIRED');

        $key = (string) Str::uuid();
        $cash = $pay(['amount' => '300', 'method' => 'cash', 'reference' => 'Cash to rep'], $key)->assertCreated()
            ->assertJsonPath('data.number', 'SPAY-000001')
            ->assertJsonPath('data.branch_id', $branch->id)
            ->assertJsonPath('data.voided_at', null)
            ->json('data');
        // A retry with the same key replays the first answer.
        $pay(['amount' => '300', 'method' => 'cash', 'reference' => 'Cash to rep'], $key)->assertCreated()->assertHeader('Idempotent-Replayed', 'true');
        $this->assertSame('700.00', $this->expected($session));

        // Non-cash: in the ledger, not in the drawer.
        $pay(['amount' => '100', 'method' => 'bank_transfer', 'reference' => 'TT-9'])->assertCreated()->assertJsonPath('data.number', 'SPAY-000002');
        $this->assertSame('700.00', $this->expected($session));

        // A refund from the supplier: cash into the drawer.
        $refund = $this->refund(['supplier_id' => $supplier->id, 'amount' => '50', 'method' => 'cash', 'received_on' => $today, 'reference' => 'Overpaid'])->assertCreated()
            ->assertJsonPath('data.number', 'SREF-000001')
            ->assertJsonPath('data.received_on', $today)
            ->assertJsonPath('data.supplier.id', $supplier->id)
            ->json('data');
        $this->assertSame('750.00', $this->expected($session));
        $this->assertSame(['supplier_payment', 'supplier_payment', 'supplier_refund'], Payment::query()->orderBy('created_at')->orderBy('id')->pluck('source_type')->all());
        $this->assertSame(['out', 'out', 'in'], Payment::query()->orderBy('created_at')->orderBy('id')->get()->map(fn (Payment $p) => $p->direction->value)->all());

        // 500 owed − 300 − 100 + 50 refunded = 150.
        $statement = $this->statement($supplier->id);
        $this->assertSame(['goods_receipt', 'payment', 'payment', 'refund'], array_column($statement['entries'], 'type'));
        $this->assertSame(['500.00', '-300.00', '-100.00', '50.00'], array_column($statement['entries'], 'amount'));
        $this->assertSame('150.00', $statement['closing_balance']);
        $this->assertSame('150.00', $this->dues($supplier->id));

        // Voids reverse the drawer and add a line to the statement.
        $this->postJson("/api/v1/purchasing/payments/{$cash['id']}/void", ['reason' => 'Rep did not take it'])->assertOk()
            ->assertJsonPath('data.void_reason', 'Rep did not take it')
            ->assertJsonPath('data.voided_by.id', $admin->id);
        $this->postJson("/api/v1/purchasing/payments/{$cash['id']}/void", ['reason' => 'again'])->assertStatus(422)->assertJsonPath('error.code', 'ALREADY_VOIDED');
        $this->assertSame('1050.00', $this->expected($session));
        $this->postJson("/api/v1/purchasing/supplier-refunds/{$refund['id']}/void", ['reason' => 'Typed twice'])->assertOk()->assertJsonPath('data.void_reason', 'Typed twice');
        $this->assertSame('1000.00', $this->expected($session));

        $statement = $this->statement($supplier->id);
        $this->assertSame(['goods_receipt', 'payment', 'payment', 'refund', 'payment_void', 'refund_void'], array_column($statement['entries'], 'type'));
        $this->assertSame(['300.00', '-50.00'], array_slice(array_column($statement['entries'], 'amount'), 4));
        $this->assertSame('Void: Rep did not take it', $statement['entries'][4]['reference']);
        $this->assertSame('400.00', $statement['closing_balance']);
        $this->assertSame('400.00', $this->dues($supplier->id));
        $this->getJson("/api/v1/purchasing/supplier-balances?supplier_ids[]={$supplier->id}")->assertJsonPath("data.{$supplier->id}", '400.00');

        // Lists keep voided entries (filterable).
        $this->getJson('/api/v1/purchasing/payments')->assertJsonCount(2, 'data');
        $this->getJson('/api/v1/purchasing/payments?voided=true')->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $cash['id']);
        $this->getJson('/api/v1/purchasing/supplier-refunds')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.voided_by.id', $admin->id);
        $this->getJson('/api/v1/purchasing/supplier-refunds?voided=false')->assertJsonCount(0, 'data');
        $this->get('/api/v1/purchasing/supplier-refunds?export=csv')->assertOk();
        $this->assertDatabaseHas('audit_logs', ['action' => 'supplier_refund.recorded', 'subject_id' => $refund['id']]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'supplier_payment.voided', 'subject_id' => $cash['id']]);
        $this->assertSame(['supplier_payment_void', 'supplier_refund_void'], Payment::query()->whereIn('source_type', ['supplier_payment_void', 'supplier_refund_void'])->orderBy('created_at')->orderBy('id')->pluck('source_type')->all());
    }

    public function test_branch_choice_for_money_without_a_drawer_and_payments_from_before_the_ledger(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $supplier = $this->supplier($org);
        $this->actingAsUser($admin);
        $today = now()->toDateString();

        // One branch: a bank transfer needs no drawer and books to it.
        $this->refund(['supplier_id' => $supplier->id, 'amount' => '20', 'method' => 'bank_transfer', 'received_on' => $today])->assertCreated()
            ->assertJsonPath('data.branch.id', $branch->id);
        $this->refund(['supplier_id' => $supplier->id, 'amount' => '20', 'method' => 'cash', 'received_on' => $today])
            ->assertStatus(422)->assertJsonPath('error.code', 'CASH_SESSION_REQUIRED');

        // Several branches and no open session: the branch must be chosen.
        $north = $this->createBranch($org, 'NORTH');
        $this->refund(['supplier_id' => $supplier->id, 'amount' => '20', 'method' => 'cheque', 'received_on' => $today])
            ->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['branch_id']]]);
        $this->refund(['supplier_id' => $supplier->id, 'amount' => '20', 'method' => 'cheque', 'received_on' => $today, 'branch_id' => $north->id])
            ->assertCreated()->assertJsonPath('data.branch_id', $north->id);
        // With an open session, its branch is used (cash and non-cash).
        $this->openSession($admin, $north->id, '0.00');
        $this->refund(['supplier_id' => $supplier->id, 'amount' => '20', 'method' => 'cash', 'received_on' => $today])->assertCreated()->assertJsonPath('data.branch_id', $north->id);
        // Cash booked to a branch whose drawer is not the user's session: refused by the ledger.
        $this->refund(['supplier_id' => $supplier->id, 'amount' => '20', 'method' => 'cash', 'received_on' => $today, 'branch_id' => $branch->id])
            ->assertStatus(422)->assertJsonPath('error.code', 'CASH_SESSION_REQUIRED');
        $this->refund(['supplier_id' => $supplier->id, 'amount' => '20', 'method' => 'cash', 'received_on' => now()->addDays(2)->toDateString()])
            ->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['received_on']]]);

        // A payment recorded before ST1 (no branch, never in the ledger) is voided without a ledger entry.
        $legacy = (string) Str::uuid();
        DB::table('supplier_payments')->insert(['id' => $legacy, 'organization_id' => $org->id, 'number' => 'SPAY-OLD', 'supplier_id' => $supplier->id,
            'branch_id' => null, 'currency' => 'BDT', 'amount' => '75', 'method' => 'other', 'paid_on' => $today, 'created_at' => now(), 'updated_at' => now()]);
        $ledger = Payment::query()->count();
        $this->postJson("/api/v1/purchasing/payments/{$legacy}/void", ['reason' => 'Duplicate'])->assertOk()->assertJsonPath('data.method', 'other');
        $this->assertSame($ledger, Payment::query()->count());
        // Three refunds of 20 raise what is owed; the voided old payment nets to zero (−75, +75).
        $this->assertSame('60.00', $this->statement($supplier->id)['closing_balance']);
    }

    public function test_permissions_and_isolation(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $supplier = $this->supplier($org);
        $this->actingAsUser($admin);
        $today = now()->toDateString();
        $refund = $this->refund(['supplier_id' => $supplier->id, 'amount' => '20', 'method' => 'card', 'received_on' => $today])->assertCreated()->json('data');

        $this->actingAsUser($this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]));
        $this->getJson('/api/v1/purchasing/supplier-refunds')->assertForbidden();
        $this->refund(['supplier_id' => $supplier->id, 'amount' => '20', 'method' => 'card', 'received_on' => $today])->assertForbidden();

        $accountant = $this->createUserWithRole($org, SystemRole::Accountant, [$branch->id]);
        $this->actingAsUser($accountant);
        $this->refund(['supplier_id' => $supplier->id, 'amount' => '5', 'method' => 'mobile_banking', 'received_on' => $today])->assertCreated();
        $this->getJson("/api/v1/purchasing/supplier-refunds/{$refund['id']}")->assertOk();
        $this->postJson("/api/v1/purchasing/supplier-refunds/{$refund['id']}/void", ['reason' => 'x'])->assertOk();

        $north = $this->createBranch($org, 'NORTH');
        $this->actingAsUser($this->createUserWithRole($org, SystemRole::Accountant, [$north->id]));
        $this->getJson("/api/v1/purchasing/supplier-refunds/{$refund['id']}")->assertNotFound();
        $this->getJson('/api/v1/purchasing/supplier-refunds')->assertJsonCount(0, 'data');

        ['admin' => $stranger] = $this->provisionTenant('Other Shop');
        $this->actingAsUser($stranger);
        $this->getJson("/api/v1/purchasing/supplier-refunds/{$refund['id']}")->assertNotFound();
        $this->postJson("/api/v1/purchasing/supplier-refunds/{$refund['id']}/void", ['reason' => 'x'])->assertNotFound();
        $this->getJson('/api/v1/purchasing/supplier-refunds')->assertJsonCount(0, 'data');
        $this->refund(['supplier_id' => $supplier->id, 'amount' => '5', 'method' => 'card', 'received_on' => $today])
            ->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['supplier_id']]]);
    }

    /**
     * @param  array<string, mixed>  $data
     */
    private function refund(array $data): TestResponse
    {
        return $this->postJson('/api/v1/purchasing/supplier-refunds', $data, ['Idempotency-Key' => (string) Str::uuid()]);
    }

    private function expected(RegisterSession $session): string
    {
        return $this->getJson("/api/v1/register-sessions/{$session->id}")->assertOk()->json('data.cash.expected');
    }

    /**
     * @return array<string, mixed>
     */
    private function statement(string $supplierId): array
    {
        return $this->getJson("/api/v1/purchasing/suppliers/{$supplierId}/statement")->assertOk()->json('data');
    }

    private function dues(string $supplierId): string
    {
        return collect($this->getJson('/api/v1/reports/supplier_dues')->assertOk()->json('data'))->firstWhere('supplier_id', $supplierId)['outstanding'];
    }
}
