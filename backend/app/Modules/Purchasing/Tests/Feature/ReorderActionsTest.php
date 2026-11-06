<?php

namespace App\Modules\Purchasing\Tests\Feature;

use App\Modules\Branches\Infrastructure\Models\Store;
use App\Modules\Purchasing\Tests\Concerns\BuildsSupplyChain;
use App\Modules\Sales\Tests\Concerns\InteractsWithSales;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * SC1: draft purchase orders (one per supplier) and replenishment transfers created from
 * reorder suggestions — idempotent, validated, permission- and tenant-checked.
 */
class ReorderActionsTest extends TestCase
{
    use BuildsSupplyChain, InteractsWithSales, InteractsWithTenancy, RefreshDatabase;

    private const PO_URL = '/api/v1/purchasing/reorder-suggestions/purchase-orders';

    private const TRANSFER_URL = '/api/v1/purchasing/reorder-suggestions/transfers';

    public function test_one_draft_purchase_order_per_supplier(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $juice = $this->stockedVariant($org, 'Mango Juice');
        $water = $this->stockedVariant($org, 'Water');
        $rice = $this->stockedVariant($org, 'Miniket Rice', decimalUnit: true);
        $pran = $this->supplier($org, 'Pran');
        $mills = $this->supplier($org, 'Local Mills');
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $this->catalogRow($pran->id, $juice->id, ['lead_time_days' => 2]);
        $this->catalogRow($pran->id, $water->id, ['lead_time_days' => 5]);
        // 02:30 on 7 November in Dhaka is still 6 November in UTC: dates follow the organization.
        $this->travelTo(CarbonImmutable::parse('2026-11-06 20:30:00', 'UTC'));

        $payload = ['store_id' => $store, 'lines' => [
            ['variant_id' => $juice->id, 'supplier_id' => $pran->id, 'quantity' => '48', 'unit_cost' => '18'],
            ['variant_id' => $rice->id, 'supplier_id' => $mills->id, 'quantity' => '25.5', 'unit_cost' => '61'],
            ['variant_id' => $water->id, 'supplier_id' => $pran->id, 'quantity' => '24', 'unit_cost' => '10.5'],
        ]];
        $key = (string) Str::uuid();
        $created = $this->postJson(self::PO_URL, $payload, ['Idempotency-Key' => $key])->assertCreated()->json('data.purchase_orders');

        $this->assertCount(2, $created);
        $this->assertSame('Pran', $created[0]['supplier']['name']);
        $this->assertSame(2, $created[0]['line_count']);
        $this->assertSame('draft', $created[0]['status']);
        $this->assertSame('1116.00', $created[0]['total']); // 48 × 18 + 24 × 10.5, no tax rate on the products
        $this->assertSame('2026-11-12', $created[0]['expected_date']); // 7 Nov + longest lead (5)
        $this->assertSame('Local Mills', $created[1]['supplier']['name']);
        $this->assertSame('2026-11-14', $created[1]['expected_date']); // no catalog row → 7 days
        $this->assertSame('1555.50', $created[1]['total']);

        $order = $this->getJson("/api/v1/purchasing/orders/{$created[0]['id']}")->assertOk()
            ->assertJsonPath('data.number', $created[0]['number'])
            ->assertJsonPath('data.order_date', '2026-11-07')
            ->assertJsonPath('data.store.id', $store)
            ->json('data');
        $this->assertSame(['48.000', '24.000'], array_column($order['lines'], 'quantity'));

        // A retry with the same key replays the response; nothing new is created.
        $this->postJson(self::PO_URL, $payload, ['Idempotency-Key' => $key])->assertCreated()->assertHeader('Idempotent-Replayed', 'true')
            ->assertJsonPath('data.purchase_orders.0.id', $created[0]['id']);
        $this->assertSame(2, $this->getJson('/api/v1/purchasing/orders')->json('meta.pagination.total'));
        $this->postJson(self::PO_URL, $payload)->assertStatus(428)->assertJsonPath('error.code', 'IDEMPOTENCY_KEY_REQUIRED');

        // Drafts show on the suggestions as draft_on_order (not as on order).
        $this->putJson('/api/v1/inventory/reorder-rules', ['store_id' => $store, 'rules' => [['variant_id' => $juice->id, 'min_qty' => '10']]])->assertOk();
        $row = collect($this->getJson("/api/v1/purchasing/reorder-suggestions?store_id={$store}")->json('data'))->firstWhere('variant.id', $juice->id);
        $this->assertSame('48.000', $row['draft_on_order']);
        $this->assertSame('0.000', $row['on_order']);
    }

