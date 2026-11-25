<?php

namespace App\Modules\StoredValue\Tests\Feature;

use App\Modules\Customers\Infrastructure\Models\Customer;
use App\Modules\Payments\Infrastructure\Models\Payment;
use App\Modules\Sales\Tests\Concerns\InteractsWithSales;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\StoredValue\Infrastructure\Models\StoreCreditEntry;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use LogicException;
use Tests\TestCase;

/**
 * POS1b §1: customers' store credit — advances (top-ups), pay-outs, adjustments, balances.
 */
class StoreCreditTest extends TestCase
{
    use InteractsWithSales, InteractsWithTenancy, RefreshDatabase;

    public function test_advances_take_money_into_the_drawer_and_raise_the_balance(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $store = $this->mainStoreId($org);
        $rina = $this->customer($org, 'Rina');
        $this->actingAsUser($admin);

        // Cash goes into a drawer: no open session, no advance (and nothing is written).
        $this->send("customers/{$rina->id}/store-credit/top-ups", ['store_id' => $store, 'amount' => '500', 'method' => 'cash'])
            ->assertStatus(422)->assertJsonPath('error.code', 'CASH_SESSION_REQUIRED');
        $this->assertSame(0, StoreCreditEntry::query()->count());

        // A card advance needs no drawer.
        $this->send("customers/{$rina->id}/store-credit/top-ups", ['store_id' => $store, 'amount' => '300', 'method' => 'card', 'reference' => 'TXN-1', 'note' => 'Deposit for a wedding order'])
            ->assertCreated()
            ->assertJsonPath('data.receipt_number', 'ADV-000001')
            ->assertJsonPath('data.balance', '300.00')
            ->assertJsonPath('data.entry.type', 'top_up')
            ->assertJsonPath('data.entry.amount', '300.00')
            ->assertJsonPath('data.entry.method', 'card')
            ->assertJsonPath('data.entry.note', 'Deposit for a wedding order')
            ->assertJsonPath('data.entry.created_by.id', $admin->id);

        $session = $this->openSession($admin, $branch->id);
        $entry = $this->send("customers/{$rina->id}/store-credit/top-ups", ['store_id' => $store, 'amount' => '200.50', 'method' => 'cash'])
            ->assertCreated()->assertJsonPath('data.receipt_number', 'ADV-000002')->assertJsonPath('data.balance', '500.50')->json('data.entry');

        $cash = Payment::query()->where('source_type', 'store_credit_top_up')->where('method', 'cash')->firstOrFail();
        $this->assertSame($session->id, $cash->cash_register_session_id);
        $this->assertSame('200.50', $cash->amount);
        $this->assertSame('in', $cash->direction->value);
        $this->assertSame($entry['id'], $cash->source_id);
        $this->assertSame('ADV-000002', $cash->source_number);
        $this->assertSame($rina->id, $cash->customer_id);
        $this->assertSame(2, Payment::query()->where('source_type', 'store_credit_top_up')->count());
        $this->assertDatabaseHas('audit_logs', ['action' => 'store_credit.top_up', 'subject_id' => $entry['id'], 'organization_id' => $org->id]);

        $this->getJson("/api/v1/customers/{$rina->id}/store-credit")
            ->assertOk()->assertJsonPath('data.balance', '500.50')->assertJsonPath('data.currency', 'BDT')
            ->assertJsonPath('data.last_activity_at', fn ($v) => is_string($v));
        $this->getJson("/api/v1/customers/{$rina->id}/store-credit/entries")
            ->assertOk()
            ->assertJsonCount(2, 'data')
            ->assertJsonPath('data.0.receipt_number', 'ADV-000002')
            ->assertJsonPath('data.0.balance_after', '500.50')
            ->assertJsonPath('data.1.receipt_number', 'ADV-000001')
            ->assertJsonPath('meta.pagination.total', 2);

        // Amount rules.
        $this->send("customers/{$rina->id}/store-credit/top-ups", ['store_id' => $store, 'amount' => '0', 'method' => 'card'])->assertStatus(422);
        $this->send("customers/{$rina->id}/store-credit/top-ups", ['store_id' => $store, 'amount' => '10000000.01', 'method' => 'card'])->assertStatus(422);
        $this->send("customers/{$rina->id}/store-credit/top-ups", ['store_id' => $store, 'amount' => '10', 'method' => 'loyalty_points'])->assertStatus(422);
    }

