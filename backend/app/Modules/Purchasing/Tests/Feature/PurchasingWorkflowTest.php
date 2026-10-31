<?php

namespace App\Modules\Purchasing\Tests\Feature;

use App\Modules\Inventory\Tests\Concerns\InteractsWithStock;
use App\Modules\Organizations\Infrastructure\Models\Organization;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Suppliers\Infrastructure\Models\Supplier;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Critical workflow #2: purchase and stock receiving (plus returns and supplier payables).
 */
class PurchasingWorkflowTest extends TestCase
{
    use InteractsWithStock, InteractsWithTenancy, RefreshDatabase;

    private function supplier(Organization $org, array $attributes = []): Supplier
    {
        return app(TenantContext::class)->runAs($org->id, fn () => Supplier::query()->create($attributes + [
            'code' => 'SUP-'.random_int(1000, 9999), 'name' => 'Pran Distribution', 'payment_terms_days' => 30,
        ]));
    }

    /**
     * @return array<string, mixed>
     */
    private function world(): array
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $variant = $this->stockedVariant($org);
        $store = $this->mainStoreId($org);
        $supplier = $this->supplier($org, ['opening_balance' => '100.00']);
        $this->actingAsUser($admin);

        return compact('admin', 'org', 'branch', 'variant', 'store', 'supplier');
    }

    public function test_purchase_order_lifecycle_with_server_side_totals(): void
    {
        ['variant' => $variant, 'store' => $store, 'supplier' => $supplier] = $this->world();
        $payload = [
            'supplier_id' => $supplier->id, 'store_id' => $store, 'order_date' => now()->toDateString(),
            'lines' => [['variant_id' => $variant->id, 'quantity' => '10', 'unit_cost' => '18.50', 'tax_rate' => '15', 'line_total' => '1.00']],
            'total' => '1.00',
        ];

        $order = $this->postJson('/api/v1/purchasing/orders', $payload)->assertCreated()
            ->assertJsonPath('data.number', 'PO-000001')
            ->assertJsonPath('data.status', 'draft')
            ->assertJsonPath('data.subtotal', '185.00')
            ->assertJsonPath('data.tax_total', '27.75')
            ->assertJsonPath('data.total', '212.75')
            ->json('data');

        $payload['lines'][0]['quantity'] = '12';
        $this->putJson("/api/v1/purchasing/orders/{$order['id']}", $payload)->assertOk()->assertJsonPath('data.total', '255.30');

        $this->postJson("/api/v1/purchasing/orders/{$order['id']}/place")->assertOk()->assertJsonPath('data.status', 'ordered');
        $this->putJson("/api/v1/purchasing/orders/{$order['id']}", $payload)->assertStatus(422)->assertJsonPath('error.code', 'PURCHASE_ORDER_LOCKED');
        $this->postJson("/api/v1/purchasing/orders/{$order['id']}/place")->assertStatus(422)->assertJsonPath('error.code', 'INVALID_STATUS_CHANGE');
    }

    public function test_receiving_against_an_order_updates_stock_cost_and_order_status(): void
    {
        ['variant' => $variant, 'store' => $store, 'supplier' => $supplier] = $this->world();
        $order = $this->postJson('/api/v1/purchasing/orders', [
            'supplier_id' => $supplier->id, 'store_id' => $store, 'order_date' => now()->toDateString(),
            'lines' => [['variant_id' => $variant->id, 'quantity' => '10', 'unit_cost' => '20']],
        ])->json('data');
        $this->postJson("/api/v1/purchasing/orders/{$order['id']}/place");
        $lineId = $order['lines'][0]['id'];

        $receive = fn (string $qty, string $cost, int $status = 201) => $this->postJson('/api/v1/purchasing/receipts', [
            'supplier_id' => $supplier->id, 'store_id' => $store, 'purchase_order_id' => $order['id'],
            'invoice_date' => now()->toDateString(),
            'lines' => [['variant_id' => $variant->id, 'purchase_order_line_id' => $lineId, 'quantity' => $qty, 'unit_cost' => $cost]],
        ])->assertStatus($status);

        $receive('4', '20')->assertJsonPath('data.number', 'GRN-000001')->assertJsonPath('data.total', '80.00');
        $this->getJson("/api/v1/purchasing/orders/{$order['id']}")->assertJsonPath('data.status', 'partially_received')
            ->assertJsonPath('data.lines.0.received_quantity', '4.000');

        $receive('7', '20', 422)->assertJsonPath('error.details', ['lines.0.quantity' => ['Only 6.000 still open on the order.']]);
        $receive('6', '23'); // price changed on the invoice
        $this->getJson("/api/v1/purchasing/orders/{$order['id']}")->assertJsonPath('data.status', 'received');
        $receive('1', '20', 422)->assertJsonPath('error.code', 'PURCHASE_ORDER_NOT_OPEN');

        // 4 @ 20 + 6 @ 23 = 218 → average 21.80
        $this->assertSame('10.000', $this->stockRow($variant->id, $store)['quantity']);
        $this->assertSame('218.00', $this->stockRow($variant->id, $store)['value']);
        $this->postJson("/api/v1/purchasing/orders/{$order['id']}/cancel")->assertStatus(422);
    }

    public function test_direct_receipt_with_batches_due_date_and_duplicate_invoice_check(): void
    {
        ['org' => $org, 'store' => $store, 'supplier' => $supplier] = $this->world();
        $medicine = $this->stockedVariant($org, 'Napa 500mg', ['track_batches' => true]);
        $service = $this->stockedVariant($org, 'Delivery charge', ['type' => 'service']);
        $line = ['variant_id' => $medicine->id, 'quantity' => '100', 'unit_cost' => '0.80'];

        $base = ['supplier_id' => $supplier->id, 'store_id' => $store, 'invoice_date' => '2026-10-01', 'supplier_invoice_number' => 'INV-77'];
        $this->postJson('/api/v1/purchasing/receipts', $base + ['lines' => [$line]])
            ->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['lines.0.batch_number']]]);

        $receipt = $this->postJson('/api/v1/purchasing/receipts', $base + ['lines' => [
            $line + ['batch_number' => 'NP-2611', 'expires_on' => '2027-11-30'],
            ['variant_id' => $service->id, 'quantity' => '1', 'unit_cost' => '150'],
        ]])->assertCreated()
            ->assertJsonPath('data.due_date', '2026-10-31')
            ->assertJsonPath('data.total', '230.00')
            ->assertJsonPath('data.lines.0.batch.batch_number', 'NP-2611')
            ->json('data');

        $this->assertSame('100.000', $this->stockRow($medicine->id, $store)['quantity']);
        $this->assertNull($this->stockRow($service->id, $store), 'services are not stocked');

        $this->postJson('/api/v1/purchasing/receipts', [...$base, 'supplier_invoice_number' => 'inv-77', 'lines' => [$line + ['batch_number' => 'X']]])
            ->assertStatus(422)->assertJsonPath('error.details.supplier_invoice_number.0', 'This supplier invoice has already been recorded.');
        $this->getJson('/api/v1/purchasing/receipts?search=INV-77')->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $receipt['id']);
    }

    public function test_purchase_returns_are_limited_to_what_was_received(): void
    {
        ['variant' => $variant, 'store' => $store, 'supplier' => $supplier] = $this->world();
        $receipt = $this->postJson('/api/v1/purchasing/receipts', [
            'supplier_id' => $supplier->id, 'store_id' => $store, 'invoice_date' => now()->toDateString(),
            'lines' => [['variant_id' => $variant->id, 'quantity' => '10', 'unit_cost' => '12', 'tax_rate' => '10']],
        ])->json('data');
        $lineId = $receipt['lines'][0]['id'];

        $this->postJson("/api/v1/purchasing/receipts/{$receipt['id']}/returns", ['reason' => 'Damaged', 'lines' => [['goods_receipt_line_id' => $lineId, 'quantity' => '3']]])
            ->assertCreated()
            ->assertJsonPath('data.number', 'PRN-000001')
            ->assertJsonPath('data.total', '39.60')
            ->assertJsonPath('data.lines.0.unit_cost', '12.0000');
        $this->assertSame('7.000', $this->stockRow($variant->id, $store)['quantity']);

        $this->postJson("/api/v1/purchasing/receipts/{$receipt['id']}/returns", ['reason' => 'More', 'lines' => [['goods_receipt_line_id' => $lineId, 'quantity' => '8']]])
            ->assertStatus(422)->assertJsonPath('error.details', ['lines.0.quantity' => ['Only 7.000 can still be returned.']]);

        // Goods already gone from the store cannot be returned (no negative stock).
        $this->adjust($store, 'damage', ['variant_id' => $variant->id, 'quantity' => '-6']);
        $this->postJson("/api/v1/purchasing/receipts/{$receipt['id']}/returns", ['reason' => 'Late', 'lines' => [['goods_receipt_line_id' => $lineId, 'quantity' => '2']]])
            ->assertStatus(422)->assertJsonPath('error.code', 'INSUFFICIENT_STOCK');
        $this->getJson("/api/v1/purchasing/receipts/{$receipt['id']}")->assertJsonPath('data.lines.0.returned_quantity', '3.000');
    }

    public function test_supplier_balance_and_statement(): void
    {
        ['variant' => $variant, 'store' => $store, 'supplier' => $supplier] = $this->world();
        $receipt = $this->postJson('/api/v1/purchasing/receipts', [
            'supplier_id' => $supplier->id, 'store_id' => $store, 'invoice_date' => '2026-10-05',
            'lines' => [['variant_id' => $variant->id, 'quantity' => '10', 'unit_cost' => '50']],
        ])->json('data');
        $this->postJson("/api/v1/purchasing/receipts/{$receipt['id']}/returns", ['reason' => 'Wrong item', 'lines' => [['goods_receipt_line_id' => $receipt['lines'][0]['id'], 'quantity' => '2']]]);
        $this->postJson('/api/v1/purchasing/payments', ['supplier_id' => $supplier->id, 'amount' => '250.50', 'method' => 'bank_transfer', 'paid_on' => '2026-10-20', 'reference' => 'TT-1'])
            ->assertCreated()->assertJsonPath('data.number', 'SPAY-000001');
        $this->postJson('/api/v1/purchasing/payments', ['supplier_id' => $supplier->id, 'amount' => '0', 'method' => 'cash', 'paid_on' => '2026-10-20'])->assertStatus(422);

        // 100 opening + 500 receipt − 100 return − 250.50 payment = 249.50
        $this->getJson("/api/v1/purchasing/supplier-balances?supplier_ids[]={$supplier->id}")->assertOk()->assertJsonPath("data.{$supplier->id}", '249.50');

        $statement = $this->getJson("/api/v1/purchasing/suppliers/{$supplier->id}/statement")->assertOk()->json('data');
        $this->assertSame('100.00', $statement['opening_balance']);
        // Chronological: receipt (05.10), payment (20.10), return (posted today).
        $this->assertSame(['goods_receipt', 'payment', 'purchase_return'], array_column($statement['entries'], 'type'));
        $this->assertSame(['600.00', '349.50', '249.50'], array_column($statement['entries'], 'balance'));
        $this->assertSame('249.50', $statement['closing_balance']);

        $later = $this->getJson("/api/v1/purchasing/suppliers/{$supplier->id}/statement?from=2026-10-10")->json('data');
        $this->assertSame('600.00', $later['opening_balance']);
        $this->assertSame(['payment', 'purchase_return'], array_column($later['entries'], 'type'));
    }

    public function test_role_permissions(): void
    {
        ['org' => $org, 'branch' => $branch, 'variant' => $variant, 'store' => $store, 'supplier' => $supplier] = $this->world();
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]);
        $inventory = $this->createUserWithRole($org, SystemRole::InventoryManager, [$branch->id]);
        $accountant = $this->createUserWithRole($org, SystemRole::Accountant, [$branch->id]);
        $receipt = ['supplier_id' => $supplier->id, 'store_id' => $store, 'invoice_date' => now()->toDateString(), 'lines' => [['variant_id' => $variant->id, 'quantity' => '1', 'unit_cost' => '1']]];
        $payment = ['supplier_id' => $supplier->id, 'amount' => '1', 'method' => 'cash', 'paid_on' => now()->toDateString()];

        $this->actingAsUser($cashier)->getJson('/api/v1/purchasing/receipts')->assertForbidden();
        $this->actingAsUser($inventory)->postJson('/api/v1/purchasing/receipts', $receipt)->assertCreated();
        $this->actingAsUser($accountant)->postJson('/api/v1/purchasing/receipts', $receipt)->assertForbidden();
        $this->actingAsUser($accountant)->postJson('/api/v1/purchasing/payments', $payment)->assertCreated();
        $this->actingAsUser($accountant)->getJson('/api/v1/purchasing/receipts')->assertOk()->assertJsonCount(1, 'data');
    }

    public function test_suppliers_stores_and_documents_are_isolated(): void
    {
        ['org' => $org, 'variant' => $variant, 'store' => $store, 'supplier' => $supplier] = $this->world();
        ['organization' => $other] = $this->provisionTenant('Other');
        $foreignSupplier = $this->supplier($other);
        $inactive = $this->supplier($org, ['is_active' => false]);
        $line = [['variant_id' => $variant->id, 'quantity' => '1', 'unit_cost' => '1']];

        $this->postJson('/api/v1/purchasing/receipts', ['supplier_id' => $foreignSupplier->id, 'store_id' => $store, 'invoice_date' => now()->toDateString(), 'lines' => $line])
            ->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['supplier_id']]]);
        $this->postJson('/api/v1/purchasing/receipts', ['supplier_id' => $inactive->id, 'store_id' => $store, 'invoice_date' => now()->toDateString(), 'lines' => $line])
            ->assertStatus(422)->assertJsonPath('error.details.supplier_id.0', 'The selected supplier is inactive.');
        $this->postJson('/api/v1/purchasing/receipts', ['supplier_id' => $supplier->id, 'store_id' => $store, 'invoice_date' => now()->addDay()->toDateString(), 'lines' => $line])
            ->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['invoice_date']]]);

        $id = $this->postJson('/api/v1/purchasing/receipts', ['supplier_id' => $supplier->id, 'store_id' => $store, 'invoice_date' => now()->toDateString(), 'lines' => $line])->json('data.id');
        $north = $this->createBranch($org, 'NORTH');
        $northClerk = $this->createUserWithRole($org, SystemRole::InventoryManager, [$north->id]);
        $this->actingAsUser($northClerk)->getJson("/api/v1/purchasing/receipts/{$id}")->assertNotFound();
        $this->actingAsUser($northClerk)->getJson('/api/v1/purchasing/receipts')->assertJsonCount(0, 'data');
        $this->actingAsUser($northClerk)->postJson("/api/v1/purchasing/receipts/{$id}/returns", ['reason' => 'x', 'lines' => [['goods_receipt_line_id' => $id, 'quantity' => '1']]])->assertNotFound();
    }
}