    public function test_purchase_order_validation_rolls_everything_back(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant('Acme');
        ['organization' => $rivalOrg] = $this->provisionTenant('Rival');
        $juice = $this->stockedVariant($org, 'Mango Juice');
        $rice = $this->stockedVariant($org, 'Miniket Rice', decimalUnit: true);
        $rivalJuice = $this->stockedVariant($rivalOrg, 'Rival Juice');
        $pran = $this->supplier($org, 'Pran');
        $dormant = $this->supplier($org, 'Dormant', ['is_active' => false]);
        $rivalSupplier = $this->supplier($rivalOrg, 'Rival');
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $post = fn (array $lines, ?string $storeId = null) => $this->postJson(self::PO_URL, ['store_id' => $storeId ?? $store, 'lines' => $lines], ['Idempotency-Key' => (string) Str::uuid()]);
        $line = fn (array $over = []) => $over + ['variant_id' => $juice->id, 'supplier_id' => $pran->id, 'quantity' => '24', 'unit_cost' => '18'];

        $post([$line(), $line(['variant_id' => $rice->id, 'supplier_id' => $dormant->id])])->assertStatus(422)
            ->assertJsonPath('error.details', ['lines.1.supplier_id' => ['Dormant is inactive.']]);
        $post([$line(['supplier_id' => $rivalSupplier->id])])->assertStatus(422)->assertJsonPath('error.details', ['lines.0.supplier_id' => ['The selected supplier does not exist.']]);
        $this->assertSame(['This product does not exist.'], $post([$line(['variant_id' => $rivalJuice->id])])->assertStatus(422)->json('error.details')['lines.0.variant_id']);
        $this->assertArrayHasKey('lines.0.quantity', $post([$line(['quantity' => '0'])])->assertStatus(422)->json('error.details'));
        $this->assertArrayHasKey('lines.0.quantity', $post([$line(['quantity' => '1.5'])])->assertStatus(422)->json('error.details')); // whole units
        $this->assertArrayHasKey('lines.1.variant_id', $post([$line(), $line(['supplier_id' => $dormant->id])])->assertStatus(422)->json('error.details')); // distinct
        $post([$line()], $this->mainStoreId($rivalOrg))->assertStatus(422)->assertJsonPath('error.details.store_id.0', 'The selected store does not exist.');

        $this->assertSame(0, $this->getJson('/api/v1/purchasing/orders')->json('meta.pagination.total'));
    }