    public function test_pay_outs_and_adjustments_never_take_the_balance_below_zero(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $store = $this->mainStoreId($org);
        $rina = $this->customer($org, 'Rina');
        $this->actingAsUser($admin);
        $this->openSession($admin, $branch->id, '50.00');
        $this->send("customers/{$rina->id}/store-credit/top-ups", ['store_id' => $store, 'amount' => '100', 'method' => 'card'])->assertCreated();

        $this->send("customers/{$rina->id}/store-credit/withdrawals", ['store_id' => $store, 'amount' => '100.01', 'method' => 'card'])
            ->assertStatus(422)->assertJsonPath('error.code', 'INSUFFICIENT_STORE_CREDIT')->assertJsonPath('error.details.balance', '100.00');
        // Cash comes out of the drawer, which holds only the 50 float.
        $this->send("customers/{$rina->id}/store-credit/withdrawals", ['store_id' => $store, 'amount' => '60', 'method' => 'cash'])
            ->assertStatus(422)->assertJsonPath('error.code', 'INSUFFICIENT_CASH');
        $this->send("customers/{$rina->id}/store-credit/withdrawals", ['store_id' => $store, 'amount' => '40', 'method' => 'cash', 'note' => 'Customer moving away'])
            ->assertCreated()
            ->assertJsonPath('data.receipt_number', 'ADW-000001')
            ->assertJsonPath('data.balance', '60.00')
            ->assertJsonPath('data.entry.type', 'withdrawal')
            ->assertJsonPath('data.entry.amount', '-40.00');
        $out = Payment::query()->where('source_type', 'store_credit_withdrawal')->firstOrFail();
        $this->assertSame('out', $out->direction->value);
        $this->assertSame('40.00', $out->amount);
        $this->assertDatabaseHas('audit_logs', ['action' => 'store_credit.withdrawal', 'organization_id' => $org->id]);

        $this->send("customers/{$rina->id}/store-credit/adjustments", ['amount' => '-60.01', 'reason' => 'Correction'])
            ->assertStatus(422)->assertJsonPath('error.code', 'INSUFFICIENT_STORE_CREDIT');
        $this->send("customers/{$rina->id}/store-credit/adjustments", ['amount' => '0', 'reason' => 'Nothing'])->assertStatus(422);
        $this->send("customers/{$rina->id}/store-credit/adjustments", ['amount' => '-10'])->assertStatus(422);
        $this->send("customers/{$rina->id}/store-credit/adjustments", ['amount' => '-60', 'reason' => 'Advance refunded by bank transfer'])
            ->assertCreated()->assertJsonPath('data.balance', '0.00')->assertJsonPath('data.entry.note', 'Advance refunded by bank transfer');
        $this->send("customers/{$rina->id}/store-credit/adjustments", ['amount' => '25.50', 'reason' => 'Goodwill'])
            ->assertCreated()->assertJsonPath('data.balance', '25.50')->assertJsonPath('data.receipt_number', null);
        $this->assertDatabaseHas('audit_logs', ['action' => 'store_credit.adjusted', 'organization_id' => $org->id]);
        // Adjustments move no money: only the advance and the pay-out are in the ledger.
        $this->assertSame(2, Payment::query()->whereIn('source_type', ['store_credit_top_up', 'store_credit_withdrawal'])->count());

        $this->expectException(LogicException::class);
        StoreCreditEntry::query()->firstOrFail()->update(['amount' => '1000']);
    }

    public function test_entries_are_append_only_in_the_database(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $rina = $this->customer($org, 'Rina');
        $this->actingAsUser($admin);
        $id = $this->send("customers/{$rina->id}/store-credit/adjustments", ['amount' => '5', 'reason' => 'Goodwill'])->assertCreated()->json('data.entry.id');

        $this->expectException(QueryException::class);
        DB::table('store_credit_entries')->where('id', $id)->update(['amount' => '500']);
    }

