<?php

namespace App\Modules\Purchasing\Tests\Feature;

use App\Modules\Purchasing\Tests\Concerns\BuildsProcurement;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * ST2a: purchase returns without a goods receipt.
 */
class DirectPurchaseReturnTest extends TestCase
{
    use BuildsProcurement, RefreshDatabase;

    /**
     * @param  list<array<string, mixed>>  $lines
     */
    private function receive(string $supplierId, string $store, array $lines): array
    {
        return $this->postJson('/api/v1/purchasing/receipts', [
            'supplier_id' => $supplierId, 'store_id' => $store, 'invoice_date' => now()->toDateString(), 'lines' => $lines,
        ])->assertCreated()->json('data');
    }

    /**
     * @param  list<array<string, mixed>>  $lines
     */
    private function directReturn(string $supplierId, string $store, array $lines, int $status = 201): TestResponse
    {
        return $this->postJson('/api/v1/purchasing/returns', [
            'supplier_id' => $supplierId, 'store_id' => $store, 'reason' => 'Bought before go-live', 'notes' => 'Old stock', 'lines' => $lines,
        ])->assertStatus($status);
    }

    private function balance(string $supplierId): string
    {
        return $this->getJson("/api/v1/purchasing/supplier-balances?supplier_ids[]={$supplierId}")->assertOk()->json("data.{$supplierId}");
    }

    public function test_the_credit_defaults_to_the_average_cost_or_takes_the_given_cost(): void
    {
        ['admin' => $admin, 'org' => $org, 'store' => $store, 'variant' => $juice] = $this->procurementWorld();
        $pran = $this->supplier($org, 'Pran');
        $other = $this->supplier($org, 'Other Supplier');
        $this->actingAsUser($admin);
        $this->receive($other->id, $store, [['variant_id' => $juice->id, 'quantity' => '10', 'unit_cost' => '20']]);
        $this->receive($other->id, $store, [['variant_id' => $juice->id, 'quantity' => '10', 'unit_cost' => '30']]);

        $return = $this->directReturn($pran->id, $store, [['variant_id' => $juice->id, 'quantity' => '4']])
            ->assertJsonPath('data.number', 'PRN-000001')
            ->assertJsonPath('data.goods_receipt_id', null)
            ->assertJsonPath('data.reason', 'Bought before go-live')
            ->assertJsonPath('data.lines.0.goods_receipt_line_id', null)
            ->assertJsonPath('data.lines.0.unit_cost', '25.0000')
            ->assertJsonPath('data.total', '100.00')
            ->json('data');
        $this->assertSame('16.000', $this->stockRow($juice->id, $store)['quantity']);

        $this->directReturn($pran->id, $store, [['variant_id' => $juice->id, 'quantity' => '2', 'unit_cost' => '22.5']])
            ->assertJsonPath('data.lines.0.unit_cost', '22.5000')
            ->assertJsonPath('data.total', '45.00');
        // The stock left at the average cost, whatever the supplier credits.
        $this->assertSame(['14.000', '350.00'], [$this->stockRow($juice->id, $store)['quantity'], $this->stockRow($juice->id, $store)['value']]);
        $this->assertSame(['25.0000', '25.0000'], DB::table('stock_movements')->where('type', 'purchase_return')->orderBy('created_at')->pluck('unit_cost')->map(fn ($c) => (string) $c)->all());

        // What the supplier is owed drops by the returns (no receipt from this supplier).
        $this->assertSame('-145.00', $this->balance($pran->id));
        $this->getJson("/api/v1/purchasing/returns/{$return['id']}")->assertOk()->assertJsonPath('data.goods_receipt_id', null);
        $this->getJson("/api/v1/purchasing/returns?supplier_id={$pran->id}")->assertOk()->assertJsonCount(2, 'data');
        $this->assertSame(1, DB::table('audit_logs')->where('action', 'purchase_return.posted')->where('subject_id', $return['id'])->count());
    }

