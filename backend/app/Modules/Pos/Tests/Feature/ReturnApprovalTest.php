<?php

namespace App\Modules\Pos\Tests\Feature;

use App\Modules\Pos\Application\Contracts\TillApprovals;
use App\Modules\Pos\Tests\Concerns\InteractsWithTills;
use App\Modules\Sales\Tests\Concerns\InteractsWithSales;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * POS1c §2: a manager approves a return at the till (an exchange) with their PIN — action
 * `return`, approver permission `returns.approve`, bound to `details.sale_id`.
 */
class ReturnApprovalTest extends TestCase
{
    use InteractsWithSales, InteractsWithTenancy, InteractsWithTills, RefreshDatabase;

    public function test_the_approvers_of_a_return_are_people_who_may_approve_returns(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $store = $this->mainStoreId($org);
        $manager = $this->setPin($this->createUserWithRole($org, SystemRole::BranchManager, [$branch->id]));
        $manager->forceFill(['name' => 'Arif'])->saveQuietly();
        $owner = $this->setPin($admin);
        $owner->forceFill(['name' => 'Zara'])->saveQuietly();
        // Left out: cashiers and accountants (no `returns.approve`), even with a PIN.
        $this->setPin($this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]));
        $this->setPin($this->createUserWithRole($org, SystemRole::Accountant, [$branch->id]));
        $cashier = $this->setPin($this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]));

        $this->actingAsUser($cashier);
        $this->getJson("/api/v1/pos/approvers?action=return&store_id={$store}")->assertOk()
            ->assertJsonPath('data', [['id' => $manager->id, 'name' => 'Arif'], ['id' => $owner->id, 'name' => 'Zara']]);
    }

    public function test_a_return_approval_is_bound_to_the_invoice_and_used_once(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        ['admin' => $otherAdmin, 'organization' => $other, 'branch' => $otherBranch] = $this->provisionTenant('Other Shop');
        $store = $this->mainStoreId($org);
        $soap = $this->sellable($org, 'Soap', '10.00');
        $this->actingAsUser($admin);
        $this->stockUp($store, $soap, '10');
        $manager = $this->setPin($this->createUserWithRole($org, SystemRole::BranchManager, [$branch->id]), '4713');
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]);
        $this->actingAsUser($cashier);
        $saleId = $this->checkout($this->cart($store, [[$soap, '1']], [['cash', '10.00']]))->assertCreated()->json('data.id');
        $secondSaleId = $this->checkout($this->cart($store, [[$soap, '1']], [['cash', '10.00']]))->assertCreated()->json('data.id');

        // Another organization's invoice is unknown here.
        $outsider = $this->createUserWithRole($other, SystemRole::BranchManager, [$otherBranch->id]);
        $otherStore = $this->mainStoreId($other);
        $foreignSoap = $this->sellable($other, 'Soap', '10.00');
        $this->actingAsUser($otherAdmin);
        $this->stockUp($otherStore, $foreignSoap, '5');
        $foreignSaleId = $this->checkout($this->cart($otherStore, [[$foreignSoap, '1']], [['cash', '10.00']]))->assertCreated()->json('data.id');
        $this->actingAsUser($cashier);

        $ask = fn (array $extra = []) => $this->postJson('/api/v1/pos/approvals', $extra + [
            'action' => 'return', 'approver_id' => $manager->id, 'pin' => '4713', 'store_id' => $store,
        ]);
        $ask()->assertStatus(422)->assertJsonValidationErrors('details.sale_id', 'error.details');
        $ask(['details' => ['sale_id' => 'nope']])->assertStatus(422)->assertJsonValidationErrors('details.sale_id', 'error.details');
        $ask(['details' => ['sale_id' => (string) Str::uuid()]])->assertStatus(422)->assertJsonValidationErrors('details.sale_id', 'error.details');
        $ask(['details' => ['sale_id' => $foreignSaleId]])->assertStatus(422)->assertJsonValidationErrors('details.sale_id', 'error.details');
        // A cashier cannot approve a return.
        $ask(['approver_id' => $this->setPin($this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]))->id, 'pin' => '2580', 'details' => ['sale_id' => $saleId]])
            ->assertStatus(422)->assertJsonPath('error.code', 'APPROVER_NOT_ALLOWED');
        $this->assertDatabaseCount('pos_approvals', 0);

        $id = $ask(['details' => ['sale_id' => $saleId]])->assertCreated()
            ->assertJsonPath('data.action', 'return')
            ->assertJsonPath('data.approver.id', $manager->id)
            ->json('data.id');
        $this->assertSame(['sale_id' => $saleId], json_decode((string) DB::table('pos_approvals')->where('id', $id)->value('details'), true));

        $approvals = app(TillApprovals::class);
        $this->inTenant($org, function () use ($approvals, $id, $cashier, $manager, $saleId, $secondSaleId, $store) {
            $this->assertSame(
                ['id' => $id, 'approver_id' => $manager->id, 'approver_name' => $manager->name],
                $approvals->check($id, $cashier->id, TillApprovals::RETURN, ['sale_id' => $saleId, 'store_id' => $store]),
            );
            // Bound to the invoice, the action and the cashier.
            $this->assertInvalid(fn () => $approvals->check($id, $cashier->id, TillApprovals::RETURN, ['sale_id' => $secondSaleId]));
            $this->assertInvalid(fn () => $approvals->check($id, $cashier->id, TillApprovals::RETURN, []));
            $this->assertInvalid(fn () => $approvals->check($id, $cashier->id, TillApprovals::DISCOUNT, []));
            $this->assertInvalid(fn () => $approvals->check($id, $manager->id, TillApprovals::RETURN, ['sale_id' => $saleId]));

            // Used by the exchange's new sale, once.
            $newSaleId = (string) Str::uuid();
            DB::transaction(fn () => $approvals->consume($id, $newSaleId));
            $this->assertInvalid(fn () => DB::transaction(fn () => $approvals->consume($id, (string) Str::uuid())));
            $this->assertInvalid(fn () => $approvals->check($id, $cashier->id, TillApprovals::RETURN, ['sale_id' => $saleId]));
            $this->assertDatabaseHas('pos_approvals', ['id' => $id, 'sale_id' => $newSaleId]);
        });

        // Another organization cannot use it.
        $this->inTenant($other, fn () => $this->assertInvalid(fn () => app(TillApprovals::class)->check($id, $outsider->id, TillApprovals::RETURN, ['sale_id' => $saleId])));
    }

    public function test_the_database_accepts_the_return_action(): void
    {
        $constraint = DB::selectOne("SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'pos_approvals_action_check'");

        $this->assertStringContainsString("'return'", $constraint->def);
        $this->assertStringContainsString("'price_override'", $constraint->def);
        $this->assertStringContainsString("'discount'", $constraint->def);
    }

    private function assertInvalid(callable $call): void
    {
        try {
            $call();
        } catch (BusinessRuleViolation $e) {
            $this->assertSame('APPROVAL_INVALID', $e->errorCode);

            return;
        }

        $this->fail('Expected APPROVAL_INVALID.');
    }
}
