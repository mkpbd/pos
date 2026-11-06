<?php

namespace App\Modules\Purchasing\Tests\Feature;

use App\Modules\Purchasing\Tests\Concerns\BuildsProcurement;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * SC2: purchase order approval (`pending_approval`), the "mark ordered" path under the
 * approval setting, requisition conversion with pre-approval (5 % rule) and the approvals inbox.
 */
class PurchaseOrderApprovalTest extends TestCase
{
    use BuildsProcurement, RefreshDatabase;

    public function test_mark_ordered_honours_the_approval_setting(): void
    {
        ['admin' => $admin, 'org' => $org, 'store' => $store, 'variant' => $variant] = $this->procurementWorld();
        $pran = $this->supplier($org, 'Pran');
        $this->actingAsUser($admin);

        $small = $this->draftOrder($pran->id, $store, [['variant_id' => $variant->id, 'quantity' => '1000', 'unit_cost' => '10']]);
        $this->assertFalse($small['submit_requires_approval']);
        $this->postJson("/api/v1/purchasing/orders/{$small['id']}/place")->assertOk()->assertJsonPath('data.status', 'ordered')
            ->assertJsonPath('data.history.1.note', 'At or below the auto-approve limit.');

        $big = $this->draftOrder($pran->id, $store, [['variant_id' => $variant->id, 'quantity' => '1001', 'unit_cost' => '10']]);
        $this->assertTrue($big['submit_requires_approval']);
        $this->assertSame('manager', $big['submit_approval_level']);
        $this->postJson("/api/v1/purchasing/orders/{$big['id']}/place")->assertStatus(422)
            ->assertJsonPath('error.code', 'APPROVAL_REQUIRED')->assertJsonPath('error.details.approval_level', 'manager');

        $this->patchJson('/api/v1/purchasing/approval-settings', ['require_po_approval' => false])->assertOk();
        $this->getJson("/api/v1/purchasing/orders/{$big['id']}")->assertJsonPath('data.submit_requires_approval', false);
        $this->postJson("/api/v1/purchasing/orders/{$big['id']}/place")->assertOk()->assertJsonPath('data.status', 'ordered')
            ->assertJsonPath('data.history.1.note', 'Purchase order approval is not required.');
    }

