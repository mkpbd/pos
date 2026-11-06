<?php

namespace App\Modules\Purchasing\Tests\Feature;

use App\Modules\Branches\Infrastructure\Models\Store;
use App\Modules\Inventory\Infrastructure\Models\StockLevel;
use App\Modules\Inventory\Infrastructure\Models\StockMovement;
use App\Modules\Organizations\Infrastructure\Models\Organization;
use App\Modules\Purchasing\Infrastructure\Models\LandedCostAllocation;
use App\Modules\Purchasing\Tests\Concerns\BuildsProcurement;
use App\Modules\Users\Domain\Roles\SystemRole;
use App\Modules\Users\Infrastructure\Models\Role;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use LogicException;
use Tests\TestCase;

/**
 * SC3: landed cost charges on goods receipts and landed cost vouchers posted afterwards.
 */
class LandedCostTest extends TestCase
{
    use BuildsProcurement, RefreshDatabase;

    /**
     * @param  list<array<string, mixed>>  $lines
     * @param  list<array<string, mixed>>  $charges
     * @return array<string, mixed>
     */
    private function receive(string $supplierId, string $store, array $lines, array $charges = [], int $status = 201): array
    {
        return $this->postJson('/api/v1/purchasing/receipts', [
            'supplier_id' => $supplierId, 'store_id' => $store, 'invoice_date' => now()->toDateString(),
            'lines' => array_map(fn (array $l) => $l + ['tax_rate' => '0'], $lines),
            'charges' => $charges,
        ])->assertStatus($status)->json('data') ?? [];
    }

    /**
     * @param  list<string>  $receiptIds
     * @param  list<array<string, mixed>>  $charges
     * @return array<string, mixed>
     */
    private function voucherBody(string $branchId, string $supplierId, array $receiptIds, array $charges, array $extra = []): array
    {
        return $extra + [
            'branch_id' => $branchId,
            'voucher_date' => now()->toDateString(),
            'charge_supplier_id' => $supplierId,
            'reference' => 'FWD-77',
            'charges' => $charges,
            'receipt_ids' => $receiptIds,
        ];
    }

    private function consume(string $store, string $variantId, string $quantity, ?string $batchId = null): void
    {
        $this->adjust($store, 'damage', array_filter(['variant_id' => $variantId, 'quantity' => '-'.$quantity, 'batch_id' => $batchId]));
    }

    private function postVoucher(string $voucherId, ?string $key = null): TestResponse
    {
        return $this->postJson("/api/v1/purchasing/landed-cost-vouchers/{$voucherId}/post", [], ['Idempotency-Key' => $key ?? (string) Str::uuid()]);
    }

    private function level(Organization $org, string $store, string $variantId, ?string $batchId = null): StockLevel
    {
        return $this->inTenant($org, fn () => StockLevel::query()->where('store_id', $store)->where('variant_id', $variantId)
            ->when($batchId, fn ($q) => $q->where('batch_id', $batchId), fn ($q) => $q->whereNull('batch_id'))->firstOrFail());
    }

