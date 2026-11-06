<?php

namespace App\Modules\Purchasing\Tests\Feature;

use App\Modules\Purchasing\Tests\Concerns\BuildsProcurement;
use App\Modules\Shared\Tests\Concerns\ReadsExports;
use App\Modules\Users\Domain\Roles\SystemRole;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * SC3: supplier performance metrics on crafted history (organization timezone Asia/Dhaka).
 */
class SupplierPerformanceTest extends TestCase
{
    use BuildsProcurement, ReadsExports, RefreshDatabase;

    private const RANGE = 'date_from=2026-05-01&date_to=2026-06-15';

    /**
     * @return array<string, mixed>
     */
    private function placedOrder(string $supplierId, string $store, string $variantId, string $orderDate, string $expected, string $quantity, string $cost): array
    {
        $order = $this->postJson('/api/v1/purchasing/orders', [
            'supplier_id' => $supplierId, 'store_id' => $store, 'order_date' => $orderDate, 'expected_date' => $expected,
            'lines' => [['variant_id' => $variantId, 'quantity' => $quantity, 'unit_cost' => $cost, 'tax_rate' => '0']],
        ])->assertCreated()->json('data');
        $this->postJson("/api/v1/purchasing/orders/{$order['id']}/place")->assertOk();

        return $order;
    }

    /**
     * @param  array<string, mixed>|null  $order
     * @param  list<array<string, mixed>>  $charges
     * @return array<string, mixed>
     */
    private function receipt(string $supplierId, string $store, string $variantId, string $date, string $quantity, string $cost, ?array $order = null, array $charges = []): array
    {
        return $this->postJson('/api/v1/purchasing/receipts', array_filter([
            'supplier_id' => $supplierId, 'store_id' => $store, 'invoice_date' => $date, 'purchase_order_id' => $order['id'] ?? null,
            'lines' => [array_filter(['variant_id' => $variantId, 'quantity' => $quantity, 'unit_cost' => $cost, 'tax_rate' => '0', 'purchase_order_line_id' => $order['lines'][0]['id'] ?? null])],
            'charges' => $charges,
        ]))->assertCreated()->json('data');
    }

    /**
     * Pran: 3 orders in May–June (one on time and complete, one late and short, one not due),
     * a cheaper receipt in April (previous period), 3 units returned, one RFQ answered and won.
     * Freight Co: billed the freight on Pran's second receipt; invited to the RFQ, never answered.
     *
     * @return array<string, mixed>
     */
    private function history(): array
    {
        $this->fakePdfRenderer();
        // 02:00 on 15 June in Dhaka is still 14 June in UTC.
        $this->travelTo(CarbonImmutable::parse('2026-06-14 20:00:00', 'UTC'));
        $world = $this->procurementWorld();
        ['admin' => $admin, 'org' => $org, 'store' => $store, 'variant' => $juice] = $world;
        $pran = $this->supplier($org, 'Pran');
        $freight = $this->supplier($org, 'Freight Co');
        $this->actingAsUser($admin);

        $this->receipt($pran->id, $store, $juice->id, '2026-04-10', '10', '8');
        $onTime = $this->placedOrder($pran->id, $store, $juice->id, '2026-05-01', '2026-05-05', '10', '10');
        $r1 = $this->receipt($pran->id, $store, $juice->id, '2026-05-04', '10', '10', $onTime);
        $late = $this->placedOrder($pran->id, $store, $juice->id, '2026-05-10', '2026-05-12', '10', '11');
        $this->receipt($pran->id, $store, $juice->id, '2026-05-15', '6', '11', $late, [
            ['type' => 'freight', 'amount' => '10', 'tax_amount' => '1.50', 'allocation' => 'value', 'charge_supplier_id' => $freight->id],
        ]);
        $this->placedOrder($pran->id, $store, $juice->id, '2026-06-01', '2026-06-30', '5', '11');
        $this->postJson("/api/v1/purchasing/receipts/{$r1['id']}/returns", ['reason' => 'Damaged', 'lines' => [['goods_receipt_line_id' => $r1['lines'][0]['id'], 'quantity' => '3']]])->assertCreated();

        $rfq = $this->postJson('/api/v1/purchasing/rfqs', [
            'store_id' => $store, 'title' => 'Juice', 'reply_by' => '2026-06-20', 'supplier_ids' => [$pran->id, $freight->id],
            'lines' => [['variant_id' => $juice->id, 'quantity' => '20']],
        ])->assertCreated()->json('data');
        $this->transition("rfqs/{$rfq['id']}/send")->assertOk();
        $this->transition("rfqs/{$rfq['id']}/quotes", ['supplier_id' => $pran->id, 'status' => 'received', 'lines' => [['rfq_line_id' => $rfq['lines'][0]['id'], 'unit_price' => '10.5']]])->assertOk();
        $this->transition("rfqs/{$rfq['id']}/award", ['lines' => [['rfq_line_id' => $rfq['lines'][0]['id'], 'supplier_id' => $pran->id, 'quantity' => '20']]])->assertCreated();

        return $world + compact('pran', 'freight', 'late');
    }