    public function test_batches_stock_and_line_rules(): void
    {
        ['admin' => $admin, 'org' => $org, 'store' => $store, 'variant' => $juice] = $this->procurementWorld();
        $napa = $this->stockedVariant($org, 'Napa 500mg', ['track_batches' => true]);
        $delivery = $this->stockedVariant($org, 'Delivery charge', ['type' => 'service']);
        $pran = $this->supplier($org, 'Pran');
        $this->actingAsUser($admin);
        $receipt = $this->receive($pran->id, $store, [
            ['variant_id' => $napa->id, 'quantity' => '100', 'unit_cost' => '0.80', 'batch_number' => 'NP-1', 'expires_on' => '2030-01-31'],
            ['variant_id' => $juice->id, 'quantity' => '5', 'unit_cost' => '10', 'batch_number' => null],
        ]);
        $batchId = $receipt['lines'][0]['batch']['id'];

        $this->directReturn($pran->id, $store, [['variant_id' => $napa->id, 'quantity' => '10']], 422)->assertJsonStructure(['error' => ['details' => ['lines.0.batch_id']]]);
        $this->directReturn($pran->id, $store, [['variant_id' => $juice->id, 'quantity' => '1', 'batch_id' => $batchId]], 422);
        $this->directReturn($pran->id, $store, [['variant_id' => $delivery->id, 'quantity' => '1']], 422)->assertJsonStructure(['error' => ['details' => ['lines.0.variant_id']]]);
        $this->directReturn($pran->id, $store, [['variant_id' => $juice->id, 'quantity' => '1.5']], 422)->assertJsonStructure(['error' => ['details' => ['lines.0.quantity']]]);
        $this->directReturn($pran->id, $store, [['variant_id' => $juice->id, 'quantity' => '6']], 422)->assertJsonPath('error.code', 'INSUFFICIENT_STOCK');

        $this->directReturn($pran->id, $store, [['variant_id' => $napa->id, 'quantity' => '10', 'batch_id' => $batchId]])
            ->assertJsonPath('data.lines.0.batch.batch_number', 'NP-1')
            ->assertJsonPath('data.lines.0.unit_cost', '0.8000')
            ->assertJsonPath('data.total', '8.00');
        $this->assertSame('90.000', $this->stockRow($napa->id, $store)['quantity']);
        $this->assertSame('5.000', $this->stockRow($juice->id, $store)['quantity'], 'a refused return moves nothing');
        $this->assertSame(1, DB::table('purchase_returns')->count());
    }

    public function test_permissions_and_isolation(): void
    {
        ['admin' => $admin, 'org' => $org, 'branch' => $branch, 'store' => $store, 'variant' => $juice] = $this->procurementWorld();
        $pran = $this->supplier($org, 'Pran');
        $inactive = $this->supplier($org, 'Gone', ['is_active' => false]);
        $this->actingAsUser($admin);
        $this->receive($pran->id, $store, [['variant_id' => $juice->id, 'quantity' => '10', 'unit_cost' => '10']]);
        ['admin' => $rivalAdmin, 'organization' => $rival] = $this->provisionTenant('Rival');
        $rivalSupplier = $this->supplier($rival, 'Rival Supplier');
        $rivalProduct = $this->stockedVariant($rival, 'Rival Juice');
        $line = [['variant_id' => $juice->id, 'quantity' => '1']];

        $this->directReturn($rivalSupplier->id, $store, $line, 422)->assertJsonStructure(['error' => ['details' => ['supplier_id']]]);
        $this->directReturn($inactive->id, $store, $line, 422)->assertJsonPath('error.details.supplier_id.0', 'The selected supplier is inactive.');
        $this->directReturn($pran->id, $store, [['variant_id' => $rivalProduct->id, 'quantity' => '1']], 422)->assertJsonStructure(['error' => ['details' => ['lines.0.variant_id']]]);

        $accountant = $this->createUserWithRole($org, SystemRole::Accountant, [$branch->id]);
        $this->actingAsUser($accountant)->postJson('/api/v1/purchasing/returns', ['supplier_id' => $pran->id, 'store_id' => $store, 'reason' => 'x', 'lines' => $line])->assertForbidden();
        $north = $this->createBranch($org, 'NORTH');
        $northBuyer = $this->createUserWithRole($org, SystemRole::InventoryManager, [$north->id]);
        $this->actingAsUser($northBuyer)->postJson('/api/v1/purchasing/returns', ['supplier_id' => $pran->id, 'store_id' => $store, 'reason' => 'x', 'lines' => $line])
            ->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['store_id']]]);
        $this->actingAsUser($rivalAdmin)->postJson('/api/v1/purchasing/returns', ['supplier_id' => $pran->id, 'store_id' => $store, 'reason' => 'x', 'lines' => $line])->assertStatus(422);

        $buyer = $this->createUserWithRole($org, SystemRole::InventoryManager, [$branch->id]);
        $id = $this->actingAsUser($buyer)->postJson('/api/v1/purchasing/returns', ['supplier_id' => $pran->id, 'store_id' => $store, 'reason' => 'x', 'lines' => $line])->assertCreated()->json('data.id');
        $this->actingAsUser($northBuyer)->getJson("/api/v1/purchasing/returns/{$id}")->assertNotFound();
        $this->actingAsUser($rivalAdmin)->getJson('/api/v1/purchasing/returns')->assertOk()->assertJsonCount(0, 'data');
        $this->assertSame('9.000', $this->actingAsUser($admin)->stockRow($juice->id, $store)['quantity']);
    }
}