    public function test_receipt_charges_are_allocated_exactly_into_the_landed_unit_cost_and_the_payables(): void
    {
        ['admin' => $admin, 'org' => $org, 'store' => $store, 'variant' => $juice] = $this->procurementWorld();
        $rice = $this->stockedVariant($org, 'Rice');
        $oil = $this->stockedVariant($org, 'Oil');
        $pran = $this->supplier($org, 'Pran');
        $forwarder = $this->supplier($org, 'Sea Freight Co');
        $inactive = $this->supplier($org, 'Gone', ['is_active' => false]);
        $this->actingAsUser($admin);
        $lines = [
            ['variant_id' => $juice->id, 'quantity' => '3', 'unit_cost' => '10'],
            ['variant_id' => $rice->id, 'quantity' => '3', 'unit_cost' => '20'],
            ['variant_id' => $oil->id, 'quantity' => '3', 'unit_cost' => '30'],
        ];
        $freight = ['type' => 'freight', 'description' => 'Sea freight', 'amount' => '100', 'tax_amount' => '15', 'allocation' => 'value', 'charge_supplier_id' => $forwarder->id];
        $handling = ['type' => 'handling', 'amount' => '1.00', 'allocation' => 'quantity'];

        $this->receive($pran->id, $store, $lines, [['type' => 'freight', 'amount' => '0', 'allocation' => 'value']], 422);
        $this->receive($pran->id, $store, $lines, [['type' => 'toll', 'amount' => '5', 'allocation' => 'weight']], 422);
        $this->postJson('/api/v1/purchasing/receipts', [
            'supplier_id' => $pran->id, 'store_id' => $store, 'invoice_date' => now()->toDateString(), 'lines' => $lines,
            'charges' => [['charge_supplier_id' => $inactive->id] + $freight],
        ])->assertStatus(422)->assertJsonPath('error.details', ['charges.0.charge_supplier_id' => ['The selected supplier is inactive.']]);

        $receipt = $this->receive($pran->id, $store, $lines, [$freight, $handling]);

        $this->assertSame('180.00', $receipt['subtotal']);
        $this->assertSame('180.00', $receipt['total']);
        $this->assertSame('101.00', $receipt['charges_total']);
        $this->assertSame('15.00', $receipt['charges_tax_total']);
        $this->assertSame('281.00', $receipt['landed_total']);
        // Goods + the handling billed on Pran's own invoice; the freight is the forwarder's.
        $this->assertSame('181.00', $receipt['payable_total']);
        $this->assertSame(['17.01', '33.66', '50.33'], array_column($receipt['lines'], 'landed_cost'));
        $this->assertSame(['15.6700', '31.2200', '46.7767'], array_column($receipt['lines'], 'landed_unit_cost'));
        $this->assertSame(['0.00', '0.00', '0.00'], array_column($receipt['lines'], 'voucher_landed_cost'));
        $this->assertSame(['freight', 'handling'], array_column($receipt['charges'], 'type'));
        $this->assertSame($forwarder->id, $receipt['charges'][0]['charge_supplier']['id']);
        $this->assertNull($receipt['charges'][1]['charge_supplier']);

        // Stock entered at the landed unit cost (weighted average and value).
        $this->assertSame('47.01', $this->stockRow($juice->id, $store)['value']);
        $this->assertSame('140.33', $this->stockRow($oil->id, $store)['value']);
        $this->assertSame('15.6700', $this->level($org, $store, $juice->id)->average_cost);
        $movement = collect($this->getJson("/api/v1/inventory/movements?variant_id={$juice->id}")->json('data'))->first();
        $this->assertSame('15.6700', $movement['unit_cost']);

        // Payables: Pran's invoice incl. its handling; the forwarder's freight with tax.
        $this->getJson('/api/v1/purchasing/supplier-balances?'.http_build_query(['supplier_ids' => [$pran->id, $forwarder->id]]))
            ->assertJsonPath("data.{$pran->id}", '181.00')
            ->assertJsonPath("data.{$forwarder->id}", '115.00');
        $statement = $this->getJson("/api/v1/purchasing/suppliers/{$forwarder->id}/statement")->assertOk();
        $statement->assertJsonPath('data.entries.0.type', 'receipt_charge')
            ->assertJsonPath('data.entries.0.id', $receipt['id'])
            ->assertJsonPath('data.entries.0.number', $receipt['number'])
            ->assertJsonPath('data.entries.0.reference', "Charge on {$receipt['number']}: Freight — Sea freight")
            ->assertJsonPath('data.entries.0.amount', '115.00')
            ->assertJsonPath('data.closing_balance', '115.00');
        $this->postJson('/api/v1/purchasing/payments', ['supplier_id' => $forwarder->id, 'amount' => '115', 'method' => 'bank_transfer', 'paid_on' => now()->toDateString()])->assertCreated();
        $this->getJson("/api/v1/purchasing/suppliers/{$forwarder->id}/statement")->assertJsonPath('data.closing_balance', '0.00');

        // A return still credits the goods at the supplier's price.
        $return = $this->postJson("/api/v1/purchasing/receipts/{$receipt['id']}/returns", ['reason' => 'Damaged', 'lines' => [['goods_receipt_line_id' => $receipt['lines'][0]['id'], 'quantity' => '1']]])
            ->assertCreated();
        $this->assertSame('10.00', $return->json('data.total'));
        $this->getJson("/api/v1/purchasing/supplier-balances?supplier_ids[]={$pran->id}")->assertJsonPath("data.{$pran->id}", '171.00');
    }