    public function test_submit_approve_and_reject(): void
    {
        ['admin' => $admin, 'org' => $org, 'branch' => $branch, 'store' => $store, 'variant' => $variant] = $this->procurementWorld();
        $pran = $this->supplier($org, 'Pran');
        $buyer = $this->createUserWithRole($org, SystemRole::InventoryManager, [$branch->id]);
        $manager = $this->createUserWithRole($org, SystemRole::BranchManager, [$branch->id]);

        $this->actingAsUser($buyer);
        $small = $this->draftOrder($pran->id, $store, [['variant_id' => $variant->id, 'quantity' => '5', 'unit_cost' => '10']]);
        $this->transition("orders/{$small['id']}/submit")->assertOk()->assertJsonPath('data.status', 'ordered')->assertJsonPath('data.submitted_by.id', $buyer->id);

        $order = $this->draftOrder($pran->id, $store, [['variant_id' => $variant->id, 'quantity' => '2000', 'unit_cost' => '10']]);
        $this->postJson("/api/v1/purchasing/orders/{$order['id']}/submit")->assertStatus(428);
        $key = (string) Str::uuid();
        $this->transition("orders/{$order['id']}/submit", [], $key)->assertOk()
            ->assertJsonPath('data.status', 'pending_approval')
            ->assertJsonPath('data.approval_level', 'manager')
            ->assertJsonPath('data.can_approve', false);
        $this->transition("orders/{$order['id']}/submit", [], $key)->assertOk()->assertHeader('Idempotent-Replayed', 'true');
        $this->getJson('/api/v1/purchasing/orders?status=pending_approval')->assertJsonCount(1, 'data');
        $this->putJson("/api/v1/purchasing/orders/{$order['id']}", [
            'supplier_id' => $pran->id, 'store_id' => $store, 'order_date' => now()->toDateString(), 'lines' => [['variant_id' => $variant->id, 'quantity' => '1', 'unit_cost' => '1']],
        ])->assertStatus(422)->assertJsonPath('error.code', 'PURCHASE_ORDER_LOCKED');
        $this->postJson('/api/v1/purchasing/receipts', ['supplier_id' => $pran->id, 'store_id' => $store, 'purchase_order_id' => $order['id'], 'invoice_date' => now()->toDateString(),
            'lines' => [['variant_id' => $variant->id, 'purchase_order_line_id' => $order['lines'][0]['id'], 'quantity' => '1', 'unit_cost' => '10']]])
            ->assertStatus(422)->assertJsonPath('error.code', 'PURCHASE_ORDER_NOT_OPEN');
        $this->transition("orders/{$order['id']}/approve")->assertForbidden(); // inventory managers do not approve

        // The approver was notified; rejection sends it back to draft with the reason.
        $this->assertSame('purchasing.order_pending_approval', $this->actingAsUser($manager)->getJson('/api/v1/notifications')->json('data.0.type'));
        $this->getJson("/api/v1/purchasing/orders/{$order['id']}")->assertJsonPath('data.can_approve', true);
        $this->transition("orders/{$order['id']}/reject")->assertStatus(422);
        $this->transition("orders/{$order['id']}/reject", ['reason' => 'Split it over two weeks'])->assertOk()
            ->assertJsonPath('data.status', 'draft')
            ->assertJsonPath('data.rejection_reason', 'Split it over two weeks')
            ->assertJsonPath('data.rejected_by.id', $manager->id);
        $this->assertSame('purchasing.order_rejected', $this->actingAsUser($buyer)->getJson('/api/v1/notifications')->json('data.0.type'));

        // Resubmitted and approved → ordered.
        $this->transition("orders/{$order['id']}/submit")->assertOk()->assertJsonPath('data.status', 'pending_approval');
        $this->actingAsUser($manager);
        $this->transition("orders/{$order['id']}/approve")->assertOk()
            ->assertJsonPath('data.status', 'ordered')
            ->assertJsonPath('data.approved_by.id', $manager->id);
        $history = $this->getJson("/api/v1/purchasing/orders/{$order['id']}")->json('data.history');
        $this->assertSame(['draft', 'pending_approval', 'draft', 'pending_approval', 'ordered'], array_column($history, 'to_status'));
        $this->assertSame($manager->id, $history[4]['user']['id']);

        // Above the manager limit only purchases.approve_high; nobody approves an order they submitted.
        $this->actingAsUser($buyer);
        $high = $this->draftOrder($pran->id, $store, [['variant_id' => $variant->id, 'quantity' => '20000', 'unit_cost' => '10']]);
        $this->transition("orders/{$high['id']}/submit")->assertOk()->assertJsonPath('data.approval_level', 'high');
        $this->actingAsUser($manager);
        $this->transition("orders/{$high['id']}/approve")->assertForbidden()->assertJsonPath('error.code', 'APPROVAL_LIMIT_EXCEEDED');
        $this->actingAsUser($admin);
        $own = $this->draftOrder($pran->id, $store, [['variant_id' => $variant->id, 'quantity' => '20000', 'unit_cost' => '10']]);
        $this->transition("orders/{$own['id']}/submit")->assertOk();
        $this->transition("orders/{$own['id']}/approve")->assertForbidden()->assertJsonPath('error.code', 'SELF_APPROVAL_NOT_ALLOWED');
        $this->transition("orders/{$high['id']}/approve")->assertOk()->assertJsonPath('data.status', 'ordered');

        // Pending orders can be cancelled.
        $this->postJson("/api/v1/purchasing/orders/{$own['id']}/cancel")->assertOk()->assertJsonPath('data.status', 'cancelled');
    }

