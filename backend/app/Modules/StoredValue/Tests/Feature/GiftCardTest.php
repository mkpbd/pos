<?php

namespace App\Modules\StoredValue\Tests\Feature;

use App\Modules\Audit\Infrastructure\Models\AuditLog;
use App\Modules\Organizations\Infrastructure\Models\Organization;
use App\Modules\Payments\Infrastructure\Models\Payment;
use App\Modules\Sales\Application\Contracts\GiftCards;
use App\Modules\Sales\Tests\Concerns\InteractsWithSales;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\StoredValue\Infrastructure\Models\GiftCard;
use App\Modules\StoredValue\Infrastructure\Models\GiftCardEntry;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use LogicException;
use Tests\TestCase;

/**
 * POS1b §2: gift cards sold at the till, vouchers, credit notes, the balance lookup, voiding,
 * and the Sales GiftCards contract (redeem, cancel a sale, credit note for a return).
 */
class GiftCardTest extends TestCase
{
    use InteractsWithSales, InteractsWithTenancy, RefreshDatabase;

    public function test_a_gift_card_is_sold_with_money_into_the_ledger_and_the_code_shown_once(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $store = $this->mainStoreId($org);
        $customer = $this->customer($org, 'Rina');
        $this->actingAsUser($admin);

        // Cash needs the seller's open drawer; a card payment does not.
        $this->sell(['store_id' => $store, 'amount' => '500', 'payments' => [['method' => 'cash', 'amount' => '500']]])
            ->assertStatus(422)->assertJsonPath('error.code', 'CASH_SESSION_REQUIRED');
        $this->assertSame(0, GiftCard::query()->withoutGlobalScopes()->count());

        $session = $this->openSession($admin, $branch->id);
        $sold = $this->sell([
            'store_id' => $store, 'amount' => '500.00', 'customer_id' => $customer->id,
            'payments' => [['method' => 'cash', 'amount' => '200'], ['method' => 'card', 'amount' => '300', 'reference' => 'VISA-1']],
        ])->assertCreated()
            ->assertJsonPath('data.receipt_number', 'GCS-000001')
            ->assertJsonPath('data.gift_card.kind', 'gift_card')
            ->assertJsonPath('data.gift_card.balance', '500.00')
            ->assertJsonPath('data.gift_card.currency', 'BDT')
            ->assertJsonPath('data.gift_card.customer.name', 'Rina')
            ->json('data.gift_card');

        $this->assertMatchesRegularExpression('/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/', $sold['code']);
        $plain = str_replace('-', '', $sold['code']);
        $this->assertSame(substr($plain, -4), $sold['code_last4']);
        $expires = Carbon::parse($sold['expires_at']);
        $this->assertTrue($expires->between(now()->addMonths(12)->subMinute(), now()->addMonths(12)->addMinute()), 'expires in 12 months by default');

        $card = GiftCard::query()->withoutGlobalScopes()->findOrFail($sold['id']);
        $this->assertSame(hash('sha256', $plain), $card->code_hash);
        $this->assertSame('GCS-000001', $card->sale_receipt_number);
        $this->assertSame((string) $admin->id, $card->issued_by);

        $ledger = Payment::query()->withoutGlobalScopes()->where('source_type', 'gift_card_sale')->orderBy('amount')->get();
        $this->assertSame([['cash', '200.00'], ['card', '300.00']], $ledger->map(fn (Payment $p) => [$p->method->value, $p->amount])->all());
        $this->assertSame($session->id, $ledger[0]->cash_register_session_id, 'cash goes into the drawer');
        $this->assertSame([$card->id], $ledger->pluck('source_id')->unique()->values()->all());
        $this->assertSame('GCS-000001', $ledger[0]->source_number);
        $this->assertSame($customer->id, $ledger[1]->customer_id);
        $this->assertSame('VISA-1', $ledger[1]->reference);
        $this->assertSame(0, DB::table('sales')->count(), 'not a sale');

        // The code is shown once: never again in the list, the detail or the lookup.
        $this->assertCodeNowhere($plain, [
            $this->getJson('/api/v1/gift-cards')->assertOk()->assertJsonPath('data.0.id', $card->id)->getContent(),
            $this->getJson("/api/v1/gift-cards/{$card->id}")->assertOk()->assertJsonPath('data.entries.0.type', 'issue')->getContent(),
            $this->lookup(strtolower($sold['code']))->assertOk()->assertJsonPath('data.usable', true)->assertJsonPath('data.balance', '500.00')->getContent(),
        ]);
    }

