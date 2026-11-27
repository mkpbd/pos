<?php

namespace App\Modules\Inventory\Tests\Feature;

use App\Modules\Inventory\Tests\Concerns\InteractsWithStock;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * ST2b §1: receiving a transfer short or damaged.
 */
class TransferReceivingTest extends TestCase
{
    use InteractsWithStock, InteractsWithTenancy, RefreshDatabase;

    /**
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

        return compact('admin', 'org', 'main', 'north', 'variant', 'from', 'to');
    }

    /**
     * @param  list<array<string, mixed>>  $lines
     * @return array<string, mixed>
     */
    private function send(string $from, string $to, array $lines): array
    {
        return $this->postJson('/api/v1/inventory/transfers', ['from_store_id' => $from, 'to_store_id' => $to, 'lines' => $lines])
            ->assertCreated()->json('data');
    }

    public function test_receiving_without_a_body_takes_every_line_in_full(): void
    {
        ['variant' => $variant, 'from' => $from, 'to' => $to] = $this->setUpTwoBranches();
        $transfer = $this->send($from, $to, [['variant_id' => $variant->id, 'quantity' => '4']]);
        $this->assertNull($transfer['lines'][0]['received_quantity']);
        $this->assertNull($transfer['lines'][0]['short_quantity']);

        $this->postJson("/api/v1/inventory/transfers/{$transfer['id']}/receive")->assertOk()
            ->assertJsonPath('data.status', 'received')
            ->assertJsonPath('data.loss_total', '0.00')
            ->assertJsonPath('data.has_discrepancy', false)
            ->assertJsonPath('data.lines.0.received_quantity', '4.000')
            ->assertJsonPath('data.lines.0.damaged_quantity', '0.000')
            ->assertJsonPath('data.lines.0.short_quantity', '0.000');
        $this->assertSame('4.000', $this->stockRow($variant->id, $to)['quantity']);
    }

    public function test_short_and_damaged_units_stay_out_of_stock_and_are_the_loss(): void
    {
        ['variant' => $variant, 'from' => $from, 'to' => $to] = $this->setUpTwoBranches();
        $transfer = $this->send($from, $to, [['variant_id' => $variant->id, 'quantity' => '10']]);
        $lineId = $transfer['lines'][0]['id'];

        $this->postJson("/api/v1/inventory/transfers/{$transfer['id']}/receive", ['lines' => [
            ['line_id' => $lineId, 'received_quantity' => '6', 'damaged_quantity' => '1', 'note' => 'Box crushed'],
        ]])->assertOk()
            ->assertJsonPath('data.status', 'received')
            ->assertJsonPath('data.loss_total', '26.00')
            ->assertJsonPath('data.has_discrepancy', true)
            ->assertJsonPath('data.lines.0.received_quantity', '6.000')
            ->assertJsonPath('data.lines.0.damaged_quantity', '1.000')
            ->assertJsonPath('data.lines.0.short_quantity', '3.000')
            ->assertJsonPath('data.lines.0.receive_note', 'Box crushed');

        $this->assertSame('6.000', $this->stockRow($variant->id, $to)['quantity']);
        $this->assertSame('39.00', $this->stockRow($variant->id, $to)['value']);
        $this->assertSame('0.000', $this->stockRow($variant->id, $from)['quantity']);
        $this->assertTrue($this->getJson('/api/v1/inventory/transfers')->json('data.0.has_discrepancy'));
        $this->assertDatabaseHas('audit_logs', ['action' => 'stock_transfer.received', 'subject_id' => $transfer['id']]);

        // Nothing received at all: no stock in, the whole line is the loss.
        $second = $this->send($to, $from, [['variant_id' => $variant->id, 'quantity' => '2']]);
        $this->postJson("/api/v1/inventory/transfers/{$second['id']}/receive", ['lines' => [
            ['line_id' => $second['lines'][0]['id'], 'received_quantity' => '0', 'damaged_quantity' => '2'],
        ]])->assertOk()->assertJsonPath('data.loss_total', '13.00')->assertJsonPath('data.lines.0.short_quantity', '0.000');
        $this->assertSame('0.000', $this->stockRow($variant->id, $from)['quantity']);
    }