    public function test_requests_are_idempotent(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $store = $this->mainStoreId($org);
        $rina = $this->customer($org, 'Rina');
        $this->actingAsUser($admin);
        $key = (string) Str::uuid();

        $first = $this->send("customers/{$rina->id}/store-credit/top-ups", ['store_id' => $store, 'amount' => '100', 'method' => 'card'], $key)->assertCreated()->json('data');
        $again = $this->send("customers/{$rina->id}/store-credit/top-ups", ['store_id' => $store, 'amount' => '100', 'method' => 'card'], $key)->assertCreated()->json('data');
        $this->assertSame($first['entry']['id'], $again['entry']['id']);
        $this->assertSame(1, StoreCreditEntry::query()->count());
        $this->assertSame(1, Payment::query()->where('source_type', 'store_credit_top_up')->count());

        $this->postJson("/api/v1/customers/{$rina->id}/store-credit/adjustments", ['amount' => '5', 'reason' => 'x'])->assertStatus(428);
    }

    public function test_customers_show_their_balance_in_one_query_per_page(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $rina = $this->customer($org, 'Rina');
        $omar = $this->customer($org, 'Omar');
        $this->actingAsUser($admin);
        $this->send("customers/{$rina->id}/store-credit/adjustments", ['amount' => '75', 'reason' => 'Opening credit'])->assertCreated();

        $this->getJson("/api/v1/customers/{$rina->id}")->assertOk()->assertJsonPath('data.store_credit_balance', '75.00');
        $this->getJson("/api/v1/customers/{$omar->id}")->assertOk()->assertJsonPath('data.store_credit_balance', '0.00');

        DB::enableQueryLog();
        $list = $this->getJson('/api/v1/customers?search=r')->assertOk()->json('data');
        $queries = collect(DB::getQueryLog())->filter(fn (array $q) => str_contains($q['query'], 'store_credit_entries'))->count();
        DB::disableQueryLog();
        $this->assertSame(1, $queries);
        $this->assertSame(['Omar' => '0.00', 'Rina' => '75.00'], collect($list)->mapWithKeys(fn (array $c) => [$c['name'] => $c['store_credit_balance']])->sortKeys()->all());

        // Without store_credit.view the balance is not shown.
        $this->actingAsUser($this->createUserWithRole($org, SystemRole::OnlineStoreManager, [$branch->id]));
        $this->getJson("/api/v1/customers/{$rina->id}")->assertOk()->assertJsonPath('data.store_credit_balance', null);
        $this->getJson("/api/v1/customers/{$rina->id}/store-credit")->assertForbidden();
    }

