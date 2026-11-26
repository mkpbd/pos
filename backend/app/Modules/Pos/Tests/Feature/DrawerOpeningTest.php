<?php

namespace App\Modules\Pos\Tests\Feature;

use App\Modules\Audit\Infrastructure\Models\AuditLog;
use App\Modules\Organizations\Application\Support\OrganizationDate;
use App\Modules\Pos\Application\Contracts\DrawerOpenings;
use App\Modules\Pos\Tests\Concerns\InteractsWithTills;
use App\Modules\Sales\Tests\Concerns\InteractsWithSales;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * POS1d §1: the cash drawer opened at the till without a sale — `pos.no_sale` or a manager's
 * `no_sale` approval by PIN, recorded on the cashier's open register session.
 */
class DrawerOpeningTest extends TestCase
{
    use InteractsWithSales, InteractsWithTenancy, InteractsWithTills, RefreshDatabase;

    public function test_a_manager_opens_the_drawer_and_it_is_recorded_on_their_session(): void
    {
        ['organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $store = $this->mainStoreId($org);
        $manager = $this->createUserWithRole($org, SystemRole::BranchManager, [$branch->id]);
        $session = $this->openSession($manager, $branch->id);
        $this->actingAsUser($manager);

        $this->open(['store_id' => $store])->assertStatus(422)->assertJsonValidationErrors('reason', 'error.details');
        $this->open(['store_id' => $store, 'reason' => str_repeat('x', 201)])->assertStatus(422)->assertJsonValidationErrors('reason', 'error.details');
        $this->open(['store_id' => (string) Str::uuid(), 'reason' => 'Change'])->assertStatus(422)->assertJsonValidationErrors('store_id', 'error.details');

        $opening = $this->open(['store_id' => $store, 'reason' => '  Change for a customer  '])->assertCreated()
            ->assertJsonPath('data.approved_by', null)
            ->json('data');
        $this->assertEqualsWithDelta(now()->getTimestamp(), strtotime($opening['opened_at']), 5);
        $this->assertDatabaseHas('pos_drawer_openings', [
            'id' => $opening['id'],
            'organization_id' => $org->id,
            'branch_id' => $branch->id,
            'store_id' => $store,
            'register_session_id' => $session->id,
            'register_session_number' => $session->number,
            'terminal_id' => null,
            'user_id' => $manager->id,
            'approved_by' => null,
            'reason' => 'Change for a customer',
        ]);
        // No money moves.
        $this->assertDatabaseCount('payments', 0);

        $audit = AuditLog::query()->withoutGlobalScopes()->where('action', 'pos.drawer_opened')->sole();
        $this->assertSame($manager->id, $audit->user_id);
        $this->assertSame($opening['id'], $audit->subject_id);
        $this->assertEquals(['reason' => 'Change for a customer', 'register_session' => $session->number, 'approved_by' => null], $audit->new_values);
    }

    public function test_a_cashier_needs_a_managers_no_sale_approval_used_once(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $store = $this->mainStoreId($org);
        $manager = $this->setPin($this->createUserWithRole($org, SystemRole::BranchManager, [$branch->id]), '4713');
        $manager->forceFill(['name' => 'Arif'])->saveQuietly();
        $owner = $this->setPin($admin);
        $owner->forceFill(['name' => 'Zara'])->saveQuietly();
        $otherCashier = $this->setPin($this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]));
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]);
        $session = $this->openSession($cashier, $branch->id);
        $this->actingAsUser($cashier);

        // Approvers: those with `pos.no_sale` (not cashiers).
        $this->getJson("/api/v1/pos/approvers?action=no_sale&store_id={$store}")->assertOk()
            ->assertJsonPath('data', [['id' => $manager->id, 'name' => 'Arif'], ['id' => $owner->id, 'name' => 'Zara']]);

        $this->open(['store_id' => $store, 'reason' => 'Change'])->assertStatus(422)
            ->assertJsonPath('error.code', 'APPROVAL_REQUIRED')
            ->assertJsonPath('error.details.action', 'no_sale');
        $this->postJson('/api/v1/pos/approvals', ['action' => 'no_sale', 'approver_id' => $otherCashier->id, 'pin' => '2580', 'store_id' => $store])
            ->assertStatus(422)->assertJsonPath('error.code', 'APPROVER_NOT_ALLOWED');

        $approvalId = $this->approve($manager, '4713', $store);
        $this->assertSame([], json_decode((string) DB::table('pos_approvals')->where('id', $approvalId)->value('details'), true));

        // An approval for another action does not open the drawer.
        $discount = $this->postJson('/api/v1/pos/approvals', ['action' => 'discount', 'approver_id' => $manager->id, 'pin' => '4713', 'store_id' => $store])->assertCreated()->json('data.id');
        $this->open(['store_id' => $store, 'reason' => 'Change', 'approval_id' => $discount])->assertStatus(422)->assertJsonPath('error.code', 'APPROVAL_INVALID');
        $this->open(['store_id' => $store, 'reason' => 'Change', 'approval_id' => (string) Str::uuid()])->assertStatus(422)->assertJsonPath('error.code', 'APPROVAL_INVALID');

        // Another cashier cannot use it.
        $this->openSession($otherCashier, $branch->id);
        $this->actingAsUser($otherCashier);
        $this->open(['store_id' => $store, 'reason' => 'Change', 'approval_id' => $approvalId])->assertStatus(422)->assertJsonPath('error.code', 'APPROVAL_INVALID');

        $this->actingAsUser($cashier);
        $opening = $this->open(['store_id' => $store, 'reason' => 'Customer change', 'approval_id' => $approvalId])->assertCreated()
            ->assertJsonPath('data.approved_by', ['id' => $manager->id, 'name' => 'Arif'])
            ->json('data');
        $this->assertDatabaseHas('pos_drawer_openings', ['id' => $opening['id'], 'user_id' => $cashier->id, 'approved_by' => $manager->id, 'approval_id' => $approvalId, 'register_session_id' => $session->id]);
        $this->assertDatabaseHas('pos_approvals', ['id' => $approvalId, 'sale_id' => $opening['id']]);
        $this->assertNotNull(DB::table('pos_approvals')->where('id', $approvalId)->value('used_at'));

        // Used once.
        $this->open(['store_id' => $store, 'reason' => 'Again', 'approval_id' => $approvalId])->assertStatus(422)->assertJsonPath('error.code', 'APPROVAL_INVALID');
        $this->assertDatabaseCount('pos_drawer_openings', 1);

        // Expired after 10 minutes.
        $late = $this->approve($manager, '4713', $store);
        $this->travel(11)->minutes();
        $this->open(['store_id' => $store, 'reason' => 'Late', 'approval_id' => $late])->assertStatus(422)->assertJsonPath('error.code', 'APPROVAL_INVALID');

        $audit = AuditLog::query()->withoutGlobalScopes()->where('action', 'pos.drawer_opened')->sole();
        $this->assertSame(['id' => $manager->id, 'name' => 'Arif'], $audit->new_values['approved_by']);
        $this->assertSame($approvalId, $audit->context['approval_id']);
        $this->assertStringNotContainsString('4713', json_encode([$audit->new_values, $audit->context]));
    }

    public function test_an_open_register_session_in_the_stores_branch_is_required(): void
    {
        ['organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $store = $this->mainStoreId($org);
        $second = $this->createBranch($org, 'B2');
        $manager = $this->setPin($this->createUserWithRole($org, SystemRole::BranchManager, [$branch->id, $second->id]), '4713');
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier, [$branch->id, $second->id]);

        $this->actingAsUser($manager);
        $this->open(['store_id' => $store, 'reason' => 'Change'])->assertStatus(422)->assertJsonPath('error.code', 'CASH_SESSION_REQUIRED');

        // A session in another branch does not count; the approval stays unused.
        $this->openSession($cashier, $second->id);
        $this->actingAsUser($cashier);
        $approvalId = $this->approve($manager, '4713', $store);
        $this->open(['store_id' => $store, 'reason' => 'Change', 'approval_id' => $approvalId])->assertStatus(422)->assertJsonPath('error.code', 'CASH_SESSION_REQUIRED');
        $this->assertNull(DB::table('pos_approvals')->where('id', $approvalId)->value('used_at'));
        $this->assertDatabaseCount('pos_drawer_openings', 0);
        $this->assertSame(0, AuditLog::query()->withoutGlobalScopes()->where('action', 'pos.drawer_opened')->count());
    }

    public function test_the_till_of_the_device_is_recorded_and_retries_are_idempotent(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $store = $this->mainStoreId($org);
        $manager = $this->createUserWithRole($org, SystemRole::BranchManager, [$branch->id]);
        $this->openSession($manager, $branch->id);
        $token = $this->tillToken($org, $admin, $store, 'Front till');
        $terminalId = DB::table('pos_terminals')->where('name', 'Front till')->value('id');

        $this->actingAsUser($manager);
        $this->onTill($token);
        $key = (string) Str::uuid();
        $first = $this->open(['store_id' => $store, 'reason' => 'Change'], $key)->assertCreated()->json('data');
        $this->open(['store_id' => $store, 'reason' => 'Change'], $key)->assertCreated()
            ->assertHeader('Idempotent-Replayed', 'true')
            ->assertJsonPath('data.id', $first['id']);
        $this->assertDatabaseCount('pos_drawer_openings', 1);
        $this->assertDatabaseHas('pos_drawer_openings', ['id' => $first['id'], 'terminal_id' => $terminalId]);

        $this->postJson('/api/v1/pos/drawer-openings', ['store_id' => $store, 'reason' => 'Change'])->assertStatus(428);

        // Append-only.
        $this->expectException(QueryException::class);
        DB::table('pos_drawer_openings')->where('id', $first['id'])->update(['reason' => 'Edited']);
    }

    public function test_the_list_filters_and_permissions(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $store = $this->mainStoreId($org);
        $second = $this->createBranch($org, 'B2');
        $secondStore = $this->inTenant($org, fn () => DB::table('stores')->where('branch_id', $second->id)->value('id'));
        $manager = $this->setPin($this->createUserWithRole($org, SystemRole::BranchManager, [$branch->id]), '4713');
        $manager->forceFill(['name' => 'Arif'])->saveQuietly();
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]);
        $cashier->forceFill(['name' => 'Rina'])->saveQuietly();
        $accountant = $this->createUserWithRole($org, SystemRole::Accountant, [$branch->id]);
        $otherManager = $this->createUserWithRole($org, SystemRole::BranchManager, [$second->id]);

        $managerSession = $this->openSession($manager, $branch->id);
        $this->actingAsUser($manager);
        $byManager = $this->open(['store_id' => $store, 'reason' => 'Float check'])->assertCreated()->json('data.id');

        $cashierSession = $this->openSession($cashier, $branch->id);
        $this->actingAsUser($cashier);
        $this->travel(2)->days();
        $byCashier = $this->open(['store_id' => $store, 'reason' => 'Customer change', 'approval_id' => $this->approve($manager, '4713', $store)])->assertCreated()->json('data');

        $this->travel(1)->minutes();
        $this->openSession($otherManager, $second->id);
        $this->actingAsUser($otherManager);
        $elsewhere = $this->open(['store_id' => $secondStore, 'reason' => 'Other branch'])->assertCreated()->json('data.id');

        // Cashiers (no `cash_registers.view`, no `pos.no_sale`) cannot list.
        $this->actingAsUser($cashier);
        $this->getJson('/api/v1/pos/drawer-openings')->assertForbidden();

        // A manager sees their branch only, newest first.
        $this->actingAsUser($manager);
        $this->getJson('/api/v1/pos/drawer-openings')->assertOk()
            ->assertJsonPath('meta.pagination.total', 2)
            ->assertJsonPath('data.0', [
                'id' => $byCashier['id'],
                'opened_at' => $byCashier['opened_at'],
                'reason' => 'Customer change',
                'user' => ['id' => $cashier->id, 'name' => 'Rina'],
                'approved_by' => ['id' => $manager->id, 'name' => 'Arif'],
                'register_session' => ['id' => $cashierSession->id, 'number' => $cashierSession->number],
                'terminal' => null,
            ])
            ->assertJsonPath('data.1.id', $byManager)
            ->assertJsonPath('data.1.approved_by', null);

        $ids = fn (TestResponse $r) => array_column($r->assertOk()->json('data'), 'id');
        $this->assertSame([$byManager], $ids($this->getJson("/api/v1/pos/drawer-openings?register_session_id={$managerSession->id}")));
        $this->assertSame([$byCashier['id']], $ids($this->getJson("/api/v1/pos/drawer-openings?user_id={$cashier->id}")));

        $timezone = $this->inTenant($org, fn () => app(OrganizationDate::class)->timezone());
        $today = now()->setTimezone($timezone)->toDateString();
        $twoDaysAgo = now()->subDays(2)->setTimezone($timezone)->toDateString();
        $this->assertSame([$byCashier['id']], $ids($this->getJson("/api/v1/pos/drawer-openings?from={$today}")));
        $this->assertSame([$byManager], $ids($this->getJson("/api/v1/pos/drawer-openings?from={$twoDaysAgo}&to={$twoDaysAgo}")));
        $this->getJson("/api/v1/pos/drawer-openings?from={$today}&to={$twoDaysAgo}")->assertStatus(422);
        $this->assertSame([], $ids($this->getJson("/api/v1/pos/drawer-openings?branch_id={$second->id}")));

        // `cash_registers.view` (an accountant) may list too; the organization admin sees every branch.
        $this->actingAsUser($accountant);
        $this->assertSame([$byCashier['id'], $byManager], $ids($this->getJson('/api/v1/pos/drawer-openings')));
        $this->actingAsUser($admin);
        $this->assertSame([$elsewhere, $byCashier['id'], $byManager], $ids($this->getJson('/api/v1/pos/drawer-openings')));
        $this->assertSame([$elsewhere], $ids($this->getJson("/api/v1/pos/drawer-openings?branch_id={$second->id}")));
    }

    public function test_the_register_session_document_shows_the_no_sale_openings(): void
    {
        ['organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $store = $this->mainStoreId($org);
        $manager = $this->setPin($this->createUserWithRole($org, SystemRole::BranchManager, [$branch->id]), '4713');
        $manager->forceFill(['name' => 'Arif'])->saveQuietly();
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]);
        $cashier->forceFill(['name' => 'Rina'])->saveQuietly();
        $session = $this->openSession($cashier, $branch->id);
        $managerSession = $this->openSession($manager, $branch->id);

        $this->actingAsUser($cashier);
        $this->getJson("/api/v1/register-sessions/{$session->id}")->assertOk()
            ->assertJsonPath('data.no_sale_count', 0)
            ->assertJsonPath('data.no_sale_openings', []);

        $first = $this->open(['store_id' => $store, 'reason' => 'Change', 'approval_id' => $this->approve($manager, '4713', $store)])->assertCreated()->json('data');
        $this->travel(1)->minutes();
        $this->open(['store_id' => $store, 'reason' => 'Coin roll', 'approval_id' => $this->approve($manager, '4713', $store)])->assertCreated();

        $this->getJson('/api/v1/register-sessions/current')->assertOk()
            ->assertJsonPath('data.no_sale_count', 2)
            ->assertJsonPath('data.no_sale_openings.0', ['opened_at' => $first['opened_at'], 'reason' => 'Change', 'user_name' => 'Rina', 'approved_by_name' => 'Arif'])
            ->assertJsonPath('data.no_sale_openings.1.reason', 'Coin roll');

        // The Z report (close) and the session list carry the count.
        $this->postJson("/api/v1/register-sessions/{$session->id}/close", ['counted_cash' => '0'])->assertOk()
            ->assertJsonPath('data.status', 'closed')
            ->assertJsonPath('data.no_sale_count', 2)
            ->assertJsonCount(2, 'data.no_sale_openings');
        $this->actingAsUser($manager);
        $sessions = collect($this->getJson('/api/v1/register-sessions')->assertOk()->json('data'))->keyBy('id');
        $this->assertSame(2, $sessions[$session->id]['no_sale_count']);
        $this->assertSame(0, $sessions[$managerSession->id]['no_sale_count']);

        // The contract counts per session; unknown ids are 0.
        $unknown = (string) Str::uuid();
        $this->inTenant($org, fn () => $this->assertSame(
            [$session->id => 2, $unknown => 0],
            app(DrawerOpenings::class)->countForSessions([$session->id, $unknown, 'nope']),
        ));
    }

    public function test_another_organization_sees_nothing(): void
    {
        ['organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        ['admin' => $otherAdmin, 'organization' => $other] = $this->provisionTenant('Other Shop');
        $store = $this->mainStoreId($org);
        $manager = $this->createUserWithRole($org, SystemRole::BranchManager, [$branch->id]);
        $session = $this->openSession($manager, $branch->id);
        $this->actingAsUser($manager);
        $this->open(['store_id' => $store, 'reason' => 'Change'])->assertCreated();

        $this->actingAsUser($otherAdmin);
        $this->getJson('/api/v1/pos/drawer-openings')->assertOk()->assertJsonPath('meta.pagination.total', 0);
        $this->getJson("/api/v1/pos/drawer-openings?register_session_id={$session->id}")->assertOk()->assertJsonPath('data', []);
        $this->getJson("/api/v1/register-sessions/{$session->id}")->assertNotFound();
        // Its store is unknown here.
        $this->open(['store_id' => $store, 'reason' => 'Change'])->assertStatus(422)->assertJsonValidationErrors('store_id', 'error.details');

        $this->inTenant($other, function () use ($session) {
            $this->assertSame([$session->id => 0], app(DrawerOpenings::class)->countForSessions([$session->id]));
            $this->assertSame([], app(DrawerOpenings::class)->forSession($session->id));
        });
    }

    public function test_the_database_accepts_the_no_sale_approval_action(): void
    {
        $constraint = DB::selectOne("SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'pos_approvals_action_check'");

        foreach (['price_override', 'discount', 'return', 'no_sale'] as $action) {
            $this->assertStringContainsString("'{$action}'", $constraint->def);
        }
    }

    /**
     * @param  array<string, mixed>  $payload
     */
    private function open(array $payload, ?string $key = null): TestResponse
    {
        return $this->postJson('/api/v1/pos/drawer-openings', $payload, ['Idempotency-Key' => $key ?? (string) Str::uuid()]);
    }

    private function approve(User $manager, string $pin, string $store): string
    {
        return $this->postJson('/api/v1/pos/approvals', [
            'action' => 'no_sale', 'approver_id' => $manager->id, 'pin' => $pin, 'store_id' => $store,
        ])->assertCreated()
            ->assertJsonPath('data.action', 'no_sale')
            ->json('data.id');
    }
}