    public function test_replenishment_transfer_from_the_source_store(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $juice = $this->stockedVariant($org, 'Mango Juice');
        $syrup = $this->sellable($org, 'Syrup', '100', ['batches' => true]);
        $store = $this->mainStoreId($org);
        $wh = $this->createBranch($org, 'WH');
        $warehouse = $this->inTenant($org, fn () => Store::query()->where('branch_id', $wh->id)->firstOrFail()->id);
        $this->actingAsUser($admin);
        $this->stockUp($warehouse, $juice, '30', '18.00');
        $this->stockUp($warehouse, $syrup, '4', '50.00', 'LATE', now()->addMonths(6)->toDateString());
        $this->stockUp($warehouse, $syrup, '3', '40.00', 'SOON', now()->addMonth()->toDateString());
        $payload = ['store_id' => $store, 'lines' => [['variant_id' => $juice->id, 'quantity' => '12'], ['variant_id' => $syrup->id, 'quantity' => '5']]];

        $this->postJson(self::TRANSFER_URL, $payload, ['Idempotency-Key' => (string) Str::uuid()])->assertStatus(422)->assertJsonPath('error.code', 'NO_SOURCE_STORE');
        $this->patchJson('/api/v1/inventory/replenishment-settings', ['source_store_id' => $warehouse])->assertOk();
        $this->postJson(self::TRANSFER_URL, ['store_id' => $warehouse] + $payload, ['Idempotency-Key' => (string) Str::uuid()])->assertStatus(422)->assertJsonPath('error.code', 'SOURCE_IS_DESTINATION');

        $key = (string) Str::uuid();
        $created = $this->postJson(self::TRANSFER_URL, $payload, ['Idempotency-Key' => $key])->assertCreated()->json('data.transfers');
        $this->assertCount(1, $created);
        $this->assertSame('in_transit', $created[0]['status']);
        $this->assertSame($warehouse, $created[0]['from_store']['id']);
        $this->assertSame($store, $created[0]['to_store']['id']);
        $this->assertSame(3, $created[0]['lines_count']); // juice + syrup from two batches
        $this->postJson(self::TRANSFER_URL, $payload, ['Idempotency-Key' => $key])->assertCreated()->assertHeader('Idempotent-Replayed', 'true');
        $this->assertSame(1, $this->getJson('/api/v1/inventory/transfers')->json('meta.pagination.total'));

        // Batches are taken first-expiry-first-out and arrive as the same batches.
        $transfer = $this->getJson("/api/v1/inventory/transfers/{$created[0]['id']}")->assertOk()->json('data');
        $syrupLines = collect($transfer['lines'])->where('variant.id', $syrup->id)->mapWithKeys(fn ($l) => [$l['batch']['batch_number'] => $l['quantity']])->all();
        $this->assertSame(['SOON' => '3.000', 'LATE' => '2.000'], $syrupLines);

        // In transit counts towards the store's availability until received.
        $this->putJson('/api/v1/inventory/reorder-rules', ['store_id' => $store, 'rules' => [['variant_id' => $juice->id, 'min_qty' => '10', 'max_qty' => '20']]])->assertOk();
        $row = collect($this->getJson("/api/v1/purchasing/reorder-suggestions?store_id={$store}")->json('data'))->firstWhere('variant.id', $juice->id);
        $this->assertNull($row); // 12 in transit > 10
        $this->postJson("/api/v1/inventory/transfers/{$created[0]['id']}/receive")->assertOk();
        $this->assertSame('12.000', $this->stockRow($juice->id, $store)['quantity']);

        // Not enough at the source: the ledger refuses, nothing is dispatched.
        $this->postJson(self::TRANSFER_URL, ['store_id' => $store, 'lines' => [['variant_id' => $juice->id, 'quantity' => '50']]], ['Idempotency-Key' => (string) Str::uuid()])
            ->assertStatus(422)->assertJsonPath('error.code', 'INSUFFICIENT_STOCK');
        $this->postJson(self::TRANSFER_URL, ['store_id' => $store, 'lines' => [['variant_id' => $juice->id, 'quantity' => '0']]], ['Idempotency-Key' => (string) Str::uuid()])->assertStatus(422);
    }

    public function test_permissions_and_branch_access(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $main] = $this->provisionTenant();
        $juice = $this->stockedVariant($org, 'Mango Juice');
        $pran = $this->supplier($org, 'Pran');
        $store = $this->mainStoreId($org);
        $wh = $this->createBranch($org, 'WH');
        $warehouse = $this->inTenant($org, fn () => Store::query()->where('branch_id', $wh->id)->firstOrFail()->id);
        $accountant = $this->createUserWithRole($org, SystemRole::Accountant, [$main->id]);
        $mainBuyer = $this->createUserWithRole($org, SystemRole::InventoryManager, [$main->id]);
        $this->actingAsUser($admin);
        $this->stockUp($warehouse, $juice, '30');
        $this->patchJson('/api/v1/inventory/replenishment-settings', ['source_store_id' => $warehouse])->assertOk();
        $po = ['store_id' => $store, 'lines' => [['variant_id' => $juice->id, 'supplier_id' => $pran->id, 'quantity' => '1', 'unit_cost' => '1']]];
        $transfer = ['store_id' => $store, 'lines' => [['variant_id' => $juice->id, 'quantity' => '1']]];

        $this->actingAsUser($accountant);
        $this->postJson(self::PO_URL, $po, ['Idempotency-Key' => (string) Str::uuid()])->assertForbidden();
        $this->postJson(self::TRANSFER_URL, $transfer, ['Idempotency-Key' => (string) Str::uuid()])->assertForbidden();

        // A buyer of the main branch may order, but cannot dispatch from the warehouse branch.
        $this->actingAsUser($mainBuyer);
        $this->postJson(self::PO_URL, $po, ['Idempotency-Key' => (string) Str::uuid()])->assertCreated();
        $this->postJson(self::TRANSFER_URL, $transfer, ['Idempotency-Key' => (string) Str::uuid()])->assertStatus(422)->assertJsonPath('error.code', 'SOURCE_STORE_NOT_ACCESSIBLE');
        $this->postJson(self::PO_URL, ['store_id' => $warehouse] + $po, ['Idempotency-Key' => (string) Str::uuid()])->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['store_id']]]);
    }
}