    public function test_a_voucher_splits_stock_on_hand_from_stock_sold_and_posts_once(): void
    {
        ['admin' => $admin, 'org' => $org, 'branch' => $branch, 'store' => $store, 'variant' => $juice] = $this->procurementWorld();
        $pran = $this->supplier($org, 'Pran');
        $forwarder = $this->supplier($org, 'Sea Freight Co');
        $this->actingAsUser($admin);
        $receipt = $this->receive($pran->id, $store, [['variant_id' => $juice->id, 'quantity' => '10', 'unit_cost' => '10']]);
        $this->consume($store, $juice->id, '4');
        $body = $this->voucherBody($branch->id, $forwarder->id, [$receipt['id']], [['type' => 'freight', 'description' => 'Late freight bill', 'amount' => '50', 'tax_amount' => '5', 'allocation' => 'value']]);

        $preview = $this->postJson('/api/v1/purchasing/landed-cost-vouchers/preview', $body)->assertOk();
        $preview->assertJsonPath('data.total', '55.00')
            ->assertJsonPath('data.on_hand_total', '30.00')
            ->assertJsonPath('data.consumed_total', '20.00')
            ->assertJsonPath('data.allocations.0.goods_receipt_number', $receipt['number'])
            ->assertJsonPath('data.allocations.0.on_hand_quantity', '6.000')
            ->assertJsonPath('data.allocations.0.consumed_quantity', '4.000')
            ->assertJsonPath('data.allocations.0.amount', '50.00')
            ->assertJsonPath('data.allocations.0.on_hand_amount', '30.00')
            ->assertJsonPath('data.allocations.0.consumed_amount', '20.00')
            ->assertJsonPath('data.allocations.0.average_cost_before', '10.0000')
            ->assertJsonPath('data.allocations.0.average_cost_after', '15.0000')
            ->assertJsonPath('data.allocations.0.new_landed_unit_cost', '15.0000');

        $voucher = $this->postJson('/api/v1/purchasing/landed-cost-vouchers', $body)->assertCreated()
            ->assertJsonPath('data.number', 'LCV-000001')
            ->assertJsonPath('data.status', 'draft')
            ->assertJsonPath('data.allocation_source', 'preview')
            ->assertJsonPath('data.receipt_numbers', [$receipt['number']])
            ->json('data');
        // Nothing moves until it is posted.
        $this->assertSame('60.00', $this->stockRow($juice->id, $store)['value']);
        $valuationBefore = $this->getJson('/api/v1/inventory/valuation')->json('data.total');

        $key = (string) Str::uuid();
        $posted = $this->postVoucher($voucher['id'], $key)->assertOk()
            ->assertJsonPath('data.status', 'posted')
            ->assertJsonPath('data.allocation_source', 'posted')
            ->assertJsonPath('data.on_hand_total', '30.00')
            ->assertJsonPath('data.consumed_total', '20.00')
            ->assertJsonPath('data.expense.number', 'EXP-000001')
            ->assertJsonPath('data.allocations.0.average_cost_after', '15.0000')
            ->json('data');
        $this->assertNotNull($posted['allocations'][0]['stock_movement_id']);
        $this->postVoucher($voucher['id'], $key)->assertOk()->assertHeader('Idempotent-Replayed', 'true');
        $this->postVoucher($voucher['id'])->assertStatus(422)->assertJsonPath('error.code', 'INVALID_STATUS_CHANGE');

        // Quantity unchanged, value +30 (the on-hand share), average 15.
        $row = $this->stockRow($juice->id, $store);
        $this->assertSame('6.000', $row['quantity']);
        $this->assertSame('90.00', $row['value']);
        $this->assertSame(bcadd($valuationBefore, '30.00', 2), $this->getJson('/api/v1/inventory/valuation')->json('data.total'));
        $movements = $this->getJson("/api/v1/inventory/movements?type=landed_cost&variant_id={$juice->id}")->assertOk()->json('data');
        $this->assertCount(1, $movements);
        $this->assertSame('0.000', $movements[0]['quantity']);
        $this->assertSame('30.00', $movements[0]['value']);
        $this->assertSame('5.0000', $movements[0]['unit_cost']);
        $this->assertSame('6.000', $movements[0]['balance_after']);
        $this->assertSame(['type' => 'landed_cost_voucher', 'id' => $voucher['id'], 'number' => 'LCV-000001'], $movements[0]['reference']);
        $this->assertSame(1, $this->inTenant($org, fn () => LandedCostAllocation::query()->count()));

        // The consumed share is an expense on the forwarder's account: no money moved.
        $expense = $this->getJson('/api/v1/expenses?type=expense')->assertOk()->json('data.0');
        $this->assertSame('Landed cost on sold stock', $expense['category']['name']);
        $this->assertSame('20.00', $expense['amount']);
        $this->assertTrue($expense['on_account']);
        $this->assertSame('On supplier account', $expense['method_label']);
        $this->assertSame('LCV-000001', $expense['reference']);
        $this->assertSame(0, DB::table('payments')->where('source_type', 'expense')->count());
        $this->postJson("/api/v1/expenses/{$expense['id']}/void", ['reason' => 'mistake'])->assertStatus(422)->assertJsonPath('error.code', 'EXPENSE_ON_ACCOUNT');

        // The whole bill (with tax) is owed to the forwarder.
        $this->getJson("/api/v1/purchasing/suppliers/{$forwarder->id}/statement")
            ->assertJsonPath('data.entries.0.type', 'landed_cost_voucher')
            ->assertJsonPath('data.entries.0.number', 'LCV-000001')
            ->assertJsonPath('data.entries.0.reference', 'FWD-77')
            ->assertJsonPath('data.closing_balance', '55.00');
        $this->getJson("/api/v1/purchasing/receipts/{$receipt['id']}")
            ->assertJsonPath('data.lines.0.voucher_landed_cost', '50.00')
            ->assertJsonPath('data.landed_cost_vouchers.0.number', 'LCV-000001')
            ->assertJsonPath('data.landed_cost_vouchers.0.amount', '50.00');

        // Posted vouchers are final.
        $this->putJson("/api/v1/purchasing/landed-cost-vouchers/{$voucher['id']}", $body)->assertStatus(422)->assertJsonPath('error.code', 'LANDED_COST_VOUCHER_LOCKED');
        $this->deleteJson("/api/v1/purchasing/landed-cost-vouchers/{$voucher['id']}")->assertStatus(422)->assertJsonPath('error.code', 'LANDED_COST_VOUCHER_LOCKED');
        $this->postVoucher($voucher['id'], null)->assertStatus(422);
        $this->assertSame(1, $this->inTenant($org, fn () => StockMovement::query()->where('type', 'landed_cost')->count()));
        $this->expectException(LogicException::class);
        $this->inTenant($org, fn () => LandedCostAllocation::query()->firstOrFail()->update(['amount' => '1']));
    }

