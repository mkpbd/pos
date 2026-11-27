<?php

namespace App\Modules\Inventory\Tests\Feature;

use App\Modules\Inventory\Tests\Concerns\InteractsWithStock;
use App\Modules\Organizations\Infrastructure\Models\Organization;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use App\Modules\Users\Infrastructure\Models\Role;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * ST2b §2: a branch requests stock; the source branch dispatches or rejects it.
 */
class TransferRequestTest extends TestCase
{
    use InteractsWithStock, InteractsWithTenancy, RefreshDatabase;

    /**
     * MAIN holds 10 Mango Juice at 6.50; the north clerk works only in NORTH, the main clerk only in MAIN.
     *
     * @return array<string, mixed>
     */
    private function setUpTwoBranches(): array
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $main] = $this->provisionTenant();
        $north = $this->createBranch($org, 'NORTH');
        $variant = $this->stockedVariant($org);
        $from = $this->mainStoreId($org);
        $to = $north->stores()->firstOrFail()->id;
        $this->actingAsUser($admin)->adjust($from, 'opening', ['variant_id' => $variant->id, 'quantity' => '10', 'unit_cost' => '6.50']);
        $mainClerk = $this->createUserWithRole($org, SystemRole::InventoryManager, [$main->id]);
        $northClerk = $this->createUserWithRole($org, SystemRole::InventoryManager, [$north->id]);

        return compact('admin', 'org', 'main', 'north', 'variant', 'from', 'to', 'mainClerk', 'northClerk');
    }

    /**
     * @param  list<string>  $permissions
     */
    private function customRole(Organization $org, array $permissions, string $branchId): User
    {
        $role = $this->inTenant($org, function () use ($permissions) {
            $role = Role::query()->create(['name' => 'Custom '.implode(',', $permissions)]);
            $role->permissions()->sync($permissions);

            return $role;
        });

        return $this->createUserWithRole($org, $role, [$branchId]);
    }

    /**
     * @param  list<array<string, mixed>>  $lines
     * @return array<string, mixed>
     */
    private function requestStock(string $from, string $to, array $lines): array
    {
        return $this->postJson('/api/v1/inventory/transfers/requests', ['from_store_id' => $from, 'to_store_id' => $to, 'note' => 'Weekend', 'lines' => $lines])
            ->assertCreated()->json('data');
    }

    public function test_requesting_stock_moves_nothing(): void
    {
        ['admin' => $admin, 'variant' => $variant, 'from' => $from, 'to' => $to, 'mainClerk' => $mainClerk, 'northClerk' => $northClerk] = $this->setUpTwoBranches();

        $transfer = $this->actingAsUser($northClerk)->requestStock($from, $to, [['variant_id' => $variant->id, 'quantity' => '4']]);
        $this->assertSame('requested', $transfer['status']);
        $this->assertSame('TRF-000001', $transfer['number']);
        $this->assertSame(['id' => $northClerk->id, 'name' => $northClerk->name], $transfer['requested_by']);
        $this->assertSame('Mango Juice', $transfer['lines'][0]['variant']['product_name']);
        $this->assertFalse($transfer['lines'][0]['variant']['track_serials']);
        $this->assertNotNull($transfer['requested_at']);
        $this->assertNull($transfer['dispatched_at']);
        $this->assertSame('4.000', $transfer['lines'][0]['requested_quantity']);
        $this->assertNull($transfer['lines'][0]['batch']);
        $this->assertTrue($transfer['can_cancel']);
        $this->assertFalse($transfer['can_dispatch']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'stock_transfer.requested', 'subject_id' => $transfer['id']]);

        // The requester needs the destination branch, not the source one.
        $this->actingAsUser($mainClerk)->postJson('/api/v1/inventory/transfers/requests', [
            'from_store_id' => $from, 'to_store_id' => $to, 'lines' => [['variant_id' => $variant->id, 'quantity' => '1']],
        ])->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['to_store_id']]]);
        $this->actingAsUser($northClerk)->postJson('/api/v1/inventory/transfers/requests', [
            'from_store_id' => $to, 'to_store_id' => $to, 'lines' => [['variant_id' => $variant->id, 'quantity' => '1']],
        ])->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['from_store_id']]]);

        $this->actingAsUser($admin);
        $this->assertSame('10.000', $this->stockRow($variant->id, $from)['quantity']);
        $this->assertNull($this->stockRow($variant->id, $to));
        $this->getJson('/api/v1/inventory/transfers?status=requested')->assertJsonCount(1, 'data');
        $this->getJson('/api/v1/inventory/transfers?status=in_transit')->assertJsonCount(0, 'data');
    }

    public function test_the_source_dispatches_a_request_in_full_and_the_requester_receives_it(): void
    {
        ['admin' => $admin, 'variant' => $variant, 'from' => $from, 'to' => $to, 'mainClerk' => $mainClerk, 'northClerk' => $northClerk] = $this->setUpTwoBranches();
        $id = $this->actingAsUser($northClerk)->requestStock($from, $to, [['variant_id' => $variant->id, 'quantity' => '4']])['id'];

        $this->actingAsUser($mainClerk)->getJson("/api/v1/inventory/transfers/{$id}")
            ->assertJsonPath('data.can_dispatch', true)->assertJsonPath('data.can_reject', true)->assertJsonPath('data.can_cancel', false);
        $this->actingAsUser($mainClerk)->postJson("/api/v1/inventory/transfers/{$id}/dispatch")->assertOk()
            ->assertJsonPath('data.status', 'in_transit')
            ->assertJsonPath('data.dispatched_by.id', $mainClerk->id)
            ->assertJsonPath('data.dispatched_by.name', $mainClerk->name)
            ->assertJsonPath('data.lines.0.quantity', '4.000')
            ->assertJsonPath('data.lines.0.requested_quantity', '4.000');
        $this->assertDatabaseHas('audit_logs', ['action' => 'stock_transfer.dispatched', 'subject_id' => $id]);
        $this->actingAsUser($mainClerk)->postJson("/api/v1/inventory/transfers/{$id}/dispatch")
            ->assertStatus(422)->assertJsonPath('error.code', 'TRANSFER_NOT_REQUESTED');

        $this->actingAsUser($northClerk)->postJson("/api/v1/inventory/transfers/{$id}/receive")->assertOk()->assertJsonPath('data.status', 'received');

        $this->actingAsUser($admin)->getJson("/api/v1/inventory/transfers/{$id}")->assertJsonPath('data.lines.0.unit_cost', '6.5000');
        $this->assertSame('6.000', $this->stockRow($variant->id, $from)['quantity']);
        $this->assertSame('4.000', $this->stockRow($variant->id, $to)['quantity']);
    }

    public function test_the_source_can_send_less_and_drop_lines(): void
    {
        ['org' => $org, 'admin' => $admin, 'variant' => $variant, 'from' => $from, 'to' => $to] = $this->setUpTwoBranches();
        $tea = $this->stockedVariant($org, 'Tea');
        $this->adjust($from, 'opening', ['variant_id' => $tea->id, 'quantity' => '5', 'unit_cost' => '3']);
        $transfer = $this->requestStock($from, $to, [['variant_id' => $variant->id, 'quantity' => '6'], ['variant_id' => $tea->id, 'quantity' => '2']]);
        $lines = collect($transfer['lines'])->keyBy(fn (array $l) => $l['variant']['id']);
        $juiceLine = $lines[$variant->id]['id'];
        $teaLine = $lines[$tea->id]['id'];
        $url = "/api/v1/inventory/transfers/{$transfer['id']}/dispatch";

        $this->postJson($url, ['lines' => [['line_id' => $juiceLine, 'quantity' => '7']]])
            ->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['lines.0.quantity']]]);
        $this->postJson($url, ['lines' => [['line_id' => $juiceLine, 'quantity' => '0'], ['line_id' => $teaLine, 'quantity' => '0']]])
            ->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['lines']]]);
        $this->postJson($url, ['lines' => [['line_id' => $variant->id, 'quantity' => '1']]])
            ->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['lines.0.line_id']]]);

        $this->postJson($url, ['lines' => [['line_id' => $juiceLine, 'quantity' => '3'], ['line_id' => $teaLine, 'quantity' => '0']]])->assertOk()
            ->assertJsonPath('data.status', 'in_transit')
            ->assertJsonCount(1, 'data.lines')
            ->assertJsonPath('data.lines.0.quantity', '3.000')
            ->assertJsonPath('data.lines.0.requested_quantity', '6.000');
        $this->assertSame('7.000', $this->stockRow($variant->id, $from)['quantity']);
        $this->assertSame('5.000', $this->stockRow($tea->id, $from)['quantity']);
    }

    public function test_batches_are_taken_first_expiry_first_out_unless_one_is_chosen(): void
    {
        ['org' => $org, 'from' => $from, 'to' => $to] = $this->setUpTwoBranches();
        $pills = $this->stockedVariant($org, 'Paracetamol', ['track_batches' => true]);
        $this->adjust($from, 'opening', ['variant_id' => $pills->id, 'quantity' => '3', 'unit_cost' => '2', 'batch_number' => 'LATE', 'expires_on' => now()->addYears(2)->toDateString()]);
        $this->adjust($from, 'opening', ['variant_id' => $pills->id, 'quantity' => '3', 'unit_cost' => '2', 'batch_number' => 'SOON', 'expires_on' => now()->addMonths(2)->toDateString()]);
        $batches = collect($this->getJson("/api/v1/inventory/batches?variant_id={$pills->id}")->json('data'))
            ->mapWithKeys(fn (array $b) => [$b['batch']['batch_number'] => $b['batch']['id']]);

        $fefo = $this->requestStock($from, $to, [['variant_id' => $pills->id, 'quantity' => '4']]);
        $lines = $this->postJson("/api/v1/inventory/transfers/{$fefo['id']}/dispatch")->assertOk()->json('data.lines');
        $byBatch = collect($lines)->keyBy(fn (array $l) => $l['batch']['batch_number']);
        $this->assertSame('3.000', $byBatch['SOON']['quantity']);
        $this->assertSame('1.000', $byBatch['LATE']['quantity']);
        $this->assertSame('4.000', collect($lines)->pluck('requested_quantity')->filter()->sole());

        // A chosen batch is taken as is.
        $chosen = $this->requestStock($from, $to, [['variant_id' => $pills->id, 'quantity' => '2']]);
        $this->postJson("/api/v1/inventory/transfers/{$chosen['id']}/dispatch", ['lines' => [
            ['line_id' => $chosen['lines'][0]['id'], 'quantity' => '2', 'batch_id' => $batches['LATE']],
        ]])->assertOk()->assertJsonCount(1, 'data.lines')->assertJsonPath('data.lines.0.batch.batch_number', 'LATE');
    }

    public function test_dispatch_fails_on_insufficient_stock_and_the_request_stays_open(): void
    {
        ['variant' => $variant, 'from' => $from, 'to' => $to] = $this->setUpTwoBranches();
        $id = $this->requestStock($from, $to, [['variant_id' => $variant->id, 'quantity' => '11']])['id'];

        $this->postJson("/api/v1/inventory/transfers/{$id}/dispatch")->assertStatus(422)->assertJsonPath('error.code', 'INSUFFICIENT_STOCK');
        $this->getJson("/api/v1/inventory/transfers/{$id}")->assertJsonPath('data.status', 'requested')->assertJsonPath('data.lines.0.requested_quantity', '11.000');
        $this->assertSame('10.000', $this->stockRow($variant->id, $from)['quantity']);
    }

    public function test_the_source_rejects_a_request(): void
    {
        ['admin' => $admin, 'variant' => $variant, 'from' => $from, 'to' => $to, 'mainClerk' => $mainClerk, 'northClerk' => $northClerk] = $this->setUpTwoBranches();
        $id = $this->actingAsUser($northClerk)->requestStock($from, $to, [['variant_id' => $variant->id, 'quantity' => '4']])['id'];

        $this->actingAsUser($northClerk)->postJson("/api/v1/inventory/transfers/{$id}/reject", ['reason' => 'No'])->assertNotFound();
        $this->actingAsUser($mainClerk)->postJson("/api/v1/inventory/transfers/{$id}/reject", ['reason' => str_repeat('x', 201)])->assertStatus(422);
        $this->actingAsUser($mainClerk)->postJson("/api/v1/inventory/transfers/{$id}/reject", ['reason' => 'Needed here'])->assertOk()
            ->assertJsonPath('data.status', 'rejected')
            ->assertJsonPath('data.rejected_by.id', $mainClerk->id)
            ->assertJsonPath('data.rejection_reason', 'Needed here');
        $this->assertDatabaseHas('audit_logs', ['action' => 'stock_transfer.rejected', 'subject_id' => $id]);

        $this->actingAsUser($mainClerk)->postJson("/api/v1/inventory/transfers/{$id}/dispatch")
            ->assertStatus(422)->assertJsonPath('error.code', 'TRANSFER_NOT_REQUESTED');
        $this->actingAsUser($admin)->getJson('/api/v1/inventory/transfers?status=rejected')->assertJsonCount(1, 'data');
        $this->assertSame('10.000', $this->stockRow($variant->id, $from)['quantity']);
    }

    public function test_the_requester_cancels_a_request_without_moving_stock(): void
    {
        ['admin' => $admin, 'variant' => $variant, 'from' => $from, 'to' => $to, 'mainClerk' => $mainClerk, 'northClerk' => $northClerk] = $this->setUpTwoBranches();
        $id = $this->actingAsUser($northClerk)->requestStock($from, $to, [['variant_id' => $variant->id, 'quantity' => '4']])['id'];

        $this->actingAsUser($mainClerk)->postJson("/api/v1/inventory/transfers/{$id}/cancel")->assertNotFound();
        $this->actingAsUser($northClerk)->postJson("/api/v1/inventory/transfers/{$id}/cancel")->assertOk()->assertJsonPath('data.status', 'cancelled');
        $this->actingAsUser($northClerk)->postJson("/api/v1/inventory/transfers/{$id}/dispatch")->assertNotFound();
        $this->actingAsUser($mainClerk)->postJson("/api/v1/inventory/transfers/{$id}/dispatch")
            ->assertStatus(422)->assertJsonPath('error.code', 'TRANSFER_NOT_REQUESTED');
        $this->assertDatabaseHas('audit_logs', ['action' => 'stock_transfer.cancelled', 'subject_id' => $id]);

        $this->actingAsUser($admin);
        $this->assertSame(['opening'], array_column($this->getJson("/api/v1/inventory/movements?variant_id={$variant->id}")->json('data'), 'type'));
    }

    public function test_request_actions_follow_branch_access_and_permission(): void
    {
        ['org' => $org, 'main' => $main, 'variant' => $variant, 'from' => $from, 'to' => $to, 'mainClerk' => $mainClerk, 'northClerk' => $northClerk] = $this->setUpTwoBranches();
        $id = $this->actingAsUser($northClerk)->requestStock($from, $to, [['variant_id' => $variant->id, 'quantity' => '4']])['id'];
        $mainViewer = $this->customRole($org, ['inventory.view'], $main->id);

        $this->actingAsUser($northClerk)->getJson("/api/v1/inventory/transfers/{$id}")
            ->assertJsonPath('data.can_dispatch', false)->assertJsonPath('data.can_reject', false)->assertJsonPath('data.can_cancel', true);
        $this->actingAsUser($mainClerk)->getJson('/api/v1/inventory/transfers')
            ->assertJsonPath('data.0.can_dispatch', true)->assertJsonPath('data.0.can_reject', true)->assertJsonPath('data.0.can_cancel', false)
            ->assertJsonPath('data.0.requested_by.name', $northClerk->name);
        $this->actingAsUser($mainViewer)->getJson("/api/v1/inventory/transfers/{$id}")
            ->assertJsonPath('data.can_dispatch', false)->assertJsonPath('data.can_reject', false);
        $this->actingAsUser($mainViewer)->postJson("/api/v1/inventory/transfers/{$id}/dispatch")->assertForbidden();
    }

    public function test_cost_figures_are_hidden_without_the_cost_permission(): void
    {
        ['admin' => $admin, 'org' => $org, 'north' => $north, 'variant' => $variant, 'from' => $from, 'to' => $to] = $this->setUpTwoBranches();
        $transfer = $this->postJson('/api/v1/inventory/transfers', ['from_store_id' => $from, 'to_store_id' => $to, 'lines' => [['variant_id' => $variant->id, 'quantity' => '4']]])->json('data');
        $this->postJson("/api/v1/inventory/transfers/{$transfer['id']}/receive", ['lines' => [['line_id' => $transfer['lines'][0]['id'], 'received_quantity' => '3']]])
            ->assertJsonPath('data.loss_total', '6.50');
        $clerk = $this->customRole($org, ['inventory.view', 'inventory.transfer'], $north->id);

        $this->actingAsUser($clerk)->getJson("/api/v1/inventory/transfers/{$transfer['id']}")->assertOk()
            ->assertJsonPath('data.loss_total', null)->assertJsonPath('data.lines.0.unit_cost', null)
            ->assertJsonPath('data.lines.0.short_quantity', '1.000');
        $this->actingAsUser($clerk)->getJson('/api/v1/inventory/transfers')->assertJsonPath('data.0.loss_total', null);
    }

    public function test_source_stores_lists_every_active_store_of_the_organization(): void
    {
        ['org' => $org, 'from' => $from, 'to' => $to, 'northClerk' => $northClerk] = $this->setUpTwoBranches();
        ['admin' => $rival] = $this->provisionTenant('Rival');
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier);

        $stores = $this->actingAsUser($northClerk)->getJson('/api/v1/inventory/transfers/source-stores')->assertOk()->json('data');
        $this->assertEqualsCanonicalizing([$from, $to], array_column($stores, 'id'));
        $this->assertSame(['id', 'code', 'name', 'branch'], array_keys($stores[0]));
        $this->assertSame(['id', 'name'], array_keys($stores[0]['branch']));
        $this->assertNotContains($from, array_column($this->actingAsUser($rival)->getJson('/api/v1/inventory/transfers/source-stores')->json('data'), 'id'));
        $this->actingAsUser($cashier)->getJson('/api/v1/inventory/transfers/source-stores')->assertForbidden();
    }

    public function test_branch_access_and_organization_isolation(): void
    {
        ['admin' => $admin, 'org' => $org, 'variant' => $variant, 'from' => $from, 'to' => $to, 'northClerk' => $northClerk] = $this->setUpTwoBranches();
        $id = $this->actingAsUser($northClerk)->requestStock($from, $to, [['variant_id' => $variant->id, 'quantity' => '4']])['id'];
        $outsider = $this->createUserWithRole($org, SystemRole::InventoryManager, [$this->createBranch($org, 'SOUTH')->id]);
        ['admin' => $rival] = $this->provisionTenant('Rival');

        // The requester cannot dispatch from a branch they cannot access.
        $this->actingAsUser($northClerk)->postJson("/api/v1/inventory/transfers/{$id}/dispatch")->assertNotFound();
        $this->actingAsUser($outsider)->getJson("/api/v1/inventory/transfers/{$id}")->assertNotFound();
        $this->actingAsUser($outsider)->postJson("/api/v1/inventory/transfers/{$id}/dispatch")->assertNotFound();
        $this->actingAsUser($rival)->getJson("/api/v1/inventory/transfers/{$id}")->assertNotFound();
        $this->actingAsUser($rival)->postJson("/api/v1/inventory/transfers/{$id}/dispatch")->assertNotFound();
        $this->actingAsUser($rival)->postJson("/api/v1/inventory/transfers/{$id}/reject", ['reason' => 'x'])->assertNotFound();
        $this->actingAsUser($rival)->postJson('/api/v1/inventory/transfers/requests', [
            'from_store_id' => $from, 'to_store_id' => $to, 'lines' => [['variant_id' => $variant->id, 'quantity' => '1']],
        ])->assertStatus(422);

        $this->actingAsUser($admin)->getJson("/api/v1/inventory/transfers/{$id}")->assertJsonPath('data.status', 'requested');
        $this->assertSame('10.000', $this->stockRow($variant->id, $from)['quantity']);
    }
}