    public function test_selling_checks_amounts_payments_codes_and_expiry(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $card = fn (array $extra) => ['store_id' => $store, 'amount' => '100', 'payments' => [['method' => 'card', 'amount' => '100']]] + $extra;

        $this->sell(['store_id' => $store, 'amount' => '100', 'payments' => [['method' => 'card', 'amount' => '60'], ['method' => 'mobile_banking', 'amount' => '30']]])
            ->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['payments']]]);
        $this->sell(['store_id' => $store, 'amount' => '9.99', 'payments' => [['method' => 'card', 'amount' => '9.99']]])
            ->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['amount']]]);
        $this->sell(['store_id' => $store, 'amount' => '1000000.01', 'payments' => [['method' => 'card', 'amount' => '1000000.01']]])
            ->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['amount']]]);
        $this->sell(['store_id' => $store, 'amount' => '100', 'payments' => [['method' => 'cheque', 'amount' => '100']]])
            ->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['payments.0.method']]]);
        $this->sell($card(['code' => 'ABC-12']))->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['code']]]);
        $this->sell($card(['expires_at' => now()->subDay()->toDateString()]))->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['expires_at']]]);
        $this->sell($card(['expires_at' => now()->addYear()->toDateString(), 'never_expires' => true]))->assertStatus(422);

        // A pre-printed card number (any case / separators), unique.
        $this->sell($card(['code' => 'pp 0012-3456-78', 'never_expires' => true]))->assertCreated()
            ->assertJsonPath('data.gift_card.code', 'PP00-1234-5678')
            ->assertJsonPath('data.gift_card.code_last4', '5678')
            ->assertJsonPath('data.gift_card.expires_at', null);
        $this->sell($card(['code' => 'PP0012345678']))->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['code']]]);
        $this->lookup('pp-0012-345678')->assertOk()->assertJsonPath('data.usable', true)->assertJsonPath('data.expires_at', null);

        $date = now()->addMonths(3)->toDateString();
        $this->sell($card(['expires_at' => $date]))->assertCreated()->assertJsonPath('data.gift_card.expires_at', fn (string $v) => str_contains($v, 'T'));
        $this->assertSame(2, GiftCard::query()->withoutGlobalScopes()->count());
        $this->assertSame(['GCS-000001', 'GCS-000002'], GiftCard::query()->withoutGlobalScopes()->orderBy('sale_receipt_number')->pluck('sale_receipt_number')->all());
    }

    public function test_selling_needs_pos_sell_and_payments_collect_and_is_idempotent(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $store = $this->mainStoreId($org);
        $payload = ['store_id' => $store, 'amount' => '250', 'payments' => [['method' => 'card', 'amount' => '250']]];

        $this->actingAsUser($this->createUserWithRole($org, SystemRole::InventoryManager, [$branch->id]));
        $this->sell($payload)->assertForbidden();

        $cashier = $this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]);
        $this->actingAsUser($cashier);
        $key = (string) Str::uuid();
        $first = $this->sell($payload, $key)->assertCreated()->json('data');
        $replay = $this->sell($payload, $key)->assertCreated()->assertHeader('Idempotent-Replayed', 'true')->json('data');
        $this->assertSame($first, $replay);
        // The kept answer (full code included) is encrypted at rest.
        $stored = (string) DB::table('idempotency_keys')->where('key', $key)->value('response_body');
        $this->assertStringNotContainsString(str_replace('-', '', $first['gift_card']['code']), str_replace('-', '', $stored));
        $this->assertStringNotContainsString($first['gift_card']['code'], $stored);
        $this->assertSame(1, GiftCard::query()->withoutGlobalScopes()->count());
        $this->assertSame(1, Payment::query()->withoutGlobalScopes()->where('source_type', 'gift_card_sale')->count());
        $this->postJson('/api/v1/gift-cards/sell', $payload)->assertStatus(428);

        // A cashier sells but cannot see the list nor issue vouchers.
        $this->getJson('/api/v1/gift-cards')->assertForbidden();
        $this->voucher(['amount' => '50', 'reason' => 'Sorry'])->assertForbidden();

        // A store of another tenant is not a store.
        ['organization' => $other] = $this->provisionTenant('Other Shop');
        $this->actingAsUser($admin);
        $this->sell(['store_id' => $this->mainStoreId($other)] + $payload)->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['store_id']]]);
    }

    public function test_vouchers_are_issued_free_by_managers(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $customer = $this->customer($org, 'Karim');
        $manager = $this->createUserWithRole($org, SystemRole::BranchManager, [$branch->id]);
        $this->actingAsUser($manager);

        $this->voucher(['amount' => '75'])->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['reason']]]);
        $voucher = $this->voucher(['amount' => '75.50', 'reason' => 'Late delivery', 'customer_id' => $customer->id])
            ->assertCreated()
            ->assertJsonPath('data.receipt_number', null)
            ->assertJsonPath('data.gift_card.kind', 'voucher')
            ->assertJsonPath('data.gift_card.balance', '75.50')
            ->assertJsonPath('data.gift_card.customer.id', $customer->id)
            ->json('data.gift_card');
        $this->assertMatchesRegularExpression('/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/', $voucher['code']);
        $this->assertSame(0, Payment::query()->withoutGlobalScopes()->count(), 'no money moves');

        $this->getJson("/api/v1/gift-cards/{$voucher['id']}")->assertOk()
            ->assertJsonPath('data.note', 'Late delivery')
            ->assertJsonPath('data.issued_by', ['id' => $manager->id, 'name' => $manager->name])
            ->assertJsonPath('data.sale_receipt_number', null)
            ->assertJsonPath('data.void_reason', null)
            ->assertJsonPath('data.voided_at', null)
            ->assertJsonPath('data.voided_by', null)
            ->assertJsonPath('data.entries.0.type', 'issue')
            ->assertJsonPath('data.entries.0.created_by', ['id' => $manager->id, 'name' => $manager->name])
            ->assertJsonPath('data.entries.0.amount', '75.50');

        // 10 – 1 000 000 like sold cards; a date expires at the end of that day in the organization's timezone (Asia/Dhaka).
        $this->voucher(['amount' => '9.99', 'reason' => 'Gift'])->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['amount']]]);
        $this->voucher(['amount' => '1000000.01', 'reason' => 'Gift'])->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['amount']]]);
        $this->voucher(['amount' => '10', 'reason' => 'Gift', 'expires_at' => null, 'never_expires' => true])->assertCreated()
            ->assertJsonPath('data.gift_card.expires_at', null);
        $date = now()->addMonths(2)->toDateString();
        $expires = $this->voucher(['amount' => '10', 'reason' => 'Gift', 'expires_at' => $date])->assertCreated()->json('data.gift_card.expires_at');
        $this->assertSame("{$date} 23:59:59", Carbon::parse($expires)->setTimezone('Asia/Dhaka')->format('Y-m-d H:i:s'));

        $accountant = $this->createUserWithRole($org, SystemRole::Accountant, [$branch->id]);
        $this->actingAsUser($accountant);
        $this->getJson('/api/v1/gift-cards')->assertOk()->assertJsonCount(3, 'data');
        $this->voucher(['amount' => '10', 'reason' => 'x'])->assertForbidden();
        $this->postJson("/api/v1/gift-cards/{$voucher['id']}/void", ['reason' => 'x'])->assertForbidden();
    }

    public function test_lookup_answers_found_unknown_void_and_expired_and_is_throttled(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $this->actingAsUser($admin);
        $active = $this->voucher(['amount' => '40', 'reason' => 'Gift'])->json('data.gift_card');
        $void = $this->voucher(['amount' => '40', 'reason' => 'Gift'])->json('data.gift_card');
        $this->postJson("/api/v1/gift-cards/{$void['id']}/void", ['reason' => 'Lost'])->assertOk();
        $expired = $this->voucher(['amount' => '40', 'reason' => 'Gift', 'expires_at' => now()->addDay()->toDateString()])->json('data.gift_card');
        $this->travel(3)->days();

        $this->lookup(str_replace('-', ' ', $active['code']))->assertOk()
            ->assertJsonPath('data.id', $active['id'])->assertJsonPath('data.usable', true)->assertJsonPath('data.reason', null)
            ->assertJsonPath('data.kind', 'voucher')->assertJsonPath('data.balance', '40.00');
        $this->lookup('ZZZZ-ZZZZ-ZZZZ-ZZZZ')->assertOk()
            ->assertJsonPath('data.usable', false)->assertJsonPath('data.reason', 'not_found')->assertJsonPath('data.id', null);
        $this->lookup($void['code'])->assertOk()->assertJsonPath('data.usable', false)->assertJsonPath('data.reason', 'void')->assertJsonPath('data.balance', '0.00');
        $this->lookup($expired['code'])->assertOk()->assertJsonPath('data.usable', false)->assertJsonPath('data.reason', 'expired');

        $this->getJson('/api/v1/gift-cards?status=expired')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.expired', true);
        $this->getJson('/api/v1/gift-cards?status=void')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $void['id']);
        $this->getJson('/api/v1/gift-cards?status=active')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $active['id']);

        // Guessing codes is throttled: 20 lookups a minute per user (4 used above).
        for ($i = 0; $i < 16; $i++) {
            $this->lookup('ZZZZ-ZZZZ-ZZZZ-ZZZZ')->assertOk();
        }
        $this->lookup('ZZZZ-ZZZZ-ZZZZ-ZZZZ')->assertStatus(429);

        $this->actingAsUser($this->createUserWithRole($org, SystemRole::InventoryManager));
        $this->lookup($active['code'])->assertForbidden();
    }

    public function test_redeem_spends_partly_then_fully_and_refuses_what_is_not_there(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $this->actingAsUser($admin);
        $card = $this->voucher(['amount' => '100', 'reason' => 'Gift'])->json('data.gift_card');
        $saleA = (string) Str::uuid();

        $result = $this->inSale($org, fn (GiftCards $g) => $g->redeem(strtolower($card['code']), '30.00', 'BDT', $saleA, 'INV-000001'));
        $this->assertSame(['gift_card_id' => $card['id'], 'code_last4' => $card['code_last4'], 'balance_after' => '70.00'], $result);

        $this->assertInvalid($org, fn (GiftCards $g) => $g->redeem($card['code'], '70.01', 'BDT', $saleA, 'INV-000001'), 'insufficient', '70.00', $card['code_last4']);
        $this->assertInvalid($org, fn (GiftCards $g) => $g->redeem(str_replace('-', '', $card['code']), '10', 'USD', $saleA, 'INV-000001'), 'wrong_currency', '70.00', $card['code_last4']);
        $this->assertInvalid($org, fn (GiftCards $g) => $g->redeem('NOPE-NOPE-NOPE', '10', 'BDT', $saleA, 'INV-000001'), 'not_found', null, 'NOPE');
        $this->assertInvalid($org, fn (GiftCards $g) => $g->redeem('abcd efgh-jkl5-mn67', '10', 'BDT', $saleA, 'INV-000001'), 'not_found', null, 'MN67');

        // A sale that fails later rolls its redemption back with it.
        try {
            $this->inSale($org, function (GiftCards $g) use ($card) {
                $g->redeem($card['code'], '20', 'BDT', (string) Str::uuid(), 'INV-000009');
                throw new BusinessRuleViolation('INSUFFICIENT_STOCK', 'Out of stock.');
            });
            $this->fail('The sale should have failed.');
        } catch (BusinessRuleViolation $e) {
            $this->assertSame('INSUFFICIENT_STOCK', $e->errorCode);
        }
        $this->lookup(str_replace('-', '', $card['code']))->assertJsonPath('data.balance', '70.00')->assertJsonPath('data.code_last4', $card['code_last4']);

        $saleB = (string) Str::uuid();
        $this->inSale($org, fn (GiftCards $g) => $g->redeem($card['code'], '70', 'BDT', $saleB, 'INV-000002'));
        $this->assertInvalid($org, fn (GiftCards $g) => $g->redeem($card['code'], '0.01', 'BDT', $saleB, 'INV-000002'), 'insufficient', '0.00', $card['code_last4']);

        $detail = $this->getJson("/api/v1/gift-cards/{$card['id']}")->assertOk()->assertJsonPath('data.balance', '0.00')->json('data');
        $this->assertSame(['redeem', 'redeem', 'issue'], array_column($detail['entries'], 'type'));
        $this->assertSame(['-70.00', '-30.00', '100.00'], array_column($detail['entries'], 'amount'));
        $this->assertSame(['INV-000002', 'INV-000001', null], array_column($detail['entries'], 'reference_number'));

        // Void and expired cards cannot pay.
        $void = $this->voucher(['amount' => '50', 'reason' => 'Gift'])->json('data.gift_card');
        $this->postJson("/api/v1/gift-cards/{$void['id']}/void", ['reason' => 'Stolen'])->assertOk();
        $this->assertInvalid($org, fn (GiftCards $g) => $g->redeem($void['code'], '1', 'BDT', $saleA, 'INV-1'), 'void', '0.00', $void['code_last4']);
        $expiring = $this->voucher(['amount' => '50', 'reason' => 'Gift', 'expires_at' => now()->addDay()->toDateString()])->json('data.gift_card');
        $this->travel(2)->days();
        $this->assertInvalid($org, fn (GiftCards $g) => $g->redeem($expiring['code'], '1', 'BDT', $saleA, 'INV-1'), 'expired', '50.00', $expiring['code_last4']);
    }

    public function test_redeem_locks_the_card_row(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $this->actingAsUser($admin);
        $card = $this->voucher(['amount' => '100', 'reason' => 'Gift'])->json('data.gift_card');

        $queries = [];
        DB::listen(function ($query) use (&$queries) {
            $queries[] = $query->sql;
        });
        $this->inSale($org, fn (GiftCards $g) => $g->redeem($card['code'], '10', 'BDT', (string) Str::uuid(), 'INV-1'));

        $select = collect($queries)->first(fn (string $sql) => str_contains($sql, 'from "gift_cards"') && str_contains($sql, 'code_hash'));
        $this->assertNotNull($select);
        $this->assertStringContainsString('for update', $select);

        // Spending sequentially never takes the balance below zero; the row CHECK backs it up.
        $this->expectException(QueryException::class);
        $this->inTenant($org, fn () => DB::table('gift_cards')->where('id', $card['id'])->update(['balance' => '-1']));
    }

    public function test_cancelling_a_sale_gives_back_what_it_spent_once(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $this->actingAsUser($admin);
        $a = $this->voucher(['amount' => '100', 'reason' => 'Gift'])->json('data.gift_card');
        $b = $this->voucher(['amount' => '20', 'reason' => 'Gift'])->json('data.gift_card');
        $sale = (string) Str::uuid();
        $other = (string) Str::uuid();

        $this->inSale($org, function (GiftCards $g) use ($a, $b, $sale, $other) {
            $g->redeem($a['code'], '30', 'BDT', $sale, 'INV-000001');
            $g->redeem($a['code'], '5', 'BDT', $sale, 'INV-000001');
            $g->redeem($b['code'], '20', 'BDT', $sale, 'INV-000001');
            $g->redeem($a['code'], '10', 'BDT', $other, 'INV-000002');
        });
        $this->inSale($org, fn (GiftCards $g) => $g->reverseSale($sale));
        $this->inSale($org, fn (GiftCards $g) => $g->reverseSale($sale));
        $this->inSale($org, fn (GiftCards $g) => $g->reverseSale((string) Str::uuid()));

        $this->getJson("/api/v1/gift-cards/{$a['id']}")->assertOk()->assertJsonPath('data.balance', '90.00')
            ->assertJsonPath('data.entries.0.type', 'sale_reversal')
            ->assertJsonPath('data.entries.0.amount', '35.00')
            ->assertJsonPath('data.entries.0.reference_number', 'INV-000001');
        $this->getJson("/api/v1/gift-cards/{$b['id']}")->assertOk()->assertJsonPath('data.balance', '20.00');
        $this->assertSame(2, GiftCardEntry::query()->withoutGlobalScopes()->where('type', 'sale_reversal')->count());
    }

    public function test_a_credit_note_is_issued_for_a_return_refund(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $customer = $this->customer($org, 'Rina');
        $this->actingAsUser($admin);
        $return = (string) Str::uuid();

        $note = $this->inSale($org, fn (GiftCards $g) => $g->issueCreditNote('45.50', 'BDT', $customer->id, $return, 'RET-000001', (string) $admin->id));
        $this->assertSame(['id', 'code', 'code_last4', 'expires_at'], array_keys($note));
        $this->assertMatchesRegularExpression('/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/', $note['code']);
        $this->assertNotNull($note['expires_at']);

        $this->getJson("/api/v1/gift-cards/{$note['id']}")->assertOk()
            ->assertJsonPath('data.kind', 'credit_note')
            ->assertJsonPath('data.balance', '45.50')
            ->assertJsonPath('data.customer.name', 'Rina')
            ->assertJsonPath('data.source_return_id', $return)
            ->assertJsonPath('data.entries.0.reference_type', 'sale_return')
            ->assertJsonPath('data.entries.0.reference_number', 'RET-000001');
        $this->getJson('/api/v1/gift-cards?kind=credit_note')->assertOk()->assertJsonCount(1, 'data');
        $this->getJson('/api/v1/gift-cards?kind=voucher')->assertOk()->assertJsonCount(0, 'data');
        $this->lookup($note['code'])->assertOk()->assertJsonPath('data.usable', true)->assertJsonPath('data.kind', 'credit_note');

        $this->assertCodeNowhere(str_replace('-', '', $note['code']), []);
    }

    public function test_voiding_writes_off_the_balance(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $this->actingAsUser($admin);
        $card = $this->voucher(['amount' => '60', 'reason' => 'Gift'])->json('data.gift_card');
        $this->inSale($org, fn (GiftCards $g) => $g->redeem($card['code'], '15', 'BDT', (string) Str::uuid(), 'INV-1'));

        $this->postJson("/api/v1/gift-cards/{$card['id']}/void", [])->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['reason']]]);
        $this->postJson("/api/v1/gift-cards/{$card['id']}/void", ['reason' => 'Lost by customer'])->assertOk()
            ->assertJsonPath('data.status', 'void')
            ->assertJsonPath('data.balance', '0.00')
            ->assertJsonPath('data.void_reason', 'Lost by customer')
            ->assertJsonPath('data.voided_by.id', $admin->id)
            ->assertJsonPath('data.entries.0.type', 'void')
            ->assertJsonPath('data.entries.0.amount', '-45.00')
            ->assertJsonPath('data.entries.0.balance_after', '0.00');
        $this->postJson("/api/v1/gift-cards/{$card['id']}/void", ['reason' => 'Again'])->assertStatus(422)
            ->assertJsonPath('error.code', 'GIFT_CARD_INVALID')->assertJsonPath('error.details.reason', 'void')->assertJsonPath('error.details.code_last4', $card['code_last4']);

        $audit = AuditLog::query()->withoutGlobalScopes()->where('action', 'gift_card.voided')->firstOrFail();
        $this->assertSame('45.00', $audit->old_values['balance']);
        $this->assertSame('Lost by customer', $audit->new_values['reason']);

        // Entries are append-only.
        $this->expectException(LogicException::class);
        $this->inTenant($org, fn () => GiftCardEntry::query()->firstOrFail()->update(['amount' => '1']));
    }

    public function test_gift_cards_are_isolated_per_organization(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $customer = $this->customer($org, 'Rina Akter');
        $this->actingAsUser($admin);
        $mine = $this->voucher(['amount' => '30', 'reason' => 'Gift', 'customer_id' => $customer->id])->json('data.gift_card');
        $this->voucher(['amount' => '30', 'reason' => 'Gift'])->assertCreated();
        $this->getJson('/api/v1/gift-cards?search='.$mine['code_last4'])->assertOk()->assertJsonPath('data.0.id', $mine['id']);
        $this->getJson('/api/v1/gift-cards?search=akter')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.customer.name', 'Rina Akter');
        $this->getJson('/api/v1/gift-cards')->assertOk()->assertJsonPath('meta.pagination.total', 2);

        ['admin' => $stranger, 'organization' => $otherOrg] = $this->provisionTenant('Other Shop');
        $this->actingAsUser($stranger);
        $this->getJson('/api/v1/gift-cards')->assertOk()->assertJsonCount(0, 'data');
        $this->getJson("/api/v1/gift-cards/{$mine['id']}")->assertNotFound();
        $this->postJson("/api/v1/gift-cards/{$mine['id']}/void", ['reason' => 'Mine now'])->assertNotFound();
        $this->lookup($mine['code'])->assertOk()->assertJsonPath('data.reason', 'not_found');
        $this->voucher(['amount' => '30', 'reason' => 'Gift', 'customer_id' => $customer->id])->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['customer_id']]]);
        $this->assertInvalid($otherOrg, fn (GiftCards $g) => $g->redeem($mine['code'], '1', 'BDT', (string) Str::uuid(), 'INV-1'), 'not_found', null, $mine['code_last4']);

        $this->actingAsUser($admin);
        $this->getJson("/api/v1/gift-cards/{$mine['id']}")->assertOk()->assertJsonPath('data.balance', '30.00')->assertJsonPath('data.status', 'active');
    }

    public function test_codes_are_never_stored_or_audited_in_clear(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $this->openSession($admin, $branch->id);

        $codes = [
            $this->sell(['store_id' => $store, 'amount' => '100', 'payments' => [['method' => 'cash', 'amount' => '100']]])->json('data.gift_card.code'),
            $this->sell(['store_id' => $store, 'amount' => '100', 'code' => 'CARD20260001', 'payments' => [['method' => 'card', 'amount' => '100']]])->json('data.gift_card.code'),
            $this->voucher(['amount' => '10', 'reason' => 'Gift'])->json('data.gift_card.code'),
        ];
        foreach ($codes as $code) {
            $this->assertCodeNowhere(str_replace('-', '', $code), []);
        }
        $this->assertSame(['gift_card.sold', 'gift_card.sold', 'gift_card.voucher_issued'], AuditLog::query()->withoutGlobalScopes()
            ->where('action', 'like', 'gift_card.%')->orderBy('created_at')->orderBy('id')->pluck('action')->sort()->values()->all());
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function sell(array $payload, ?string $key = null): TestResponse
    {
        return $this->postJson('/api/v1/gift-cards/sell', $payload, ['Idempotency-Key' => $key ?? (string) Str::uuid()]);
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function voucher(array $payload): TestResponse
    {
        return $this->postJson('/api/v1/gift-cards/vouchers', $payload, ['Idempotency-Key' => (string) Str::uuid()]);
    }

    private function lookup(string $code): TestResponse
    {
        return $this->postJson('/api/v1/gift-cards/lookup', ['code' => $code]);
    }

    /**
     * Runs the contract inside a transaction in the organization, as Sales does.
     *
     * @template T
     *
     * @param  callable(GiftCards): T  $callback
     * @return T
     */
    private function inSale(Organization $organization, callable $callback): mixed
    {
        return $this->inTenant($organization, fn () => DB::transaction(fn () => $callback(app(GiftCards::class))));
    }

    /**
     * @param  callable(GiftCards): mixed  $callback
     */
    private function assertInvalid(Organization $organization, callable $callback, string $reason, ?string $balance, string $last4): void
    {
        try {
            $this->inSale($organization, $callback);
            $this->fail('Expected GIFT_CARD_INVALID.');
        } catch (BusinessRuleViolation $e) {
            $this->assertSame('GIFT_CARD_INVALID', $e->errorCode);
            $this->assertSame($reason, $e->details['reason']);
            $this->assertSame($balance, $e->details['balance'] ?? null);
            $this->assertSame($last4, $e->details['code_last4'] ?? null, 'the refusal names the tender by its last 4');
            $this->assertStringNotContainsString('NOPE', $e->getMessage());
        }
    }

    /**
     * The plain code appears in no stored row (cards, entries, ledger, audit) nor in the given responses.
     *
     * @param  list<string>  $responses
     */
    private function assertCodeNowhere(string $plain, array $responses): void
    {
        $formatted = implode('-', str_split($plain, 4));
        $stored = json_encode([
            DB::table('gift_cards')->get(),
            DB::table('gift_card_entries')->get(),
            DB::table('payments')->get(),
            DB::table('audit_logs')->get(),
        ]);
        foreach ([$plain, $formatted] as $needle) {
            $this->assertStringNotContainsStringIgnoringCase($needle, (string) $stored);
            foreach ($responses as $response) {
                $this->assertStringNotContainsStringIgnoringCase($needle, $response);
            }
        }
    }
}