    public function test_stock_on_hand_is_attributed_to_the_newest_receipts_first(): void
    {
        ['admin' => $admin, 'org' => $org, 'branch' => $branch, 'store' => $store, 'variant' => $juice] = $this->procurementWorld();
        $water = $this->stockedVariant($org, 'Water');
        $pran = $this->supplier($org, 'Pran');
        $forwarder = $this->supplier($org, 'Sea Freight Co');
        $this->actingAsUser($admin);

        // GRN 1: 10 @ 10, all sold; GRN 2: 10 @ 12, all on hand.
        $first = $this->receive($pran->id, $store, [['variant_id' => $juice->id, 'quantity' => '10', 'unit_cost' => '10']]);
        $this->consume($store, $juice->id, '10');
        $this->travel(1)->minutes();
        $second = $this->receive($pran->id, $store, [['variant_id' => $juice->id, 'quantity' => '10', 'unit_cost' => '12']]);
        // GRN 3: 5 water @ 4, 2 returned to the supplier.
        $third = $this->receive($pran->id, $store, [['variant_id' => $water->id, 'quantity' => '5', 'unit_cost' => '4']]);
        $this->postJson("/api/v1/purchasing/receipts/{$third['id']}/returns", ['reason' => 'Leaking', 'lines' => [['goods_receipt_line_id' => $third['lines'][0]['id'], 'quantity' => '2']]])->assertCreated();

        $only = fn (array $receipts, array $charge) => $this->postJson('/api/v1/purchasing/landed-cost-vouchers/preview', $this->voucherBody($branch->id, $forwarder->id, $receipts, [$charge]))->assertOk();
        $only([$first['id']], ['type' => 'freight', 'amount' => '10', 'allocation' => 'value'])
            ->assertJsonPath('data.allocations.0.on_hand_quantity', '0.000')
            ->assertJsonPath('data.on_hand_total', '0.00')
            ->assertJsonPath('data.consumed_total', '10.00');
        $only([$third['id']], ['type' => 'duty', 'amount' => '5', 'allocation' => 'quantity'])
            ->assertJsonPath('data.allocations.0.returned_quantity', '2.000')
            ->assertJsonPath('data.allocations.0.on_hand_quantity', '3.000')
            ->assertJsonPath('data.on_hand_total', '3.00')
            ->assertJsonPath('data.consumed_total', '2.00');

        // Both juice receipts on one voucher: 22 by value 100 : 120.
        $voucher = $this->postJson('/api/v1/purchasing/landed-cost-vouchers', $this->voucherBody($branch->id, $forwarder->id, [$first['id'], $second['id']], [['type' => 'freight', 'amount' => '22', 'allocation' => 'value']]))
            ->assertCreated()->json('data');
        $this->assertSame(['10.00', '12.00'], array_column($voucher['allocations'], 'amount'));
        $this->assertSame(['0.00', '12.00'], array_column($voucher['allocations'], 'on_hand_amount'));
        $valuation = fn () => $this->getJson('/api/v1/inventory/valuation')->json('data.total');
        $before = $valuation();
        $this->assertSame('132.00', $before); // 10 × 12 + 3 × 4

        $this->postVoucher($voucher['id'])->assertOk()->assertJsonPath('data.on_hand_total', '12.00')->assertJsonPath('data.consumed_total', '10.00');
        $this->assertSame('144.00', $valuation());
        $this->assertSame('13.2000', $this->level($org, $store, $juice->id)->average_cost);
        $this->assertSame('10.000', $this->level($org, $store, $juice->id)->quantity);
    }