    public function test_metrics_and_score_per_supplier(): void
    {
        ['pran' => $pran, 'freight' => $freight] = $this->history();

        $response = $this->getJson('/api/v1/purchasing/supplier-performance?'.self::RANGE)->assertOk()
            ->assertJsonPath('meta.period', ['date_from' => '2026-05-01', 'date_to' => '2026-06-15', 'previous_from' => '2026-03-16', 'previous_to' => '2026-04-30'])
            ->assertJsonCount(2, 'data');
        [$first, $second] = $response->json('data');

        $this->assertSame($pran->id, $first['supplier']['id']);
        $this->assertSame(3, $first['orders']);
        $this->assertSame('166.00', $first['spend']);
        $this->assertSame('50.00', $first['on_time_rate']);
        $this->assertSame(2, $first['on_time_orders']);
        $this->assertSame('80.00', $first['fill_rate']);
        $this->assertSame('20.000', $first['ordered_quantity']);
        $this->assertSame('16.000', $first['received_quantity']);
        $this->assertSame('4.0', $first['avg_lead_days']);
        $this->assertSame('18.75', $first['return_rate']);
        // 166 / 16 = 10.375 against 8.00 in the previous period.
        $this->assertSame('29.69', $first['price_change_pct']);
        $this->assertSame(1, $first['quote_invitations']);
        $this->assertSame('100.00', $first['quote_response_rate']);
        $this->assertSame(1, $first['quotes_won']);
        $this->assertSame(1, $first['late_deliveries']);
        $this->assertSame(1, $first['short_deliveries']);
        // 35×50 + 30×80 + 15×6.25 + 10×0 + 10×100 = 5243.75 → 52.
        $this->assertSame('52', $first['score']);
        $this->assertSame(['on_time' => 35, 'fill' => 30, 'returns' => 15, 'price_stability' => 10, 'responsiveness' => 10], $first['score_weights']);

        // Freight Co: only the freight it billed and an unanswered invitation; the score re-weights to responsiveness.
        $this->assertSame($freight->id, $second['supplier']['id']);
        $this->assertSame(0, $second['orders']);
        $this->assertSame('11.50', $second['spend']);
        $this->assertNull($second['on_time_rate']);
        $this->assertNull($second['fill_rate']);
        $this->assertNull($second['return_rate']);
        $this->assertNull($second['price_change_pct']);
        $this->assertSame('0.00', $second['quote_response_rate']);
        $this->assertSame('0', $second['score']);
        $this->assertSame(['responsiveness' => 10], $second['score_weights']);

        $this->assertSame(['Freight Co', 'Pran'], array_column(array_column($this->getJson('/api/v1/purchasing/supplier-performance?'.self::RANGE.'&sort=name')->json('data'), 'supplier'), 'name'));
        $this->assertSame(['11.50', '166.00'], array_column($this->getJson('/api/v1/purchasing/supplier-performance?'.self::RANGE.'&sort=spend')->json('data'), 'spend'));
        $this->getJson('/api/v1/purchasing/supplier-performance?'.self::RANGE.'&sort=-avg_lead_days')->assertJsonPath('data.0.supplier.id', $pran->id)->assertJsonPath('data.1.avg_lead_days', null);
        $this->getJson('/api/v1/purchasing/supplier-performance?sort=colour')->assertStatus(422);
        $this->getJson('/api/v1/purchasing/supplier-performance?'.self::RANGE."&supplier_id={$freight->id}")->assertJsonCount(1, 'data');
    }