    public function test_over_receiving_and_bad_lines_are_refused(): void
    {
        ['variant' => $variant, 'from' => $from, 'to' => $to] = $this->setUpTwoBranches();
        $transfer = $this->send($from, $to, [['variant_id' => $variant->id, 'quantity' => '5']]);
        $url = "/api/v1/inventory/transfers/{$transfer['id']}/receive";
        $lineId = $transfer['lines'][0]['id'];

        $this->postJson($url, ['lines' => [['line_id' => $lineId, 'received_quantity' => '6']]])
            ->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['lines.0.received_quantity']]]);
        $this->postJson($url, ['lines' => [['line_id' => $lineId, 'received_quantity' => '4', 'damaged_quantity' => '2']]])
            ->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['lines.0.received_quantity']]]);
        $this->postJson($url, ['lines' => [['line_id' => $lineId, 'received_quantity' => '2.5']]])
            ->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['lines.0.received_quantity']]]);
        $this->postJson($url, ['lines' => [['line_id' => $lineId, 'received_quantity' => '-1']]])->assertStatus(422);
        $this->postJson($url, ['lines' => [['line_id' => $variant->id, 'received_quantity' => '1']]])
            ->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['lines.0.line_id']]]);

        $this->getJson("/api/v1/inventory/transfers/{$transfer['id']}")->assertJsonPath('data.status', 'in_transit');
        $this->assertNull($this->stockRow($variant->id, $to));
    }

    public function test_a_batch_line_received_short_books_only_what_arrived_in_that_batch(): void
    {
        ['org' => $org, 'from' => $from, 'to' => $to] = $this->setUpTwoBranches();
        $pills = $this->stockedVariant($org, 'Paracetamol', ['track_batches' => true]);
        $this->adjust($from, 'opening', ['variant_id' => $pills->id, 'quantity' => '8', 'unit_cost' => '2', 'batch_number' => 'B-1', 'expires_on' => now()->addYear()->toDateString()]);
        $batchId = $this->getJson("/api/v1/inventory/batches?variant_id={$pills->id}")->json('data.0.batch.id');

        $transfer = $this->send($from, $to, [['variant_id' => $pills->id, 'quantity' => '8', 'batch_id' => $batchId]]);
        $this->postJson("/api/v1/inventory/transfers/{$transfer['id']}/receive", ['lines' => [
            ['line_id' => $transfer['lines'][0]['id'], 'received_quantity' => '5'],
        ]])->assertOk()->assertJsonPath('data.loss_total', '6.00')->assertJsonPath('data.lines.0.short_quantity', '3.000');

        $this->getJson("/api/v1/inventory/batches?variant_id={$pills->id}&store_id={$to}")
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.quantity', '5.000')
            ->assertJsonPath('data.0.batch.batch_number', 'B-1');
    }

    public function test_a_serial_numbered_line_must_be_received_in_full(): void
    {
        ['org' => $org, 'from' => $from, 'to' => $to] = $this->setUpTwoBranches();
        $phone = $this->stockedVariant($org, 'Phone', ['track_serials' => true]);
        $this->adjust($from, 'opening', ['variant_id' => $phone->id, 'quantity' => '3', 'unit_cost' => '100', 'serials' => ['P1', 'P2', 'P3']]);
        $transfer = $this->send($from, $to, [['variant_id' => $phone->id, 'quantity' => '3', 'serials' => ['P1', 'P2', 'P3']]]);
        $url = "/api/v1/inventory/transfers/{$transfer['id']}/receive";
        $lineId = $transfer['lines'][0]['id'];

        $this->postJson($url, ['lines' => [['line_id' => $lineId, 'received_quantity' => '2']]])
            ->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['lines.0.received_quantity']]]);
        $this->postJson($url, ['lines' => [['line_id' => $lineId, 'received_quantity' => '3']]])->assertOk()
            ->assertJsonPath('data.has_discrepancy', false);
        $this->getJson("/api/v1/inventory/stores/{$to}/serials?variant_id={$phone->id}")->assertOk()->assertJsonPath('data.*.serial', ['P1', 'P2', 'P3']);
    }

    public function test_only_the_receiving_branch_of_the_same_organization_can_receive(): void
    {
        ['admin' => $admin, 'org' => $org, 'main' => $main, 'variant' => $variant, 'from' => $from, 'to' => $to] = $this->setUpTwoBranches();
        $transfer = $this->send($from, $to, [['variant_id' => $variant->id, 'quantity' => '2']]);
        $body = ['lines' => [['line_id' => $transfer['lines'][0]['id'], 'received_quantity' => '1']]];
        $mainClerk = $this->createUserWithRole($org, SystemRole::InventoryManager, [$main->id]);
        ['admin' => $rival] = $this->provisionTenant('Rival');

        $this->actingAsUser($mainClerk)->postJson("/api/v1/inventory/transfers/{$transfer['id']}/receive", $body)->assertNotFound();
        $this->actingAsUser($rival)->postJson("/api/v1/inventory/transfers/{$transfer['id']}/receive", $body)->assertNotFound();
        $this->actingAsUser($admin)->getJson("/api/v1/inventory/transfers/{$transfer['id']}")->assertJsonPath('data.status', 'in_transit');
        $this->assertNull($this->stockRow($variant->id, $to));
    }
}