    public function test_requisition_conversion_with_pre_approval_and_the_five_percent_rule(): void
    {
        ['admin' => $admin, 'org' => $org, 'branch' => $branch, 'store' => $store, 'variant' => $juice] = $this->procurementWorld();
        $water = $this->stockedVariant($org, 'Water');
        $rice = $this->stockedVariant($org, 'Rice');
        $pran = $this->supplier($org, 'Pran');
        $mills = $this->supplier($org, 'Mills');
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]);
        $manager = $this->createUserWithRole($org, SystemRole::BranchManager, [$branch->id]);
        $buyer = $this->createUserWithRole($org, SystemRole::InventoryManager, [$branch->id]);
        $this->actingAsUser($admin);
        $this->catalogRow($pran->id, $juice->id, ['unit_cost' => '20', 'is_preferred' => true, 'lead_time_days' => 4]);
        $this->catalogRow($mills->id, $water->id, ['unit_cost' => '10.50']); // dearer than the estimate

        $this->actingAsUser($cashier);
        $requisition = $this->raiseRequisition($store, [
            ['variant_id' => $juice->id, 'quantity' => '1000', 'estimated_unit_cost' => '20'],   // 20 000
            ['variant_id' => $water->id, 'quantity' => '1000', 'estimated_unit_cost' => '10'],   // 10 000
            ['variant_id' => $rice->id, 'quantity' => '100', 'estimated_unit_cost' => '50'],     // 5 000
        ])->json('data');
        $lines = array_column($requisition['lines'], 'id');
        $this->transition("requisitions/{$requisition['id']}/submit")->assertOk()->assertJsonPath('data.approval_level', 'manager');

        $convert = ['purchase_orders' => ['lines' => [
            ['requisition_line_id' => $lines[0]],                              // preferred supplier (Pran)
            ['requisition_line_id' => $lines[1], 'supplier_id' => $mills->id], // chosen
        ]]];
        $this->actingAsUser($buyer);
        $this->transition("requisitions/{$requisition['id']}/convert", $convert)->assertStatus(422)->assertJsonPath('error.code', 'REQUISITION_NOT_APPROVED');
        $this->actingAsUser($cashier);
        $this->transition("requisitions/{$requisition['id']}/convert", $convert)->assertForbidden();
        $this->actingAsUser($manager);
        $this->transition("requisitions/{$requisition['id']}/approve")->assertOk();

        // A line without any supplier must get one; quantities cannot exceed what is open.
        $this->actingAsUser($buyer);
        $this->transition("requisitions/{$requisition['id']}/convert", ['purchase_orders' => ['lines' => [['requisition_line_id' => $lines[2]]]]])
            ->assertStatus(422)->assertJsonPath('error.details', ['purchase_orders.lines.0.supplier_id' => ['Choose a supplier for Rice.']]);
        $this->transition("requisitions/{$requisition['id']}/convert", ['purchase_orders' => ['lines' => [['requisition_line_id' => $lines[2], 'supplier_id' => $mills->id, 'quantity' => '60']]], 'rfq' => ['lines' => [['requisition_line_id' => $lines[2], 'quantity' => '41']]]])
            ->assertStatus(422)->assertJsonPath('error.details', ['rfq.lines.0.quantity' => ['Only 40.000 still open on this line.']]);

        $key = (string) Str::uuid();
        $result = $this->transition("requisitions/{$requisition['id']}/convert", $convert, $key)->assertCreated()->json('data');
        $this->transition("requisitions/{$requisition['id']}/convert", $convert, $key)->assertCreated()->assertHeader('Idempotent-Replayed', 'true');
        [$pranOrder, $millsOrder] = $result['purchase_orders'];
        $this->assertSame(['Pran', '20000.00', '20000.00', true], [$pranOrder['supplier']['name'], $pranOrder['total'], $pranOrder['approved_amount'], $pranOrder['pre_approved']]);
        $this->assertSame(['Mills', '10500.00', '10000.00'], [$millsOrder['supplier']['name'], $millsOrder['total'], $millsOrder['approved_amount']]); // catalog cost 10.50
        $this->assertNull($result['rfq']);
        $this->assertSame('approved', $result['requisition']['status']); // rice still open
        $this->assertSame(['1000.000', '1000.000', '0.000'], array_column($result['requisition']['lines'], 'converted_quantity'));
        $this->assertCount(2, $result['requisition']['purchase_orders']);

        $order = $this->getJson("/api/v1/purchasing/orders/{$pranOrder['id']}")->assertOk()
            ->assertJsonPath('data.requisition.number', $requisition['number'])
            ->assertJsonPath('data.pre_approved_amount', '20000.00')
            ->assertJsonPath('data.pre_approval_limit', '21000.00')
            ->assertJsonPath('data.submit_requires_approval', false)
            ->assertJsonPath('data.notes', "From requisition {$requisition['number']}.")
            ->json('data');
        $this->assertSame('20.0000', $order['lines'][0]['unit_cost']);

        // Within 5 % of the approved amount: ordered on submit although above the auto limit.
        $this->transition("orders/{$pranOrder['id']}/submit")->assertOk()->assertJsonPath('data.status', 'ordered')
            ->assertJsonPath('data.history.1.note', 'Pre-approved: within 5 % of the approved 20000.00.');
        // Exactly 5 % over is still covered; a cent more needs its own approval.
        $this->getJson("/api/v1/purchasing/orders/{$millsOrder['id']}")->assertJsonPath('data.submit_requires_approval', false);
        $this->putJson("/api/v1/purchasing/orders/{$millsOrder['id']}", ['supplier_id' => $mills->id, 'store_id' => $store, 'order_date' => now()->toDateString(),
            'lines' => [['variant_id' => $water->id, 'quantity' => '1000', 'unit_cost' => '10.501']]])->assertOk()->assertJsonPath('data.total', '10501.00');
        $this->transition("orders/{$millsOrder['id']}/submit")->assertOk()->assertJsonPath('data.status', 'pending_approval')
            ->assertJsonPath('data.approval_level', 'manager');

        // The rest goes out for quotation; the requisition is then fully converted.
        $rfq = $this->transition("requisitions/{$requisition['id']}/convert", ['rfq' => [
            'lines' => [['requisition_line_id' => $lines[2]]], 'title' => 'Rice for Eid', 'reply_by' => now()->addDays(3)->toDateString(), 'supplier_ids' => [$pran->id, $mills->id],
        ]])->assertCreated()->assertJsonPath('data.requisition.status', 'converted')->json('data.rfq');
        $this->assertSame('RFQ-000001', $rfq['number']);
        $this->getJson("/api/v1/purchasing/rfqs/{$rfq['id']}")->assertOk()
            ->assertJsonPath('data.requisition.number', $requisition['number'])
            ->assertJsonPath('data.title', 'Rice for Eid')
            ->assertJsonPath('data.lines.0.quantity', '100.000')
            ->assertJsonPath('data.lines.0.requisition_line_id', $lines[2])
            ->assertJsonCount(2, 'data.suppliers');
        $this->transition("requisitions/{$requisition['id']}/convert", $convert)->assertStatus(422)->assertJsonPath('error.code', 'REQUISITION_NOT_APPROVED');

        // Cancelling the RFQ gives the quantity back: approved again.
        $this->transition("rfqs/{$rfq['id']}/cancel")->assertOk()->assertJsonPath('data.status', 'cancelled');
        $back = $this->getJson("/api/v1/purchasing/requisitions/{$requisition['id']}")->assertJsonPath('data.status', 'approved')
            ->assertJsonPath('data.lines.2.converted_quantity', '0.000')->json('data');
        $this->assertSame("Quantities released by {$rfq['number']} (cancelled).", end($back['history'])['note']);
        $this->assertSame(['draft', 'submitted', 'approved', 'converted', 'approved'], array_column($back['history'], 'to_status'));
    }

    public function test_approvals_inbox(): void
    {
        ['admin' => $admin, 'org' => $org, 'branch' => $main, 'store' => $store, 'variant' => $variant] = $this->procurementWorld();
        $pran = $this->supplier($org, 'Pran');
        $north = $this->createBranch($org, 'NORTH');
        $manager = $this->createUserWithRole($org, SystemRole::BranchManager, [$main->id]);
        $northManager = $this->createUserWithRole($org, SystemRole::BranchManager, [$north->id]);
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier, [$main->id]);

        $this->actingAsUser($cashier);
        $managerLevel = $this->submittedRequisition($store, $variant->id, '2000', '10');
        $highLevel = $this->submittedRequisition($store, $variant->id, '20000', '10');
        $this->submittedRequisition($store, $variant->id, '10', '10'); // auto-approved: not waiting
        $this->actingAsUser($manager);
        $ownRequisition = $this->submittedRequisition($store, $variant->id, '2000', '10');
        $this->actingAsUser($admin);
        $order = $this->draftOrder($pran->id, $store, [['variant_id' => $variant->id, 'quantity' => '3000', 'unit_cost' => '10']]);
        $this->travel(5)->minutes(); // oldest submission first
        $this->transition("orders/{$order['id']}/submit")->assertOk();

        $inbox = $this->actingAsUser($manager)->getJson('/api/v1/purchasing/approvals')->assertOk()
            ->assertJsonPath('meta.counts', ['requisition' => 1, 'purchase_order' => 1])->json('data');
        $this->assertSame([$managerLevel['number'], $order['number']], array_column($inbox, 'number'));
        $this->assertSame(['requisition', 'purchase_order'], array_column($inbox, 'kind'));
        $this->assertSame(['20000.00', '30000.00'], array_column($inbox, 'amount'));
        $this->assertSame($cashier->id, $inbox[0]['requested_by']['id']);
        $this->assertSame('Pran', $inbox[1]['supplier']['name']);
        $this->assertSame("/purchasing/orders/{$order['id']}", $inbox[1]['link']);

        $admins = $this->actingAsUser($admin)->getJson('/api/v1/purchasing/approvals')->json('data');
        $this->assertEqualsCanonicalizing([$managerLevel['number'], $highLevel['number'], $ownRequisition['number']], array_column($admins, 'number')); // not the order the admin submitted
        $this->getJson('/api/v1/purchasing/approvals?kind=requisition&approval_level=high')->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $highLevel['id']);
        $this->getJson('/api/v1/purchasing/approvals?search='.$managerLevel['number'])->assertJsonCount(1, 'data');

        $this->actingAsUser($northManager)->getJson('/api/v1/purchasing/approvals')->assertOk()->assertJsonCount(0, 'data');
        $this->actingAsUser($cashier)->getJson('/api/v1/purchasing/approvals')->assertForbidden();
    }
}