    public function test_dates_are_the_organizations(): void
    {
        ['pran' => $pran] = $this->history();

        // Today in Dhaka is 15 June (UTC is still on the 14th): the default range ends there.
        $this->getJson('/api/v1/purchasing/supplier-performance')->assertOk()
            ->assertJsonPath('meta.period.date_to', '2026-06-15')
            ->assertJsonPath('meta.period.date_from', '2026-03-18');
        // The RFQ went out at 02:00 on 15 June local time, so a range ending on the 14th misses it.
        $row = collect($this->getJson('/api/v1/purchasing/supplier-performance?date_from=2026-05-01&date_to=2026-06-14')->json('data'))->firstWhere('supplier.id', $pran->id);
        $this->assertSame(0, $row['quote_invitations']);
        $this->assertNull($row['quote_response_rate']);
        $this->getJson('/api/v1/purchasing/supplier-performance?date_from=2026-06-20&date_to=2026-06-14')->assertStatus(422);
        $this->getJson('/api/v1/purchasing/supplier-performance?date_from=2026-06-16')->assertStatus(422);
    }

    public function test_one_supplier_with_monthly_trend_and_problem_deliveries(): void
    {
        ['pran' => $pran, 'late' => $late] = $this->history();

        $data = $this->getJson("/api/v1/purchasing/suppliers/{$pran->id}/performance?".self::RANGE)->assertOk()
            ->assertJsonPath('data.supplier.id', $pran->id)
            ->assertJsonPath('data.metrics.score', '52')
            ->assertJsonPath('data.metrics.fill_rate', '80.00')
            ->json('data');

        $this->assertCount(12, $data['trend']);
        $trend = collect($data['trend'])->keyBy('month');
        $this->assertSame('2025-07', $data['trend'][0]['month']);
        $this->assertSame(['month' => '2026-05', 'orders' => 2, 'on_time_rate' => '50.00', 'fill_rate' => '80.00', 'spend' => '166.00'], $trend['2026-05']);
        $this->assertSame(['month' => '2026-04', 'orders' => 0, 'on_time_rate' => null, 'fill_rate' => null, 'spend' => '80.00'], $trend['2026-04']);
        $this->assertSame(1, $trend['2026-06']['orders']);
        $this->assertNull($trend['2026-06']['on_time_rate']);

        $this->assertCount(1, $data['problem_deliveries']);
        $problem = $data['problem_deliveries'][0];
        $this->assertSame(['id' => $late['id'], 'number' => $late['number']], $problem['purchase_order']);
        $this->assertSame('2026-05-12', $problem['expected_date']);
        $this->assertSame('2026-05-15', $problem['received_date']);
        $this->assertSame(3, $problem['days_late']);
        $this->assertSame('10.000', $problem['ordered_quantity']);
        $this->assertSame('6.000', $problem['received_quantity']);
        $this->assertSame('4.000', $problem['short_quantity']);
        $this->assertTrue($problem['is_late'] && $problem['is_short']);
    }

    public function test_branch_scope_isolation_permissions_and_export(): void
    {
        ['org' => $org, 'branch' => $branch, 'pran' => $pran] = $this->history();
        $north = $this->createBranch($org, 'NORTH');

        $this->getJson("/api/v1/purchasing/supplier-performance?branch_id={$north->id}")->assertOk()->assertJsonCount(0, 'data');
        $this->getJson("/api/v1/purchasing/supplier-performance?branch_id={$branch->id}&".self::RANGE)->assertJsonCount(2, 'data');
        $this->actingAsUser($this->createUserWithRole($org, SystemRole::InventoryManager, [$north->id]));
        $this->getJson('/api/v1/purchasing/supplier-performance?'.self::RANGE)->assertOk()->assertJsonCount(0, 'data');
        $this->getJson("/api/v1/purchasing/suppliers/{$pran->id}/performance")->assertOk()->assertJsonPath('data.metrics.orders', 0);

        $this->actingAsUser($this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]));
        $this->getJson('/api/v1/purchasing/supplier-performance')->assertForbidden();
        $this->getJson("/api/v1/purchasing/suppliers/{$pran->id}/performance")->assertForbidden();

        ['admin' => $otherAdmin] = $this->provisionTenant('Other Co');
        $this->actingAsUser($otherAdmin);
        $this->getJson('/api/v1/purchasing/supplier-performance?'.self::RANGE)->assertOk()->assertJsonCount(0, 'data');
        $this->getJson("/api/v1/purchasing/suppliers/{$pran->id}/performance")->assertNotFound();
    }
}
