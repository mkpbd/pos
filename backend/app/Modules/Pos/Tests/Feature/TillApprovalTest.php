<?php

namespace App\Modules\Pos\Tests\Feature;

use App\Modules\Audit\Infrastructure\Models\AuditLog;
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
 * POS1a §2: manager approval by PIN at the till and the TillApprovals contract used by checkout.
 */
class TillApprovalTest extends TestCase
{
    use InteractsWithSales, InteractsWithTenancy, InteractsWithTills, RefreshDatabase;

    public function test_the_approvers_are_managers_of_the_branch_with_a_pin(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        ['organization' => $other, 'branch' => $otherBranch] = $this->provisionTenant('Other Shop');
        $store = $this->mainStoreId($org);
        $second = $this->createBranch($org, 'B2');

        $manager = $this->setPin($this->createUserWithRole($org, SystemRole::BranchManager, [$branch->id]));
        $manager->forceFill(['name' => 'Arif'])->saveQuietly();
        $owner = $this->setPin($admin);
        $owner->forceFill(['name' => 'Zara'])->saveQuietly();
        // Left out: a manager without a PIN, of another branch, of another organization, a cashier.
        $this->createUserWithRole($org, SystemRole::BranchManager, [$branch->id]);
        $this->setPin($this->createUserWithRole($org, SystemRole::BranchManager, [$second->id]));
        $this->setPin($this->createUserWithRole($other, SystemRole::BranchManager, [$otherBranch->id]));
        $cashier = $this->setPin($this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]));

        $this->actingAsUser($cashier);
        $this->getJson("/api/v1/pos/approvers?action=discount&store_id={$store}")->assertOk()
            ->assertJsonPath('data', [['id' => $manager->id, 'name' => 'Arif'], ['id' => $owner->id, 'name' => 'Zara']]);
        $this->getJson("/api/v1/pos/approvers?action=price_override&store_id={$store}")->assertOk()
            ->assertJsonPath('data', [['id' => $manager->id, 'name' => 'Arif'], ['id' => $owner->id, 'name' => 'Zara']]);
        $this->getJson("/api/v1/pos/approvers?action=void&store_id={$store}")->assertStatus(422);
        $this->getJson('/api/v1/pos/approvers?action=discount&store_id='.$this->mainStoreId($other))->assertStatus(422);

        // The requester is never their own approver.
        $this->actingAsUser($manager);
        $this->getJson("/api/v1/pos/approvers?action=discount&store_id={$store}")->assertOk()
            ->assertJsonPath('data', [['id' => $owner->id, 'name' => 'Zara']]);
    }

    public function test_a_manager_approves_with_their_pin_and_the_checkout_uses_it_once(): void
    {
        ['organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $store = $this->mainStoreId($org);
        $soap = $this->sellable($org, 'Soap', '10.00');
        $manager = $this->setPin($this->createUserWithRole($org, SystemRole::BranchManager, [$branch->id]), '4713');
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]);
        $this->actingAsUser($cashier);

        $approval = $this->postJson('/api/v1/pos/approvals', [
            'action' => 'price_override', 'approver_id' => $manager->id, 'pin' => '4713', 'store_id' => $store,
            'details' => ['variant_id' => $soap->id, 'unit_price' => '8.50'],
        ])->assertCreated()
            ->assertJsonPath('data.action', 'price_override')
            ->assertJsonPath('data.approver', ['id' => $manager->id, 'name' => $manager->name])
            ->json('data');
        $this->assertEqualsWithDelta(now()->addMinutes(10)->getTimestamp(), strtotime($approval['expires_at']), 2);
        $this->assertDatabaseHas('pos_approvals', ['id' => $approval['id'], 'requester_id' => $cashier->id, 'approver_id' => $manager->id, 'store_id' => $store]);

        $audit = AuditLog::query()->withoutGlobalScopes()->where('action', 'pos.approval_given')->sole();
        $this->assertSame($cashier->id, $audit->user_id);
        $this->assertSame($manager->id, $audit->context['approver_id']);
        $this->assertStringNotContainsString('4713', json_encode($audit->context));

        $approvals = app(TillApprovals::class);
        $this->inTenant($org, function () use ($approvals, $approval, $cashier, $manager, $soap, $store) {
            $this->assertSame(
                ['id' => $approval['id'], 'approver_id' => $manager->id, 'approver_name' => $manager->name],
                $approvals->check($approval['id'], $cashier->id, 'price_override', ['variant_id' => $soap->id, 'store_id' => $store]),
            );
            // Bound to the cashier, the action, the variant and the store.
            $this->assertInvalid(fn () => $approvals->check($approval['id'], $manager->id, 'price_override', ['variant_id' => $soap->id]));
            $this->assertInvalid(fn () => $approvals->check($approval['id'], $cashier->id, 'discount', []));
            $this->assertInvalid(fn () => $approvals->check($approval['id'], $cashier->id, 'price_override', ['variant_id' => (string) Str::uuid()]));
            $this->assertInvalid(fn () => $approvals->check($approval['id'], $cashier->id, 'price_override', ['variant_id' => $soap->id, 'store_id' => (string) Str::uuid()]));
            $this->assertInvalid(fn () => $approvals->check('not-a-uuid', $cashier->id, 'price_override', ['variant_id' => $soap->id]));

            $saleId = (string) Str::uuid();
            DB::transaction(fn () => $approvals->consume($approval['id'], $saleId));
            // The same sale may use it for several lines; another sale may not.
            DB::transaction(fn () => $approvals->consume($approval['id'], $saleId));
            $this->assertInvalid(fn () => DB::transaction(fn () => $approvals->consume($approval['id'], (string) Str::uuid())));
            $this->assertInvalid(fn () => $approvals->check($approval['id'], $cashier->id, 'price_override', ['variant_id' => $soap->id]));
            $this->assertDatabaseHas('pos_approvals', ['id' => $approval['id'], 'sale_id' => $saleId]);
        });
    }

    public function test_an_approval_expires_after_ten_minutes(): void
    {
        ['organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $store = $this->mainStoreId($org);
        $manager = $this->setPin($this->createUserWithRole($org, SystemRole::BranchManager, [$branch->id]));
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]);
        $this->actingAsUser($cashier);

        $id = $this->postJson('/api/v1/pos/approvals', [
            'action' => 'discount', 'approver_id' => $manager->id, 'pin' => '2580', 'store_id' => $store, 'details' => ['scope' => 'invoice'],
        ])->assertCreated()->json('data.id');
        $this->assertSame(['scope' => 'invoice'], json_decode((string) DB::table('pos_approvals')->value('details'), true));

        $approvals = app(TillApprovals::class);
        $this->inTenant($org, fn () => $approvals->check($id, $cashier->id, 'discount', []));
        $this->travel(11)->minutes();
        $this->inTenant($org, function () use ($approvals, $id, $cashier) {
            $this->assertInvalid(fn () => $approvals->check($id, $cashier->id, 'discount', []));
            $this->assertInvalid(fn () => DB::transaction(fn () => $approvals->consume($id, (string) Str::uuid())));
        });
    }

    public function test_wrong_pins_lock_the_approvers_pin(): void
    {
        ['organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $store = $this->mainStoreId($org);
        $manager = $this->setPin($this->createUserWithRole($org, SystemRole::BranchManager, [$branch->id]));
        $this->actingAsUser($this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]));
        $ask = fn (string $pin) => $this->postJson('/api/v1/pos/approvals', ['action' => 'discount', 'approver_id' => $manager->id, 'pin' => $pin, 'store_id' => $store]);

        foreach ([4, 3, 2, 1] as $left) {
            $ask('1357')->assertStatus(422)->assertJsonPath('error.code', 'PIN_INVALID')->assertJsonPath('error.details.attempts_left', $left);
        }
        $ask('1357')->assertStatus(423)->assertJsonPath('error.code', 'PIN_LOCKED');
        $ask('2580')->assertStatus(423)->assertJsonPath('error.code', 'PIN_LOCKED');
        $this->assertDatabaseCount('pos_approvals', 0);

        // The approver's PIN is locked for signing in too.
        $this->assertNotNull($manager->fresh()->pin_locked_until);
    }

    public function test_only_allowed_approvers_can_approve(): void
    {
        ['organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        ['organization' => $other, 'branch' => $otherBranch] = $this->provisionTenant('Other Shop');
        $store = $this->mainStoreId($org);
        $soap = $this->sellable($org, 'Soap', '10.00');
        $second = $this->createBranch($org, 'B2');
        $cashier = $this->setPin($this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]));
        $otherCashier = $this->setPin($this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]));
        $elsewhere = $this->setPin($this->createUserWithRole($org, SystemRole::BranchManager, [$second->id]));
        $foreign = $this->setPin($this->createUserWithRole($other, SystemRole::BranchManager, [$otherBranch->id]));
        $noPin = $this->createUserWithRole($org, SystemRole::BranchManager, [$branch->id]);
        $manager = $this->setPin($this->createUserWithRole($org, SystemRole::BranchManager, [$branch->id]));
        $this->actingAsUser($cashier);
        $ask = fn (string $approverId, array $extra = []) => $this->postJson('/api/v1/pos/approvals', $extra + [
            'action' => 'discount', 'approver_id' => $approverId, 'pin' => '2580', 'store_id' => $store,
        ]);

        foreach ([$otherCashier, $elsewhere, $foreign, $cashier] as $user) {
            $ask($user->id)->assertStatus(422)->assertJsonPath('error.code', 'APPROVER_NOT_ALLOWED');
        }
        $ask((string) Str::uuid())->assertStatus(422)->assertJsonPath('error.code', 'APPROVER_NOT_ALLOWED');
        $ask($noPin->id)->assertStatus(422)->assertJsonPath('error.code', 'PIN_NOT_SET');
        $this->assertSame(0, (int) $foreign->fresh()->pin_failed_count);

        // A price change is bound to an item of the organization; the store must be the cashier's.
        $ask($manager->id, ['action' => 'price_override'])->assertStatus(422)->assertJsonValidationErrors('details.variant_id', 'error.details');
        $ask($manager->id, ['action' => 'price_override', 'details' => ['variant_id' => (string) Str::uuid()]])
            ->assertStatus(422)->assertJsonValidationErrors('details.variant_id', 'error.details');
        $ask($manager->id, ['store_id' => $this->mainStoreId($other)])->assertStatus(422)->assertJsonValidationErrors('store_id', 'error.details');
        $this->assertDatabaseCount('pos_approvals', 0);

        $id = $ask($manager->id, ['action' => 'price_override', 'details' => ['variant_id' => $soap->id]])->assertCreated()->json('data.id');

        // Another organization cannot use (or even see) the approval.
        $outsider = $this->createUserWithRole($other, SystemRole::Cashier, [$otherBranch->id]);
        $this->inTenant($other, fn () => $this->assertInvalid(fn () => app(TillApprovals::class)->check($id, $outsider->id, 'price_override', ['variant_id' => $soap->id])));
        $this->inTenant($other, fn () => $this->assertInvalid(fn () => DB::transaction(fn () => app(TillApprovals::class)->consume($id, (string) Str::uuid()))));
        $this->assertNull(DB::table('pos_approvals')->where('id', $id)->value('used_at'));
    }

    public function test_approvals_need_the_pos_and_are_throttled(): void
    {
        ['organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $store = $this->mainStoreId($org);
        $manager = $this->setPin($this->createUserWithRole($org, SystemRole::BranchManager, [$branch->id]));

        $this->actingAsUser($this->createUserWithRole($org, SystemRole::InventoryManager, [$branch->id]));
        $this->getJson("/api/v1/pos/approvers?action=discount&store_id={$store}")->assertForbidden();
        $this->postJson('/api/v1/pos/approvals', ['action' => 'discount', 'approver_id' => (string) Str::uuid(), 'pin' => '2580', 'store_id' => $store])->assertForbidden();

        $this->actingAsUser($this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]));
        foreach (range(1, 10) as $i) {
            $this->postJson('/api/v1/pos/approvals', ['action' => 'discount', 'approver_id' => $manager->id, 'pin' => '2580', 'store_id' => $store])->assertCreated();
        }
        $this->postJson('/api/v1/pos/approvals', ['action' => 'discount', 'approver_id' => $manager->id, 'pin' => '2580', 'store_id' => $store])->assertStatus(429);
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
