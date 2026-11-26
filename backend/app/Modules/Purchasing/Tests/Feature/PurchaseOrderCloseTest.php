<?php

namespace App\Modules\Purchasing\Tests\Feature;

use App\Modules\Purchasing\Tests\Concerns\BuildsProcurement;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * ST2a: short-closing a partly received purchase order.
 */
class PurchaseOrderCloseTest extends TestCase
{
    use BuildsProcurement, RefreshDatabase;

    private function onOrder(string $store, string $productName): string
    {
        return collect($this->getJson("/api/v1/purchasing/reorder-suggestions?store_id={$store}")->assertOk()->json('data'))
            ->keyBy('variant.product_name')[$productName]['on_order'];
    }

    public function test_a_partly_received_order_is_closed_short_and_its_rest_is_no_longer_on_order(): void
    {
        ['admin' => $admin, 'org' => $org, 'store' => $store] = $this->procurementWorld();
        $rice = $this->stockedVariant($org, 'Miniket Rice', reorderLevel: '50');
        $pran = $this->supplier($org, 'Pran');
        $this->actingAsUser($admin);
        $order = $this->draftOrder($pran->id, $store, [['variant_id' => $rice->id, 'quantity' => '10', 'unit_cost' => '20']]);
        $this->postJson("/api/v1/purchasing/orders/{$order['id']}/place")->assertOk();
        $this->assertSame('10.000', $this->onOrder($store, 'Miniket Rice'));

        $this->postJson("/api/v1/purchasing/orders/{$order['id']}/close", ['reason' => 'Supplier out of stock'])->assertStatus(422)
            ->assertJsonPath('error.code', 'PURCHASE_ORDER_NOT_CLOSABLE')
            ->assertJsonPath('error.details.status', 'ordered');

        $receive = fn (string $qty, int $status = 201) => $this->postJson('/api/v1/purchasing/receipts', [
            'supplier_id' => $pran->id, 'store_id' => $store, 'purchase_order_id' => $order['id'], 'invoice_date' => now()->toDateString(),
            'lines' => [['variant_id' => $rice->id, 'purchase_order_line_id' => $order['lines'][0]['id'], 'quantity' => $qty, 'unit_cost' => '20']],
        ])->assertStatus($status);
        $receive('4');
        $this->assertSame('6.000', $this->onOrder($store, 'Miniket Rice'));

        $this->postJson("/api/v1/purchasing/orders/{$order['id']}/close", [])->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['reason']]]);
        $this->postJson("/api/v1/purchasing/orders/{$order['id']}/close", ['reason' => str_repeat('x', 201)])->assertStatus(422);
        $closed = $this->postJson("/api/v1/purchasing/orders/{$order['id']}/close", ['reason' => ' Supplier out of stock '])->assertOk()
            ->assertJsonPath('data.status', 'closed')
            ->assertJsonPath('data.close_reason', 'Supplier out of stock')
            ->assertJsonPath('data.lines.0.received_quantity', '4.000')
            ->json('data');
        $this->assertNotNull($closed['closed_at']);
        $this->assertSame(['draft', 'ordered', 'partially_received', 'closed'], array_column($closed['history'], 'to_status'));

        $this->assertSame('0.000', $this->onOrder($store, 'Miniket Rice'));
        $receive('1', 422)->assertJsonPath('error.code', 'PURCHASE_ORDER_NOT_OPEN');
        $this->postJson("/api/v1/purchasing/orders/{$order['id']}/cancel")->assertStatus(422);
        $this->postJson("/api/v1/purchasing/orders/{$order['id']}/close", ['reason' => 'Again'])->assertStatus(422)->assertJsonPath('error.details.status', 'closed');

        $this->getJson('/api/v1/purchasing/orders?status=closed')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $order['id']);
        $audit = json_decode((string) DB::table('audit_logs')->where('action', 'purchase_order.closed')->where('subject_id', $order['id'])->value('new_values'), true);
        $this->assertEquals(['status' => 'closed', 'reason' => 'Supplier out of stock', 'open_quantities' => [$order['lines'][0]['id'] => '6.000']], $audit);

        // Supplier performance: the order is final and 6 short.
        $issue = $this->getJson("/api/v1/purchasing/suppliers/{$pran->id}/performance")->assertOk()->json('data.problem_deliveries.0');
        $this->assertSame(['closed', true, '6.000'], [$issue['status'], $issue['is_short'], $issue['short_quantity']]);
    }

    public function test_closing_needs_the_cancel_permission_and_branch_access(): void
    {
        ['admin' => $admin, 'org' => $org, 'branch' => $branch, 'store' => $store, 'variant' => $juice] = $this->procurementWorld();
        $pran = $this->supplier($org, 'Pran');
        $this->actingAsUser($admin);
        $order = $this->draftOrder($pran->id, $store, [['variant_id' => $juice->id, 'quantity' => '10', 'unit_cost' => '20']]);
        $this->postJson("/api/v1/purchasing/orders/{$order['id']}/place")->assertOk();
        $this->postJson('/api/v1/purchasing/receipts', [
            'supplier_id' => $pran->id, 'store_id' => $store, 'purchase_order_id' => $order['id'], 'invoice_date' => now()->toDateString(),
            'lines' => [['variant_id' => $juice->id, 'purchase_order_line_id' => $order['lines'][0]['id'], 'quantity' => '4', 'unit_cost' => '20']],
        ])->assertCreated();

        $accountant = $this->createUserWithRole($org, SystemRole::Accountant, [$branch->id]);
        $north = $this->createBranch($org, 'NORTH');
        $northBuyer = $this->createUserWithRole($org, SystemRole::InventoryManager, [$north->id]);
        ['admin' => $rival] = $this->provisionTenant('Rival');
        $body = ['reason' => 'Short'];

        $this->actingAsUser($accountant)->postJson("/api/v1/purchasing/orders/{$order['id']}/close", $body)->assertForbidden();
        $this->actingAsUser($northBuyer)->postJson("/api/v1/purchasing/orders/{$order['id']}/close", $body)->assertNotFound();
        $this->actingAsUser($rival)->postJson("/api/v1/purchasing/orders/{$order['id']}/close", $body)->assertNotFound();
        $buyer = $this->createUserWithRole($org, SystemRole::InventoryManager, [$branch->id]);
        $this->actingAsUser($buyer)->postJson("/api/v1/purchasing/orders/{$order['id']}/close", $body)->assertOk()->assertJsonPath('data.status', 'closed');
    }
}
