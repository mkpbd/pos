<?php

namespace App\Modules\Purchasing\Tests\Feature;

use App\Modules\Purchasing\Application\Services\RequisitionQuantities;
use App\Modules\Purchasing\Infrastructure\Models\PurchaseOrder;
use App\Modules\Purchasing\Infrastructure\Models\PurchaseOrderLine;
use App\Modules\Purchasing\Tests\Concerns\BuildsProcurement;
use App\Modules\Shared\Tests\Concerns\ReadsExports;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * SC2: cancelling a purchase order created from a requisition (directly or through an RFQ
 * award) gives each linked line's unreceived quantity back to the requisition, reopening a
 * converted requisition as approved; other orders cancel as before.
 */
class PurchaseOrderCancelReleaseTest extends TestCase
{
    use BuildsProcurement, ReadsExports, RefreshDatabase;

    public function test_cancelling_a_converted_order_reopens_the_requisition_once_and_it_can_be_converted_again(): void
    {
        ['admin' => $admin, 'org' => $org, 'branch' => $branch, 'store' => $store, 'variant' => $juice] = $this->procurementWorld();
        $pran = $this->supplier($org, 'Pran');
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]);

        $this->actingAsUser($cashier);
        $requisition = $this->submittedRequisition($store, $juice->id, '1000', '20'); // 20 000.00, manager level
        $lineId = $requisition['lines'][0]['id'];
        $this->actingAsUser($admin);
        $this->transition("requisitions/{$requisition['id']}/approve")->assertOk();

        $convert = ['purchase_orders' => ['lines' => [['requisition_line_id' => $lineId, 'supplier_id' => $pran->id]]]];
        $order = $this->transition("requisitions/{$requisition['id']}/convert", $convert)->assertCreated()
            ->assertJsonPath('data.requisition.status', 'converted')->json('data.purchase_orders.0');
        $this->getJson("/api/v1/purchasing/orders/{$order['id']}")->assertJsonPath('data.lines.0.requisition_line_id', $lineId);
        $this->transition("requisitions/{$requisition['id']}/cancel")->assertStatus(422)->assertJsonPath('error.code', 'INVALID_STATUS_CHANGE');

        // Editing the draft keeps the link; 10 % over the pre-approval → pending approval.
        $this->putJson("/api/v1/purchasing/orders/{$order['id']}", ['supplier_id' => $pran->id, 'store_id' => $store, 'order_date' => now()->toDateString(),
            'lines' => [['variant_id' => $juice->id, 'quantity' => '1000', 'unit_cost' => '22']]])
            ->assertOk()->assertJsonPath('data.lines.0.requisition_line_id', $lineId);
        $this->transition("orders/{$order['id']}/submit")->assertOk()->assertJsonPath('data.status', 'pending_approval');

        $this->postJson("/api/v1/purchasing/orders/{$order['id']}/cancel")->assertOk()->assertJsonPath('data.status', 'cancelled');
        $back = $this->getJson("/api/v1/purchasing/requisitions/{$requisition['id']}")->assertOk()
            ->assertJsonPath('data.status', 'approved')
            ->assertJsonPath('data.converted_at', null)
            ->assertJsonPath('data.lines.0.converted_quantity', '0.000')
            ->assertJsonPath('data.lines.0.remaining_quantity', '1000.000')
            ->json('data');
        $this->assertSame(['draft', 'submitted', 'approved', 'converted', 'approved'], array_column($back['history'], 'to_status'));
        $this->assertSame("Quantities released by {$order['number']} (cancelled).", end($back['history'])['note']);
        $this->assertNull(end($back['history'])['user']);

        // A replayed cancel is refused and releases nothing twice.
        $this->postJson("/api/v1/purchasing/orders/{$order['id']}/cancel")->assertStatus(422)->assertJsonPath('error.code', 'INVALID_STATUS_CHANGE');
        $again = $this->getJson("/api/v1/purchasing/requisitions/{$requisition['id']}")->assertJsonPath('data.lines.0.converted_quantity', '0.000')->json('data');
        $this->assertCount(5, $again['history']);

        // Converted again into a new order.
        $second = $this->transition("requisitions/{$requisition['id']}/convert", $convert)->assertCreated()
            ->assertJsonPath('data.requisition.status', 'converted')
            ->assertJsonPath('data.requisition.lines.0.converted_quantity', '1000.000')
            ->json('data.purchase_orders.0');
        $this->assertNotSame($order['id'], $second['id']);
    }

    public function test_partly_converted_requisition_ordered_and_partly_received_orders(): void
    {
        ['admin' => $admin, 'org' => $org, 'store' => $store, 'variant' => $juice] = $this->procurementWorld();
        $water = $this->stockedVariant($org, 'Water');
        $pran = $this->supplier($org, 'Pran');
        $mills = $this->supplier($org, 'Mills');
        $this->actingAsUser($admin);

        $requisition = $this->raiseRequisition($store, [
            ['variant_id' => $juice->id, 'quantity' => '100', 'estimated_unit_cost' => '10'],
            ['variant_id' => $water->id, 'quantity' => '50', 'estimated_unit_cost' => '10'],
        ])->json('data');
        [$juiceLine, $waterLine] = array_column($requisition['lines'], 'id');
        $this->transition("requisitions/{$requisition['id']}/submit")->assertOk()->assertJsonPath('data.status', 'approved'); // auto-approved

        [$pranOrder, $millsOrder] = $this->transition("requisitions/{$requisition['id']}/convert", ['purchase_orders' => ['lines' => [
            ['requisition_line_id' => $juiceLine, 'supplier_id' => $pran->id, 'quantity' => '60'],
            ['requisition_line_id' => $waterLine, 'supplier_id' => $mills->id],
        ]]])->assertCreated()->assertJsonPath('data.requisition.status', 'approved')->json('data.purchase_orders');
        $this->postJson("/api/v1/purchasing/orders/{$pranOrder['id']}/place")->assertOk()->assertJsonPath('data.status', 'ordered');
        $this->postJson("/api/v1/purchasing/orders/{$millsOrder['id']}/place")->assertOk();
        $historyBefore = count($this->getJson("/api/v1/purchasing/requisitions/{$requisition['id']}")->json('data.history'));

        // Ordered → cancelled: the 60 come back; the requisition was approved and stays so (no status change).
        $this->postJson("/api/v1/purchasing/orders/{$pranOrder['id']}/cancel")->assertOk()->assertJsonPath('data.status', 'cancelled');
        $after = $this->getJson("/api/v1/purchasing/requisitions/{$requisition['id']}")->assertJsonPath('data.status', 'approved')
            ->assertJsonPath('data.lines.0.converted_quantity', '0.000')
            ->assertJsonPath('data.lines.1.converted_quantity', '50.000')
            ->json('data');
        $this->assertCount($historyBefore, $after['history']);

        // Once goods were received the order cannot be cancelled, so nothing is released.
        $millsLine = $this->getJson("/api/v1/purchasing/orders/{$millsOrder['id']}")->json('data.lines.0.id');
        $this->postJson('/api/v1/purchasing/receipts', [
            'supplier_id' => $mills->id, 'store_id' => $store, 'purchase_order_id' => $millsOrder['id'], 'invoice_date' => now()->toDateString(),
            'lines' => [['variant_id' => $water->id, 'purchase_order_line_id' => $millsLine, 'quantity' => '20', 'unit_cost' => '10']],
        ])->assertCreated();
        $this->getJson("/api/v1/purchasing/orders/{$millsOrder['id']}")->assertJsonPath('data.status', 'partially_received');
        $this->postJson("/api/v1/purchasing/orders/{$millsOrder['id']}/cancel")->assertStatus(422)->assertJsonPath('error.code', 'INVALID_STATUS_CHANGE');
        $this->getJson("/api/v1/purchasing/requisitions/{$requisition['id']}")->assertJsonPath('data.lines.1.converted_quantity', '50.000');

        // The release itself only ever gives back what was not received (ordered − received).
        $released = $this->inTenant($org, fn () => DB::transaction(fn () => app(RequisitionQuantities::class)
            ->releaseFromOrder(PurchaseOrder::query()->findOrFail($millsOrder['id']), 'test')));
        $this->assertSame([$waterLine => '30.000'], $released);
        $this->assertSame('20.000', $this->inTenant($org, fn () => PurchaseOrderLine::query()->findOrFail($millsLine)->received_quantity));
        $this->getJson("/api/v1/purchasing/requisitions/{$requisition['id']}")->assertJsonPath('data.lines.1.converted_quantity', '20.000');
    }

    public function test_cancelling_an_order_awarded_from_a_requisition_rfq_releases_to_the_requisition(): void
    {
        $this->fakePdfRenderer();
        ['org' => $org, 'branch' => $branch, 'store' => $store, 'variant' => $juice] = $this->procurementWorld();
        $pran = $this->supplier($org, 'Pran');
        $mills = $this->supplier($org, 'Mills');
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]);
        $manager = $this->createUserWithRole($org, SystemRole::BranchManager, [$branch->id]);
        $buyer = $this->createUserWithRole($org, SystemRole::InventoryManager, [$branch->id]);

        $this->actingAsUser($cashier);
        $requisition = $this->submittedRequisition($store, $juice->id, '1000', '20');
        $reqLine = $requisition['lines'][0]['id'];
        $this->actingAsUser($manager);
        $this->transition("requisitions/{$requisition['id']}/approve")->assertOk();
        $this->actingAsUser($buyer);
        $rfq = $this->transition("requisitions/{$requisition['id']}/convert", ['rfq' => [
            'lines' => [['requisition_line_id' => $reqLine]], 'reply_by' => now()->addDays(2)->toDateString(), 'supplier_ids' => [$pran->id, $mills->id],
        ]])->assertCreated()->assertJsonPath('data.requisition.status', 'converted')->json('data.rfq');
        $this->transition("rfqs/{$rfq['id']}/send")->assertOk();
        $rfqLine = $this->getJson("/api/v1/purchasing/rfqs/{$rfq['id']}")->json('data.lines.0.id');
        $this->transition("rfqs/{$rfq['id']}/quotes", ['supplier_id' => $pran->id, 'status' => 'received', 'lines' => [['rfq_line_id' => $rfqLine, 'unit_price' => '20.50']]])->assertOk();
        $this->transition("rfqs/{$rfq['id']}/quotes", ['supplier_id' => $mills->id, 'status' => 'received', 'lines' => [['rfq_line_id' => $rfqLine, 'unit_price' => '21']]])->assertOk();

        // Split award: everything awarded, so the requisition stays converted.
        $orders = collect($this->transition("rfqs/{$rfq['id']}/award", ['lines' => [
            ['rfq_line_id' => $rfqLine, 'supplier_id' => $pran->id, 'quantity' => '700'],
            ['rfq_line_id' => $rfqLine, 'supplier_id' => $mills->id, 'quantity' => '300'],
        ]])->assertCreated()->json('data.purchase_orders'))->keyBy('supplier.name');
        $this->getJson("/api/v1/purchasing/orders/{$orders['Pran']['id']}")->assertJsonPath('data.lines.0.requisition_line_id', $reqLine);
        $this->getJson("/api/v1/purchasing/requisitions/{$requisition['id']}")->assertJsonPath('data.status', 'converted')
            ->assertJsonPath('data.lines.0.converted_quantity', '1000.000');
        $this->transition("orders/{$orders['Mills']['id']}/submit")->assertOk()->assertJsonPath('data.status', 'ordered'); // pre-approved

        $this->postJson("/api/v1/purchasing/orders/{$orders['Mills']['id']}/cancel")->assertOk()->assertJsonPath('data.status', 'cancelled');
        $back = $this->getJson("/api/v1/purchasing/requisitions/{$requisition['id']}")->assertJsonPath('data.status', 'approved')
            ->assertJsonPath('data.lines.0.converted_quantity', '700.000')
            ->assertJsonPath('data.lines.0.remaining_quantity', '300.000')
            ->json('data');
        $this->assertSame("Quantities released by {$orders['Mills']['number']} (cancelled).", end($back['history'])['note']);

        // The other draft cancels too; the RFQ itself stays awarded.
        $this->postJson("/api/v1/purchasing/orders/{$orders['Pran']['id']}/cancel")->assertOk();
        $this->getJson("/api/v1/purchasing/requisitions/{$requisition['id']}")->assertJsonPath('data.status', 'approved')
            ->assertJsonPath('data.lines.0.converted_quantity', '0.000');
        $this->getJson("/api/v1/purchasing/rfqs/{$rfq['id']}")->assertJsonPath('data.status', 'awarded');
    }

    public function test_cancelling_an_order_not_from_a_requisition_is_unchanged(): void
    {
        ['admin' => $admin, 'org' => $org, 'store' => $store, 'variant' => $juice] = $this->procurementWorld();
        $pran = $this->supplier($org, 'Pran');
        $this->actingAsUser($admin);

        // An unrelated, converted requisition for the same product is left alone.
        $requisition = $this->submittedRequisition($store, $juice->id, '10', '10');
        $this->transition("requisitions/{$requisition['id']}/convert", ['purchase_orders' => ['lines' => [
            ['requisition_line_id' => $requisition['lines'][0]['id'], 'supplier_id' => $pran->id],
        ]]])->assertCreated()->assertJsonPath('data.requisition.status', 'converted');

        $order = $this->draftOrder($pran->id, $store, [['variant_id' => $juice->id, 'quantity' => '10', 'unit_cost' => '10']]);
        $this->assertNull($order['lines'][0]['requisition_line_id']);
        $this->postJson("/api/v1/purchasing/orders/{$order['id']}/place")->assertOk();
        $cancelled = $this->postJson("/api/v1/purchasing/orders/{$order['id']}/cancel")->assertOk()->assertJsonPath('data.status', 'cancelled')->json('data');
        $this->assertSame(['draft', 'ordered', 'cancelled'], array_column($cancelled['history'], 'to_status'));

        $this->getJson("/api/v1/purchasing/requisitions/{$requisition['id']}")->assertJsonPath('data.status', 'converted')
            ->assertJsonPath('data.lines.0.converted_quantity', '10.000');
        $audit = DB::table('audit_logs')->where('action', 'purchase_order.cancelled')->where('subject_id', $order['id'])->value('new_values');
        $this->assertSame(['status' => 'cancelled'], json_decode((string) $audit, true));
    }
}