    public function test_batches_are_revalued_separately_and_lines_of_one_level_share_its_stock(): void
    {
        ['admin' => $admin, 'org' => $org, 'branch' => $branch, 'store' => $store, 'variant' => $juice] = $this->procurementWorld();
        $syrup = $this->stockedVariant($org, 'Cough Syrup', ['track_batches' => true]);
        $pran = $this->supplier($org, 'Pran');
        $forwarder = $this->supplier($org, 'Sea Freight Co');
        $this->actingAsUser($admin);
        $expiry = now()->addYear()->toDateString();
        $b1 = $this->receive($pran->id, $store, [['variant_id' => $syrup->id, 'quantity' => '5', 'unit_cost' => '2', 'batch_number' => 'B1', 'expires_on' => $expiry]]);
        $b2 = $this->receive($pran->id, $store, [['variant_id' => $syrup->id, 'quantity' => '5', 'unit_cost' => '2', 'batch_number' => 'B2', 'expires_on' => $expiry]]);
        $b1Batch = $b1['lines'][0]['batch']['id'];
        $b2Batch = $b2['lines'][0]['batch']['id'];
        $this->consume($store, $syrup->id, '3', $b1Batch);
        // Two lines of the same product on one receipt: the stock left belongs to the last line first.
        $split = $this->receive($pran->id, $store, [
            ['variant_id' => $juice->id, 'quantity' => '5', 'unit_cost' => '10'],
            ['variant_id' => $juice->id, 'quantity' => '5', 'unit_cost' => '10'],
        ]);
        $this->consume($store, $juice->id, '7');

        $voucher = $this->postJson('/api/v1/purchasing/landed-cost-vouchers', $this->voucherBody($branch->id, $forwarder->id, [$b1['id'], $b2['id'], $split['id']], [
            ['type' => 'insurance', 'amount' => '40', 'allocation' => 'quantity'],
        ]))->assertCreated()->json('data');
        $rows = collect($voucher['allocations']);
        $this->assertSame(['10.00', '10.00', '10.00', '10.00'], $rows->pluck('amount')->all());
        $this->assertSame(['2.000', '5.000', '0.000', '3.000'], $rows->pluck('on_hand_quantity')->all());
        $this->assertSame(['4.00', '10.00', '0.00', '6.00'], $rows->pluck('on_hand_amount')->all());
        $this->assertSame('B1', $rows[0]['batch']['batch_number']);

        $this->postVoucher($voucher['id'])->assertOk()->assertJsonPath('data.on_hand_total', '20.00')->assertJsonPath('data.consumed_total', '20.00');
        // B1: (2 × 2 + 4) / 2 = 4; B2: (5 × 2 + 10) / 5 = 4; juice: (3 × 10 + 6) / 3 = 12.
        $this->assertSame('4.0000', $this->level($org, $store, $syrup->id, $b1Batch)->average_cost);
        $this->assertSame('4.0000', $this->level($org, $store, $syrup->id, $b2Batch)->average_cost);
        $this->assertSame('2.000', $this->level($org, $store, $syrup->id, $b1Batch)->quantity);
        $this->assertSame('12.0000', $this->level($org, $store, $juice->id)->average_cost);
        $this->assertSame(3, $this->inTenant($org, fn () => StockMovement::query()->where('type', 'landed_cost')->count()));
    }