    public function test_permissions_by_role(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $store = $this->mainStoreId($org);
        $rina = $this->customer($org, 'Rina');
        $this->actingAsUser($admin);
        $this->send("customers/{$rina->id}/store-credit/adjustments", ['amount' => '50', 'reason' => 'Opening'])->assertCreated();

        // Cashier: sees the balance and takes advances; cannot pay out or adjust.
        $this->actingAsUser($this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]));
        $this->getJson("/api/v1/customers/{$rina->id}/store-credit")->assertOk()->assertJsonPath('data.balance', '50.00');
        $this->getJson("/api/v1/customers/{$rina->id}/store-credit/entries")->assertOk();
        $this->send("customers/{$rina->id}/store-credit/top-ups", ['store_id' => $store, 'amount' => '10', 'method' => 'card'])->assertCreated();
        $this->send("customers/{$rina->id}/store-credit/withdrawals", ['store_id' => $store, 'amount' => '10', 'method' => 'card'])->assertForbidden();
        $this->send("customers/{$rina->id}/store-credit/adjustments", ['amount' => '10', 'reason' => 'x'])->assertForbidden();

        // Accountant: reads; Branch Manager: pays out and adjusts.
        $this->actingAsUser($this->createUserWithRole($org, SystemRole::Accountant, [$branch->id]));
        $this->getJson("/api/v1/customers/{$rina->id}/store-credit")->assertOk();
        $this->send("customers/{$rina->id}/store-credit/adjustments", ['amount' => '10', 'reason' => 'x'])->assertForbidden();
        $this->actingAsUser($this->createUserWithRole($org, SystemRole::BranchManager, [$branch->id]));
        $this->send("customers/{$rina->id}/store-credit/withdrawals", ['store_id' => $store, 'amount' => '10', 'method' => 'card'])->assertCreated()->assertJsonPath('data.balance', '50.00');
        $this->send("customers/{$rina->id}/store-credit/adjustments", ['amount' => '-5', 'reason' => 'x'])->assertCreated()->assertJsonPath('data.balance', '45.00');

        // Inventory Manager: nothing.
        $this->actingAsUser($this->createUserWithRole($org, SystemRole::InventoryManager, [$branch->id]));
        $this->getJson("/api/v1/customers/{$rina->id}/store-credit")->assertForbidden();
    }

    public function test_other_organizations_cannot_see_or_move_the_credit(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $rina = $this->customer($org, 'Rina');
        $this->actingAsUser($admin);
        $this->send("customers/{$rina->id}/store-credit/adjustments", ['amount' => '50', 'reason' => 'Opening'])->assertCreated();

        ['admin' => $stranger, 'organization' => $other] = $this->provisionTenant('Other Shop');
        $otherStore = $this->mainStoreId($other);
        $this->actingAsUser($stranger);
        $this->getJson("/api/v1/customers/{$rina->id}/store-credit")->assertNotFound();
        $this->getJson("/api/v1/customers/{$rina->id}/store-credit/entries")->assertNotFound();
        $this->send("customers/{$rina->id}/store-credit/top-ups", ['store_id' => $otherStore, 'amount' => '10', 'method' => 'card'])->assertNotFound();
        $this->send("customers/{$rina->id}/store-credit/withdrawals", ['store_id' => $otherStore, 'amount' => '10', 'method' => 'card'])->assertNotFound();
        $this->send("customers/{$rina->id}/store-credit/adjustments", ['amount' => '-50', 'reason' => 'x'])->assertNotFound();

        // Their own customer with the same name sees none of it; a foreign store is refused.
        $mine = $this->customer($other, 'Rina');
        $this->getJson("/api/v1/customers/{$mine->id}/store-credit")->assertOk()->assertJsonPath('data.balance', '0.00');
        $this->actingAsUser($admin);
        $this->send("customers/{$rina->id}/store-credit/top-ups", ['store_id' => $otherStore, 'amount' => '10', 'method' => 'card'])->assertStatus(422);
        $this->assertSame(1, StoreCreditEntry::query()->withoutGlobalScopes()->count());
        $this->getJson("/api/v1/customers/{$rina->id}/store-credit")->assertJsonPath('data.balance', '50.00');
    }

    public function test_archived_customers_take_no_advances_but_can_be_paid_out(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $store = $this->mainStoreId($org);
        $rina = $this->customer($org, 'Rina');
        $this->actingAsUser($admin);
        $this->send("customers/{$rina->id}/store-credit/top-ups", ['store_id' => $store, 'amount' => '30', 'method' => 'card'])->assertCreated();
        $this->inTenant($org, fn () => Customer::query()->whereKey($rina->id)->firstOrFail()->delete());

        $this->send("customers/{$rina->id}/store-credit/top-ups", ['store_id' => $store, 'amount' => '30', 'method' => 'card'])->assertStatus(422);
        $this->send("customers/{$rina->id}/store-credit/withdrawals", ['store_id' => $store, 'amount' => '30', 'method' => 'card'])->assertCreated()->assertJsonPath('data.balance', '0.00');
    }

    /**
     * @param  array<string, mixed>  $body
     */
    private function send(string $path, array $body, ?string $key = null): TestResponse
    {
        return $this->postJson("/api/v1/{$path}", $body, ['Idempotency-Key' => $key ?? (string) Str::uuid()]);
    }
}
