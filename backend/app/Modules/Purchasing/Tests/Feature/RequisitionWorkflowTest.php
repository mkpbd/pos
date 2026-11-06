<?php

namespace App\Modules\Purchasing\Tests\Feature;

use App\Modules\Catalog\Infrastructure\Models\TaxRate;
use App\Modules\Purchasing\Infrastructure\Models\PurchaseRequisitionStatusChange;
use App\Modules\Purchasing\Tests\Concerns\BuildsProcurement;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use LogicException;
use Tests\TestCase;

/**
 * SC2: purchase requisitions — estimates, amount-based approval tiers, self-approval refusal,
 * branch scoping, permissions, idempotent transitions, notifications and isolation.
 */
class RequisitionWorkflowTest extends TestCase
{
    use BuildsProcurement, RefreshDatabase;

    public function test_draft_with_prefilled_estimates_and_server_side_totals(): void
    {
        ['admin' => $admin, 'org' => $org, 'store' => $store, 'variant' => $juice] = $this->procurementWorld();
        $vat = $this->inTenant($org, fn () => TaxRate::query()->create(['name' => 'VAT', 'rate' => '15']));
        $water = $this->stockedVariant($org, 'Water', ['tax_rate_id' => $vat->id]);
        $rice = $this->stockedVariant($org, 'Rice', decimalUnit: true);
        $pran = $this->supplier($org, 'Pran');
        $mills = $this->supplier($org, 'Mills');
        $this->actingAsUser($admin);
        $this->catalogRow($pran->id, $juice->id, ['unit_cost' => '18', 'is_preferred' => true]);
        $this->catalogRow($mills->id, $juice->id, ['unit_cost' => '17.5']);
        $this->postJson('/api/v1/purchasing/receipts', ['supplier_id' => $mills->id, 'store_id' => $store, 'invoice_date' => now()->toDateString(),
            'lines' => [['variant_id' => $rice->id, 'quantity' => '1', 'unit_cost' => '61.25']]])->assertCreated();

        $estimates = collect($this->getJson('/api/v1/purchasing/requisitions/estimates?'.http_build_query(['variant_ids' => [$juice->id, $rice->id, $water->id]]))
            ->assertOk()->json('data'))->keyBy('variant_id');
        $this->assertSame(['18.0000', 'preferred_catalog', 'Pran'], [$estimates[$juice->id]['estimated_unit_cost'], $estimates[$juice->id]['source'], $estimates[$juice->id]['preferred_supplier']['name']]);
        $this->assertSame(['61.2500', 'last_cost'], [$estimates[$rice->id]['estimated_unit_cost'], $estimates[$rice->id]['source']]);
        $this->assertSame(['10.0000', 'variant_cost'], [$estimates[$water->id]['estimated_unit_cost'], $estimates[$water->id]['source']]);

        $requisition = $this->raiseRequisition($store, [
            ['variant_id' => $juice->id, 'quantity' => '48', 'suggested_supplier_id' => $mills->id], // the suggested supplier's catalog cost
            ['variant_id' => $rice->id, 'quantity' => '2.5'],
            ['variant_id' => $water->id, 'quantity' => '10', 'estimated_unit_cost' => '12', 'notes' => 'Chilled'],
        ], ['needed_by' => now()->addWeek()->toDateString(), 'notes' => 'Eid stock', 'estimated_total' => '1.00'])
            ->assertJsonPath('data.number', 'PR-000001')
            ->assertJsonPath('data.status', 'draft')
            ->assertJsonPath('data.requested_by.id', $admin->id)
            ->assertJsonPath('data.lines.0.estimated_unit_cost', '17.5000')
            ->assertJsonPath('data.lines.0.suggested_supplier.name', 'Mills')
            ->assertJsonPath('data.lines.1.estimated_unit_cost', '61.2500')
            ->assertJsonPath('data.lines.2.estimated_total', '138.00') // 10 × 12 + 15 % tax
            ->assertJsonPath('data.estimated_subtotal', '1113.13') // 840 + 153.125→153.13 + 120
            ->assertJsonPath('data.estimated_tax', '18.00')
            ->assertJsonPath('data.estimated_total', '1131.13')
            ->assertJsonPath('data.approval_level', null)
            ->assertJsonPath('data.can_edit', true)
            ->assertJsonPath('data.history.0.to_status', 'draft')
            ->json('data');

        // Edit replaces the lines; whole-unit products refuse fractions; past needed-by dates are refused.
        $this->putJson("/api/v1/purchasing/requisitions/{$requisition['id']}", ['store_id' => $store, 'lines' => [['variant_id' => $juice->id, 'quantity' => '1.5']]])
            ->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['lines.0.quantity']]]);
        $this->putJson("/api/v1/purchasing/requisitions/{$requisition['id']}", ['store_id' => $store, 'needed_by' => now()->subDays(2)->toDateString(), 'lines' => [['variant_id' => $juice->id, 'quantity' => '2']]])
            ->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['needed_by']]]);
        $this->putJson("/api/v1/purchasing/requisitions/{$requisition['id']}", ['store_id' => $store, 'lines' => [['variant_id' => $juice->id, 'quantity' => '2']]])
            ->assertOk()->assertJsonPath('data.estimated_total', '36.00')->assertJsonCount(1, 'data.lines');

        // Submitted requisitions are locked.
        $this->transition("requisitions/{$requisition['id']}/submit")->assertOk();
        $this->putJson("/api/v1/purchasing/requisitions/{$requisition['id']}", ['store_id' => $store, 'lines' => [['variant_id' => $juice->id, 'quantity' => '3']]])
            ->assertStatus(422)->assertJsonPath('error.code', 'REQUISITION_LOCKED');
    }

    public function test_approval_tier_boundaries(): void
    {
        ['admin' => $admin, 'org' => $org, 'branch' => $branch, 'store' => $store, 'variant' => $variant] = $this->procurementWorld();
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]);
        $this->actingAsUser($cashier);

        $auto = $this->submittedRequisition($store, $variant->id, '1000', '10'); // 10 000.00
        $this->assertSame(['approved', 'none', true, null], [$auto['status'], $auto['approval_level'], $auto['auto_approved'], $auto['approved_by']]);
        $this->assertSame(['draft', 'submitted', 'approved'], array_column($auto['history'], 'to_status'));
        $this->assertNull($auto['history'][2]['user'], 'approved by the system');

        $manager = $this->submittedRequisition($store, $variant->id, '1', '10000.01');
        $this->assertSame(['submitted', 'manager', 'purchases.approve'], [$manager['status'], $manager['approval_level'], $manager['approver_permission']]);
        $this->assertSame('manager', $this->submittedRequisition($store, $variant->id, '1', '100000')['approval_level']);
        $high = $this->submittedRequisition($store, $variant->id, '1', '100000.01');
        $this->assertSame(['high', 'purchases.approve_high'], [$high['approval_level'], $high['approver_permission']]);

        // New limits apply to later submissions only.
        $this->actingAsUser($admin)->patchJson('/api/v1/purchasing/approval-settings', ['auto_approve_limit' => '20000', 'manager_limit' => '200000'])
            ->assertOk()->assertJsonPath('data.auto_approve_limit', '20000.00')->assertJsonPath('data.manager_limit', '200000.00')->assertJsonPath('data.currency', 'BDT');
        $this->actingAsUser($cashier);
        $this->assertSame('none', $this->submittedRequisition($store, $variant->id, '1', '15000')['approval_level']);
        $this->getJson("/api/v1/purchasing/requisitions/{$high['id']}")->assertJsonPath('data.approval_level', 'high');
    }

    public function test_eligible_approvers_self_approval_and_rejection(): void
    {
        ['admin' => $admin, 'org' => $org, 'branch' => $branch, 'store' => $store, 'variant' => $variant] = $this->procurementWorld();
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]);
        $manager = $this->createUserWithRole($org, SystemRole::BranchManager, [$branch->id]);
        $buyer = $this->createUserWithRole($org, SystemRole::InventoryManager, [$branch->id]);

        $this->actingAsUser($cashier);
        $managerLevel = $this->submittedRequisition($store, $variant->id, '2000', '10'); // 20 000.00
        $highLevel = $this->submittedRequisition($store, $variant->id, '20000', '10'); // 200 000.00
        $this->transition("requisitions/{$managerLevel['id']}/approve")->assertForbidden();

        // Approvers of the branch were notified; the requester was not.
        $unread = fn ($user) => $this->actingAsUser($user)->getJson('/api/v1/notifications/unread-count')->json('data.count');
        $this->assertSame(1, $unread($manager)); // manager level only
        $this->assertSame(2, $unread($admin)); // both levels
        $this->assertSame(0, $unread($buyer));
        $this->assertSame(0, $unread($cashier));
        $note = $this->actingAsUser($manager)->getJson('/api/v1/notifications')->json('data.0');
        $this->assertSame('purchasing.requisition_submitted', $note['type']);
        $this->assertSame("/purchasing/requisitions/{$managerLevel['id']}", $note['data']['link']);

        // An inventory manager may see it but not approve; a branch manager may not approve above the manager limit.
        $this->actingAsUser($buyer)->getJson("/api/v1/purchasing/requisitions/{$managerLevel['id']}")->assertOk()->assertJsonPath('data.can_approve', false);
        $this->transition("requisitions/{$managerLevel['id']}/approve")->assertForbidden();
        $this->actingAsUser($manager)->getJson("/api/v1/purchasing/requisitions/{$highLevel['id']}")->assertJsonPath('data.can_approve', false);
        $this->transition("requisitions/{$highLevel['id']}/approve")->assertForbidden()
            ->assertJsonPath('error.code', 'APPROVAL_LIMIT_EXCEEDED')->assertJsonPath('error.details.required_permission', 'purchases.approve_high');

        $this->getJson("/api/v1/purchasing/requisitions/{$managerLevel['id']}")->assertJsonPath('data.can_approve', true);
        $key = (string) Str::uuid();
        $approved = $this->transition("requisitions/{$managerLevel['id']}/approve", [], $key)->assertOk()
            ->assertJsonPath('data.status', 'approved')
            ->assertJsonPath('data.approved_by.id', $manager->id)
            ->assertJsonPath('data.auto_approved', false)
            ->json('data');
        // Replay: same answer, no second transition.
        $this->transition("requisitions/{$managerLevel['id']}/approve", [], $key)->assertOk()->assertHeader('Idempotent-Replayed', 'true');
        $this->assertSame(3, count($approved['history']));
        $this->assertSame(3, PurchaseRequisitionStatusChange::query()->withoutGlobalScopes()->where('purchase_requisition_id', $managerLevel['id'])->count());
        $this->transition("requisitions/{$managerLevel['id']}/approve")->assertStatus(422)->assertJsonPath('error.code', 'INVALID_STATUS_CHANGE');

        // Nobody approves their own requisition — not even the Organization Admin.
        $this->actingAsUser($admin);
        $own = $this->submittedRequisition($store, $variant->id, '20000', '10');
        $this->transition("requisitions/{$own['id']}/approve")->assertForbidden()->assertJsonPath('error.code', 'SELF_APPROVAL_NOT_ALLOWED');
        $this->assertSame(false, $this->getJson("/api/v1/purchasing/requisitions/{$own['id']}")->json('data.can_approve'));

        // Rejection needs a reason; the requester is told.
        $this->transition("requisitions/{$highLevel['id']}/reject")->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['reason']]]);
        $this->transition("requisitions/{$highLevel['id']}/reject", ['reason' => 'Over budget this month'])->assertOk()
            ->assertJsonPath('data.status', 'rejected')
            ->assertJsonPath('data.rejection_reason', 'Over budget this month')
            ->assertJsonPath('data.rejected_by.id', $admin->id)
            ->assertJsonPath('data.history.2.note', 'Over budget this month');
        $types = collect($this->actingAsUser($cashier)->getJson('/api/v1/notifications')->json('data'))->pluck('type')->all();
        $this->assertEqualsCanonicalizing(['purchasing.requisition_approved', 'purchasing.requisition_rejected'], $types);

        // The history is append-only.
        $this->expectException(LogicException::class);
        PurchaseRequisitionStatusChange::query()->withoutGlobalScopes()->firstOrFail()->update(['note' => 'x']);
    }

    public function test_cancel_rules(): void
    {
        ['admin' => $admin, 'org' => $org, 'branch' => $branch, 'store' => $store, 'variant' => $variant] = $this->procurementWorld();
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]);
        $other = $this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]);

        $this->actingAsUser($cashier);
        $draft = $this->raiseRequisition($store, [['variant_id' => $variant->id, 'quantity' => '1']])->json('data');
        $approved = $this->submittedRequisition($store, $variant->id, '1', '10');

        // Another requester cannot see (404) or cancel it; the requester cannot cancel once approved.
        $this->actingAsUser($other)->getJson("/api/v1/purchasing/requisitions/{$draft['id']}")->assertNotFound();
        $this->transition("requisitions/{$draft['id']}/cancel")->assertNotFound();
        $this->actingAsUser($cashier);
        $this->transition("requisitions/{$approved['id']}/cancel")->assertStatus(422)->assertJsonPath('error.code', 'INVALID_STATUS_CHANGE');
        $this->transition("requisitions/{$draft['id']}/cancel", ['reason' => 'Duplicate'])->assertOk()
            ->assertJsonPath('data.status', 'cancelled')->assertJsonPath('data.cancellation_reason', 'Duplicate');

        // purchases.manage may cancel an approved requisition before conversion.
        $this->actingAsUser($admin);
        $this->transition("requisitions/{$approved['id']}/cancel")->assertOk()->assertJsonPath('data.status', 'cancelled');
        $this->transition("requisitions/{$approved['id']}/submit")->assertStatus(422)->assertJsonPath('error.code', 'INVALID_STATUS_CHANGE');
    }

    public function test_permission_matrix_and_visibility(): void
    {
        ['admin' => $admin, 'org' => $org, 'branch' => $branch, 'store' => $store, 'variant' => $variant] = $this->procurementWorld();
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]);
        $accountant = $this->createUserWithRole($org, SystemRole::Accountant, [$branch->id]);
        $buyer = $this->createUserWithRole($org, SystemRole::InventoryManager, [$branch->id]);
        $online = $this->createUserWithRole($org, SystemRole::OnlineStoreManager, [$branch->id]);
        $line = [['variant_id' => $variant->id, 'quantity' => '1']];

        $this->actingAsUser($cashier);
        $mine = $this->raiseRequisition($store, $line)->json('data');
        $this->transition('requisitions/'.$mine['id'].'/submit')->assertOk();
        $this->getJson('/api/v1/purchasing/requisitions')->assertOk()->assertJsonCount(1, 'data');
        $this->transition('requisitions/'.$mine['id'].'/convert', ['purchase_orders' => ['lines' => [['requisition_line_id' => $mine['lines'][0]['id']]]]])->assertForbidden();
        $this->getJson('/api/v1/purchasing/approvals')->assertForbidden();
        $this->getJson('/api/v1/purchasing/rfqs')->assertForbidden();
        $this->getJson('/api/v1/purchasing/approval-settings')->assertOk()->assertJsonPath('data.auto_approve_limit', '10000.00');
        $this->patchJson('/api/v1/purchasing/approval-settings', ['auto_approve_limit' => '1'])->assertForbidden();

        // purchases.view only (accountant): sees everything in the branch, cannot raise.
        $this->actingAsUser($buyer);
        $this->raiseRequisition($store, $line);
        $this->actingAsUser($accountant)->getJson('/api/v1/purchasing/requisitions')->assertOk()->assertJsonCount(2, 'data');
        $this->raiseRequisition($store, $line, status: 403);
        $this->getJson('/api/v1/purchasing/requisitions?mine=1')->assertJsonCount(0, 'data');

        // No purchasing permission at all.
        $this->actingAsUser($online)->getJson('/api/v1/purchasing/requisitions')->assertForbidden();
        $this->getJson("/api/v1/purchasing/requisitions/{$mine['id']}")->assertForbidden();

        // Branch managers approve but cannot change the limits.
        $this->actingAsUser($this->createUserWithRole($org, SystemRole::BranchManager, [$branch->id]))
            ->patchJson('/api/v1/purchasing/approval-settings', ['auto_approve_limit' => '1'])->assertForbidden();
        $this->actingAsUser($admin)->patchJson('/api/v1/purchasing/approval-settings', ['auto_approve_limit' => '200000'])
            ->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['auto_approve_limit']]]);
        $this->patchJson('/api/v1/purchasing/approval-settings', ['require_po_approval' => false])->assertOk()
            ->assertJsonPath('data.require_po_approval', false)->assertJsonPath('data.auto_approve_limit', '10000.00');
    }

    public function test_branch_scoping_and_tenant_isolation(): void
    {
        ['admin' => $admin, 'org' => $org, 'branch' => $main, 'store' => $store, 'variant' => $variant] = $this->procurementWorld();
        $north = $this->createBranch($org, 'NORTH');
        $northManager = $this->createUserWithRole($org, SystemRole::BranchManager, [$north->id]);
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier, [$main->id]);
        ['admin' => $foreignAdmin] = $this->provisionTenant('Other Co');

        $this->actingAsUser($cashier);
        $requisition = $this->submittedRequisition($store, $variant->id, '2000', '10');

        $this->actingAsUser($northManager)->getJson('/api/v1/purchasing/requisitions')->assertJsonCount(0, 'data');
        $this->getJson("/api/v1/purchasing/requisitions/{$requisition['id']}")->assertNotFound();
        $this->transition("requisitions/{$requisition['id']}/approve")->assertNotFound();
        $this->getJson('/api/v1/purchasing/approvals')->assertOk()->assertJsonCount(0, 'data');
        // A store of another branch cannot be used.
        $this->raiseRequisition($store, [['variant_id' => $variant->id, 'quantity' => '1']], status: 422)
            ->assertJsonPath('error.details.store_id.0', 'The selected store does not exist.');

        $this->actingAsUser($foreignAdmin)->getJson("/api/v1/purchasing/requisitions/{$requisition['id']}")->assertNotFound();
        $this->getJson('/api/v1/purchasing/requisitions')->assertJsonCount(0, 'data');
        $this->transition("requisitions/{$requisition['id']}/approve")->assertNotFound();
        $this->actingAsUser($admin)->getJson('/api/v1/purchasing/requisitions')->assertJsonCount(1, 'data');
    }

    public function test_requisition_from_reorder_suggestions_for_staff_without_purchases_manage(): void
    {
        ['org' => $org, 'branch' => $branch, 'store' => $store, 'variant' => $juice] = $this->procurementWorld();
        $water = $this->stockedVariant($org, 'Water');
        $pran = $this->supplier($org, 'Pran');
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]);
        $this->actingAsUser($cashier);
        $url = '/api/v1/purchasing/reorder-suggestions/requisitions';
        $body = ['store_id' => $store, 'submit' => true, 'lines' => [
            ['variant_id' => $juice->id, 'supplier_id' => $pran->id, 'quantity' => '48', 'unit_cost' => '18'],
            ['variant_id' => $water->id, 'quantity' => '24'],
        ]];

        $this->postJson($url, $body)->assertStatus(428);
        $this->postJson('/api/v1/purchasing/reorder-suggestions/purchase-orders', $body + ['x' => 1], ['Idempotency-Key' => (string) Str::uuid()])->assertForbidden();
        $key = (string) Str::uuid();
        $created = $this->postJson($url, $body, ['Idempotency-Key' => $key])->assertCreated()
            ->assertJsonPath('data.status', 'approved') // 864 + 240, below the auto limit
            ->assertJsonPath('data.requested_by.id', $cashier->id)
            ->assertJsonPath('data.lines.0.suggested_supplier.id', $pran->id)
            ->assertJsonPath('data.lines.1.estimated_unit_cost', '10.0000')
            ->assertJsonPath('data.estimated_total', '1104.00')
            ->assertJsonPath('data.history.0.note', 'Raised from reorder suggestions.')
            ->json('data');
        $this->postJson($url, $body, ['Idempotency-Key' => $key])->assertCreated()->assertHeader('Idempotent-Replayed', 'true')->assertJsonPath('data.id', $created['id']);
        $this->getJson('/api/v1/purchasing/requisitions')->assertJsonCount(1, 'data');
    }
}