    public function test_drafts_validate_edit_and_delete(): void
    {
        ['admin' => $admin, 'org' => $org, 'branch' => $branch, 'store' => $store, 'variant' => $juice] = $this->procurementWorld();
        $pran = $this->supplier($org, 'Pran');
        $forwarder = $this->supplier($org, 'Sea Freight Co');
        $north = $this->createBranch($org, 'NORTH');
        $northStore = $this->inTenant($org, fn () => Store::query()->where('branch_id', $north->id)->firstOrFail()->id);
        $this->actingAsUser($admin);
        $here = $this->receive($pran->id, $store, [['variant_id' => $juice->id, 'quantity' => '2', 'unit_cost' => '10']]);
        $there = $this->receive($pran->id, $northStore, [['variant_id' => $juice->id, 'quantity' => '2', 'unit_cost' => '10']]);
        $charge = ['type' => 'freight', 'amount' => '8', 'allocation' => 'value'];
        $url = '/api/v1/purchasing/landed-cost-vouchers';
        // The editor picks receipts of the voucher's branch.
        $this->getJson("/api/v1/purchasing/receipts?branch_id={$north->id}")->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $there['id']);

        $this->postJson($url, $this->voucherBody($branch->id, $forwarder->id, [$here['id'], $there['id']], [$charge]))->assertStatus(422)
            ->assertJsonPath('error.details', ['receipt_ids.1' => ["Choose a goods receipt of the voucher's branch."]]);
        $this->postJson($url, $this->voucherBody($branch->id, $forwarder->id, [$here['id']], [$charge], ['voucher_date' => now()->addDays(3)->toDateString()]))->assertStatus(422)
            ->assertJsonStructure(['error' => ['details' => ['voucher_date']]]);
        $this->postJson($url, $this->voucherBody($branch->id, $forwarder->id, [$here['id'], $here['id']], [$charge]))->assertStatus(422);
        $this->postJson($url, $this->voucherBody($branch->id, $forwarder->id, [$here['id']], []))->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['charges']]]);
        $this->postJson($url, array_diff_key($this->voucherBody($branch->id, $forwarder->id, [$here['id']], [$charge]), ['charge_supplier_id' => true]))->assertStatus(422)
            ->assertJsonStructure(['error' => ['details' => ['charge_supplier_id']]]);

        $draft = $this->postJson($url, $this->voucherBody($branch->id, $forwarder->id, [$here['id']], [$charge]))->assertCreated()->json('data');
        $this->putJson("{$url}/{$draft['id']}", $this->voucherBody($branch->id, $forwarder->id, [$here['id']], [$charge, ['type' => 'duty', 'amount' => '2', 'tax_amount' => '0.30', 'allocation' => 'quantity']]))
            ->assertOk()
            ->assertJsonPath('data.number', 'LCV-000001')
            ->assertJsonPath('data.charges_total', '10.00')
            ->assertJsonPath('data.tax_total', '0.30')
            ->assertJsonPath('data.total', '10.30')
            ->assertJsonCount(2, 'data.charges');
        $this->getJson("{$url}?status=draft")->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.receipt_count', 1);
        $this->getJson("{$url}?status=posted")->assertJsonCount(0, 'data');
        $this->getJson("{$url}?goods_receipt_id={$here['id']}")->assertJsonCount(1, 'data');
        // Drafts owe nothing.
        $this->getJson("/api/v1/purchasing/supplier-balances?supplier_ids[]={$forwarder->id}")->assertJsonPath("data.{$forwarder->id}", '0.00');

        $this->deleteJson("{$url}/{$draft['id']}")->assertNoContent();
        $this->getJson("{$url}/{$draft['id']}")->assertNotFound();
    }

    public function test_vouchers_are_isolated_by_organization_and_branch_and_need_the_permission(): void
    {
        ['admin' => $admin, 'org' => $org, 'branch' => $branch, 'store' => $store, 'variant' => $juice] = $this->procurementWorld();
        $pran = $this->supplier($org, 'Pran');
        $this->actingAsUser($admin);
        $receipt = $this->receive($pran->id, $store, [['variant_id' => $juice->id, 'quantity' => '2', 'unit_cost' => '10']]);
        $body = $this->voucherBody($branch->id, $pran->id, [$receipt['id']], [['type' => 'freight', 'amount' => '8', 'allocation' => 'value']]);
        $voucher = $this->postJson('/api/v1/purchasing/landed-cost-vouchers', $body)->assertCreated()->json('data');

        ['admin' => $otherAdmin, 'organization' => $other, 'branch' => $otherBranch] = $this->provisionTenant('Other Co');
        $otherSupplier = $this->supplier($other, 'Elsewhere');
        $this->actingAsUser($otherAdmin);
        $this->getJson("/api/v1/purchasing/landed-cost-vouchers/{$voucher['id']}")->assertNotFound();
        $this->postVoucher($voucher['id'])->assertNotFound();
        $this->getJson('/api/v1/purchasing/landed-cost-vouchers')->assertJsonCount(0, 'data');
        $this->postJson('/api/v1/purchasing/landed-cost-vouchers', $this->voucherBody($otherBranch->id, $otherSupplier->id, [$receipt['id']], $body['charges']))
            ->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['receipt_ids.0']]]);
        $this->postJson('/api/v1/purchasing/landed-cost-vouchers', $this->voucherBody($otherBranch->id, $pran->id, [], $body['charges']))->assertStatus(422);

        $north = $this->createBranch($org, 'NORTH');
        $northClerk = $this->createUserWithRole($org, SystemRole::InventoryManager, [$north->id]);
        $this->actingAsUser($northClerk);
        $this->getJson("/api/v1/purchasing/landed-cost-vouchers/{$voucher['id']}")->assertNotFound();
        $this->getJson('/api/v1/purchasing/landed-cost-vouchers')->assertJsonCount(0, 'data');
        $this->postVoucher($voucher['id'])->assertNotFound();
        $this->postJson('/api/v1/purchasing/landed-cost-vouchers', $body)->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['branch_id']]]);

        $cashier = $this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]);
        $this->actingAsUser($cashier);
        $this->getJson('/api/v1/purchasing/landed-cost-vouchers')->assertForbidden();
        $this->postJson('/api/v1/purchasing/landed-cost-vouchers/preview', $body)->assertForbidden();

        $viewer = $this->inTenant($org, function () {
            $role = Role::query()->create(['name' => 'Purchasing viewer']);
            $role->permissions()->sync(['purchases.view']);

            return $role;
        });
        $this->actingAsUser($this->createUserWithRole($org, $viewer, [$branch->id]));
        $this->getJson("/api/v1/purchasing/landed-cost-vouchers/{$voucher['id']}")->assertOk();
        $this->postVoucher($voucher['id'])->assertForbidden();
        $this->deleteJson("/api/v1/purchasing/landed-cost-vouchers/{$voucher['id']}")->assertForbidden();

        foreach ([SystemRole::InventoryManager, SystemRole::Accountant, SystemRole::BranchManager] as $role) {
            $this->assertTrue($this->createUserWithRole($org, $role, [$branch->id])->hasPermission('purchases.landed_cost'), $role->value);
        }
    }
}
