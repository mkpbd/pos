<?php

namespace App\Modules\Expenses\Tests\Feature;

use App\Modules\Payments\Infrastructure\Models\Payment;
use App\Modules\Payments\Tests\Concerns\InteractsWithRegisters;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

class ExpenseTest extends TestCase
{
    use InteractsWithRegisters, InteractsWithTenancy, RefreshDatabase;

    public function test_expenses_and_income_move_money_through_the_ledger_and_can_be_voided(): void
    {
        ['admin' => $admin, 'branch' => $branch] = $this->provisionTenant();
        $this->actingAsUser($admin);
        $rent = $this->postJson('/api/v1/expense-categories', ['type' => 'expense', 'name' => 'Rent'])->assertCreated()->json('data');
        $tea = $this->postJson('/api/v1/expense-categories', ['type' => 'expense', 'name' => 'Staff tea'])->assertCreated()->json('data');
        $commission = $this->postJson('/api/v1/expense-categories', ['type' => 'income', 'name' => 'Commission'])->assertCreated()->json('data');
        $this->postJson('/api/v1/expense-categories', ['type' => 'expense', 'name' => 'rent'])->assertStatus(422);
        $this->postJson('/api/v1/expense-categories', ['type' => 'income', 'name' => 'Rent'])->assertCreated();

        $entry = fn (array $data) => $this->record(['branch_id' => $branch->id, 'occurred_on' => now()->toDateString()] + $data);

        $entry(['type' => 'expense', 'expense_category_id' => $tea['id'], 'amount' => '80', 'method' => 'cash'])
            ->assertStatus(422)->assertJsonPath('error.code', 'CASH_SESSION_REQUIRED');
        $session = $this->openSession($admin, $branch->id, '100.00');
        $entry(['type' => 'expense', 'expense_category_id' => $tea['id'], 'amount' => '150', 'method' => 'cash'])
            ->assertStatus(422)->assertJsonPath('error.code', 'INSUFFICIENT_CASH');
        $entry(['type' => 'income', 'expense_category_id' => $tea['id'], 'amount' => '10', 'method' => 'cash'])
            ->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['expense_category_id']]]);

        $teaEntry = $entry(['type' => 'expense', 'expense_category_id' => $tea['id'], 'amount' => '80', 'method' => 'cash', 'party' => 'Tea stall'])
            ->assertCreated()->assertJsonPath('data.number', 'EXP-000001')->assertJsonPath('data.category.name', 'Staff tea')->json('data');
        $entry(['type' => 'expense', 'expense_category_id' => $rent['id'], 'amount' => '25000', 'method' => 'bank_transfer', 'reference' => 'CHQ-77'])
            ->assertCreated()->assertJsonPath('data.number', 'EXP-000002');
        $entry(['type' => 'income', 'expense_category_id' => $commission['id'], 'amount' => '500', 'method' => 'cash'])
            ->assertCreated()->assertJsonPath('data.number', 'INC-000001');

        $this->getJson('/api/v1/expenses')
            ->assertOk()
            ->assertJsonPath('meta.pagination.total', 2)
            ->assertJsonPath('meta.totals.amount', '25080.00')
            ->assertJsonPath('meta.by_category.0.name', 'Rent');
        $this->getJson('/api/v1/expenses?type=income')->assertOk()->assertJsonPath('meta.totals.amount', '500.00');
        $this->getJson("/api/v1/register-sessions/{$session->id}")->assertOk()->assertJsonPath('data.cash.expected', '520.00');

        $this->postJson("/api/v1/expenses/{$teaEntry['id']}/void", ['reason' => 'Entered twice'])
            ->assertOk()->assertJsonPath('data.void_reason', 'Entered twice')->assertJsonPath('data.voided_by.id', $admin->id);
        $this->postJson("/api/v1/expenses/{$teaEntry['id']}/void", ['reason' => 'again'])
            ->assertStatus(422)->assertJsonPath('error.code', 'ALREADY_VOIDED');
        $this->getJson("/api/v1/register-sessions/{$session->id}")->assertOk()->assertJsonPath('data.cash.expected', '600.00');
        $this->getJson('/api/v1/expenses')->assertJsonPath('meta.totals.amount', '25000.00');
        $this->getJson('/api/v1/expenses?voided=true')->assertJsonPath('meta.pagination.total', 1);
        $this->assertSame(['expense', 'expense', 'income', 'expense_void'], Payment::query()->orderBy('created_at')->orderBy('id')->pluck('source_type')->all());
        $this->delete("/api/v1/expense-categories/{$tea['id']}")->assertStatus(422)->assertJsonPath('error.code', 'IN_USE');
    }

    public function test_cashiers_cannot_record_expenses_and_other_organizations_see_nothing(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $this->actingAsUser($admin);
        $rent = $this->postJson('/api/v1/expense-categories', ['type' => 'expense', 'name' => 'Rent'])->json('data');
        $expense = $this->record(['type' => 'expense', 'branch_id' => $branch->id, 'expense_category_id' => $rent['id'], 'amount' => '100', 'method' => 'card', 'occurred_on' => now()->toDateString()])->json('data');

        $this->actingAsUser($this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]));
        $this->getJson('/api/v1/expenses')->assertForbidden();
        $this->record(['type' => 'expense', 'branch_id' => $branch->id, 'expense_category_id' => $rent['id'], 'amount' => '1', 'method' => 'card', 'occurred_on' => now()->toDateString()])->assertForbidden();

        $this->actingAsUser($this->createUserWithRole($org, SystemRole::Accountant, [$branch->id]));
        $this->getJson("/api/v1/expenses/{$expense['id']}")->assertOk();

        ['admin' => $stranger] = $this->provisionTenant('Other Shop');
        $this->actingAsUser($stranger);
        $this->getJson("/api/v1/expenses/{$expense['id']}")->assertNotFound();
        $this->getJson('/api/v1/expense-categories')->assertOk()->assertJsonCount(0, 'data');
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function record(array $payload): TestResponse
    {
        return $this->postJson('/api/v1/expenses', $payload, ['Idempotency-Key' => (string) Str::uuid()]);
    }
}
