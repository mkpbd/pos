<?php

namespace App\Modules\Payments\Tests\Feature;

use App\Modules\Payments\Infrastructure\Models\Payment;
use App\Modules\Payments\Tests\Concerns\InteractsWithRegisters;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use LogicException;
use Tests\TestCase;

/**
 * Critical workflow #11: cash register opening, cash in/out and closing with reconciliation.
 */
class CashRegisterTest extends TestCase
{
    use InteractsWithRegisters, InteractsWithTenancy, RefreshDatabase;

    public function test_a_session_is_opened_moved_and_closed_with_its_variance(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $register = $this->register($org->id, $branch->id, 'T1');
        $this->actingAsUser($admin);

        $session = $this->postJson("/api/v1/cash-registers/{$register->id}/sessions", ['opening_float' => '500'])
            ->assertCreated()
            ->assertJsonPath('data.number', 'SES-MAIN-000001')
            ->assertJsonPath('data.status', 'open')
            ->assertJsonPath('data.cash.expected', '500.00')
            ->json('data');

        $this->postJson("/api/v1/register-sessions/{$session['id']}/cash-movements", ['direction' => 'in', 'amount' => '200', 'reason' => 'Change from safe'], ['Idempotency-Key' => (string) Str::uuid()])
            ->assertOk()
            ->assertJsonPath('data.cash.cash_in', '200.00')
            ->assertJsonPath('data.cash.expected', '700.00');
        $this->postJson("/api/v1/register-sessions/{$session['id']}/cash-movements", ['direction' => 'out', 'amount' => '650', 'reason' => 'Bank drop'], ['Idempotency-Key' => (string) Str::uuid()])
            ->assertOk()
            ->assertJsonPath('data.cash.expected', '50.00')
            ->assertJsonPath('data.by_source.1.label', 'Cash out');

        $this->postJson("/api/v1/register-sessions/{$session['id']}/cash-movements", ['direction' => 'out', 'amount' => '50.01', 'reason' => 'Too much'], ['Idempotency-Key' => (string) Str::uuid()])
            ->assertStatus(422)
            ->assertJsonPath('error.code', 'INSUFFICIENT_CASH')
            ->assertJsonPath('error.details.available', '50.00');

        $this->getJson('/api/v1/register-sessions/current')->assertOk()->assertJsonPath('data.id', $session['id']);

        $this->postJson("/api/v1/register-sessions/{$session['id']}/close", ['counted_cash' => '45.50', 'notes' => 'Short'])
            ->assertOk()
            ->assertJsonPath('data.status', 'closed')
            ->assertJsonPath('data.expected_cash', '50.00')
            ->assertJsonPath('data.counted_cash', '45.50')
            ->assertJsonPath('data.variance', '-4.50');

        $this->postJson("/api/v1/register-sessions/{$session['id']}/close", ['counted_cash' => '50'])
            ->assertStatus(422)
            ->assertJsonPath('error.code', 'SESSION_CLOSED');
        $this->getJson('/api/v1/register-sessions/current')->assertOk()->assertJsonPath('data', null);

        $this->getJson('/api/v1/payments?method=cash')
            ->assertOk()
            ->assertJsonPath('meta.pagination.total', 2)
            ->assertJsonPath('meta.totals.in', '200.00')
            ->assertJsonPath('meta.totals.out', '650.00')
            ->assertJsonPath('meta.totals.net', '-450.00');

        $this->expectException(LogicException::class);
        Payment::query()->withoutGlobalScopes()->firstOrFail()->update(['amount' => '1.00']);
    }

    public function test_one_session_per_register_and_per_cashier(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]);
        $first = $this->register($org->id, $branch->id, 'T1');
        $second = $this->register($org->id, $branch->id, 'T2');

        $this->actingAsUser($cashier);
        $this->postJson("/api/v1/cash-registers/{$first->id}/sessions", ['opening_float' => '0'])->assertCreated();
        $this->postJson("/api/v1/cash-registers/{$second->id}/sessions", ['opening_float' => '0'])
            ->assertStatus(422)
            ->assertJsonPath('error.code', 'SESSION_ALREADY_OPEN');

        $this->actingAsUser($admin);
        $this->postJson("/api/v1/cash-registers/{$first->id}/sessions", ['opening_float' => '0'])
            ->assertStatus(422)
            ->assertJsonPath('error.code', 'REGISTER_IN_USE');
        $this->getJson('/api/v1/cash-registers')
            ->assertOk()
            ->assertJsonPath('data.0.code', 'T1')
            ->assertJsonPath('data.0.open_session.opened_by.id', $cashier->id)
            ->assertJsonPath('data.1.open_session', null);
    }

    public function test_cashiers_see_and_close_only_their_own_sessions_managers_any(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]);
        $colleague = $this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]);
        $mine = $this->openSession($cashier, $branch->id, '100');
        $theirs = $this->openSession($colleague, $branch->id, '100');

        $this->actingAsUser($cashier);
        $this->getJson('/api/v1/register-sessions')->assertOk()->assertJsonPath('meta.pagination.total', 1)->assertJsonPath('data.0.id', $mine->id);
        $this->getJson("/api/v1/register-sessions/{$theirs->id}")->assertNotFound();
        $this->postJson("/api/v1/register-sessions/{$theirs->id}/close", ['counted_cash' => '100'])->assertNotFound();
        $this->postJson("/api/v1/register-sessions/{$theirs->id}/cash-movements", ['direction' => 'in', 'amount' => '1', 'reason' => 'x'], ['Idempotency-Key' => (string) Str::uuid()])->assertNotFound();
        $this->getJson('/api/v1/payments')->assertForbidden();
        $this->postJson('/api/v1/cash-registers', ['branch_id' => $branch->id, 'code' => 'X', 'name' => 'X'])->assertForbidden();

        $this->actingAsUser($admin);
        $this->getJson('/api/v1/register-sessions')->assertOk()->assertJsonPath('meta.pagination.total', 2);
        $this->postJson("/api/v1/register-sessions/{$theirs->id}/close", ['counted_cash' => '100'])
            ->assertOk()
            ->assertJsonPath('data.variance', '0.00')
            ->assertJsonPath('data.closed_by.id', $admin->id);
    }

    public function test_registers_are_isolated_per_organization(): void
    {
        ['organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        ['admin' => $intruder] = $this->provisionTenant('Other Shop');
        $register = $this->register($org->id, $branch->id, 'T1');

        $this->actingAsUser($intruder);
        $this->getJson('/api/v1/cash-registers')->assertOk()->assertJsonCount(0, 'data');
        $this->postJson("/api/v1/cash-registers/{$register->id}/sessions", ['opening_float' => '0'])->assertNotFound();
        $this->putJson("/api/v1/cash-registers/{$register->id}", ['name' => 'Mine'])->assertNotFound();
    }

    public function test_managers_create_registers_with_unique_codes(): void
    {
        ['admin' => $admin, 'branch' => $branch] = $this->provisionTenant();
        $this->actingAsUser($admin);

        $this->postJson('/api/v1/cash-registers', ['branch_id' => $branch->id, 'code' => 'T1', 'name' => 'Front till'])
            ->assertCreated()
            ->assertJsonPath('data.branch.code', 'MAIN')
            ->assertJsonPath('data.is_active', true);
        $this->postJson('/api/v1/cash-registers', ['branch_id' => $branch->id, 'code' => 't1', 'name' => 'Dup'])
            ->assertStatus(422)
            ->assertJsonValidationErrors('code', 'error.details');
    }
}
