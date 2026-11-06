<?php

namespace App\Modules\Purchasing\Tests\Unit;

use App\Modules\Purchasing\Domain\Reorder\ReorderCalculator;
use App\Modules\Purchasing\Domain\Reorder\ReorderInput;
use App\Modules\Purchasing\Domain\Reorder\ReorderReason;
use InvalidArgumentException;
use PHPUnit\Framework\TestCase;

class ReorderCalculatorTest extends TestCase
{
    /**
     * @param  array<string, mixed>  $overrides
     */
    private function input(array $overrides = []): ReorderInput
    {
        return new ReorderInput(...$overrides + [
            'onHand' => '0',
            'onOrder' => '0',
            'inTransit' => '0',
            'sold' => '0',
            'velocityDays' => 30,
            'minQty' => '0',
            'maxQty' => null,
            'leadTimeDays' => 7,
            'safetyDays' => 3,
            'coverageDays' => 14,
        ]);
    }

    public function test_below_minimum_without_sales_orders_up_to_the_maximum(): void
    {
        $s = ReorderCalculator::calculate($this->input(['onHand' => '4', 'minQty' => '10', 'maxQty' => '30']));

        $this->assertSame('0.000', $s->avgDaily);
        $this->assertSame('10.000', $s->reorderPoint);
        $this->assertSame('30.000', $s->target);
        $this->assertTrue($s->needsReorder);
        $this->assertSame('26.000', $s->suggestedPurchase);
        $this->assertSame('0.000', $s->suggestedTransfer);
        $this->assertSame(ReorderReason::BelowMin, $s->reason);
        $this->assertNull($s->daysOfCover);
    }

    public function test_zero_velocity_without_a_maximum_only_restores_the_minimum(): void
    {
        $s = ReorderCalculator::calculate($this->input(['onHand' => '4', 'minQty' => '10']));

        $this->assertSame('10.000', $s->target);
        $this->assertSame('6.000', $s->suggestedPurchase);
    }

    public function test_nothing_to_do_without_minimum_or_sales(): void
    {
        $s = ReorderCalculator::calculate($this->input());

        $this->assertTrue($s->needsReorder); // 0 available <= 0 reorder point …
        $this->assertFalse($s->hasSuggestion()); // … but nothing to bring in
        $this->assertSame('0.000', $s->suggestedPurchase);
    }

    public function test_velocity_lead_time_safety_and_coverage(): void
    {
        // 45 sold in 30 days = 1.5/day; lead 7 + safety 3 = 10 days → 15; coverage 14 days → 21.
        $s = ReorderCalculator::calculate($this->input(['onHand' => '12', 'sold' => '45', 'minQty' => '5']));

        $this->assertSame('1.500', $s->avgDaily);
        $this->assertSame('15.000', $s->reorderPoint);
        $this->assertSame('36.000', $s->target);
        $this->assertSame('24.000', $s->suggestedPurchase);
        $this->assertSame(ReorderReason::Velocity, $s->reason);
        $this->assertSame('8.0', $s->daysOfCover);
    }

    public function test_reorder_point_and_coverage_round_up(): void
    {
        // 10 sold in 30 days = 0.333/day; × 10 days = 3.33 → 4; × 14 days = 4.67 → 5.
        $s = ReorderCalculator::calculate($this->input(['onHand' => '2', 'sold' => '10']));

        $this->assertSame('0.333', $s->avgDaily);
        $this->assertSame('4.000', $s->reorderPoint);
        $this->assertSame('9.000', $s->target);
        $this->assertSame('7.000', $s->suggestedPurchase);
        $this->assertSame(ReorderReason::Velocity, $s->reason);
        $this->assertSame('6.0', $s->daysOfCover);
    }

    public function test_minimum_wins_over_a_lower_velocity_reorder_point(): void
    {
        $s = ReorderCalculator::calculate($this->input(['onHand' => '20', 'sold' => '30', 'minQty' => '25']));

        $this->assertSame('25.000', $s->reorderPoint); // 1/day × 10 = 10 < 25
        $this->assertSame('39.000', $s->target); // 25 + 14
        $this->assertSame('19.000', $s->suggestedPurchase);
        $this->assertSame(ReorderReason::BelowMin, $s->reason);
    }

    public function test_on_order_and_in_transit_count_as_available(): void
    {
        $base = ['onHand' => '3', 'minQty' => '10', 'maxQty' => '30'];

        $covered = ReorderCalculator::calculate($this->input($base + ['onOrder' => '5', 'inTransit' => '3']));
        $this->assertSame('11.000', $covered->available);
        $this->assertFalse($covered->needsReorder);
        $this->assertNull($covered->reason);
        $this->assertSame('0.000', $covered->suggestedPurchase);

        $partly = ReorderCalculator::calculate($this->input($base + ['onOrder' => '4', 'inTransit' => '2']));
        $this->assertSame('9.000', $partly->available);
        $this->assertSame('21.000', $partly->suggestedPurchase);
    }

    public function test_exactly_at_the_reorder_point_reorders(): void
    {
        $s = ReorderCalculator::calculate($this->input(['onHand' => '10', 'minQty' => '10', 'maxQty' => '12']));

        $this->assertTrue($s->needsReorder);
        $this->assertSame('2.000', $s->suggestedPurchase);
    }

    public function test_purchase_rounds_up_to_whole_packs(): void
    {
        $s = ReorderCalculator::calculate($this->input(['onHand' => '5', 'minQty' => '24', 'maxQty' => '60', 'packSize' => '24']));

        $this->assertSame('72.000', $s->suggestedPurchase); // need 55 → 3 packs of 24
    }

    public function test_minimum_order_quantity_then_packs(): void
    {
        $min = ReorderCalculator::calculate($this->input(['onHand' => '8', 'minQty' => '10', 'maxQty' => '12', 'minOrderQty' => '50']));
        $this->assertSame('50.000', $min->suggestedPurchase);

        $minAndPacks = ReorderCalculator::calculate($this->input(['onHand' => '8', 'minQty' => '10', 'maxQty' => '12', 'minOrderQty' => '50', 'packSize' => '24']));
        $this->assertSame('72.000', $minAndPacks->suggestedPurchase); // 50 → 3 packs

        $this->assertSame('48.000', ReorderCalculator::orderQuantity('30', '24', '40', true));
    }

    public function test_whole_units_and_decimal_units(): void
    {
        $whole = ReorderCalculator::calculate($this->input(['onHand' => '2.5', 'minQty' => '5', 'maxQty' => '10']));
        $this->assertSame('8.000', $whole->suggestedPurchase); // 7.5 → 8 pieces

        // Purchases are whole packs: the default pack of 1 kg rounds 7.5 kg up to 8 kg …
        $kg = ReorderCalculator::calculate($this->input(['onHand' => '2.5', 'minQty' => '5', 'maxQty' => '10', 'wholeUnits' => false]));
        $this->assertSame('8.000', $kg->suggestedPurchase);
        // … while a transfer of a decimal-unit product keeps its decimals.
        $moved = ReorderCalculator::calculate($this->input(['onHand' => '2.5', 'minQty' => '5', 'maxQty' => '10', 'wholeUnits' => false, 'sourceSurplus' => '20']));
        $this->assertSame('7.500', $moved->suggestedTransfer);

        $sacks = ReorderCalculator::calculate($this->input(['onHand' => '2.5', 'minQty' => '5', 'maxQty' => '10', 'wholeUnits' => false, 'packSize' => '2.5']));
        $this->assertSame('7.500', $sacks->suggestedPurchase); // exactly 3 sacks of 2.5 kg

        $this->assertSame('5.000', ReorderCalculator::orderQuantity('4.1', '2.5', null, false));
    }

    public function test_source_store_transfer_covers_the_need_first(): void
    {
        $s = ReorderCalculator::calculate($this->input(['onHand' => '2', 'minQty' => '10', 'maxQty' => '20', 'sourceSurplus' => '50', 'packSize' => '24']));

        $this->assertSame('18.000', $s->suggestedTransfer);
        $this->assertSame('0.000', $s->suggestedPurchase);
    }

    public function test_source_surplus_split_with_a_purchase_for_the_rest(): void
    {
        $s = ReorderCalculator::calculate($this->input(['onHand' => '2', 'minQty' => '10', 'maxQty' => '20', 'sourceSurplus' => '7.6', 'packSize' => '6']));

        $this->assertSame('7.000', $s->suggestedTransfer); // whole units, rounded down
        $this->assertSame('12.000', $s->suggestedPurchase); // 11 → 2 packs of 6
    }

    public function test_no_surplus_at_the_source_means_purchase_only(): void
    {
        $s = ReorderCalculator::calculate($this->input(['onHand' => '2', 'minQty' => '10', 'maxQty' => '20', 'sourceSurplus' => '0']));

        $this->assertSame('0.000', $s->suggestedTransfer);
        $this->assertSame('18.000', $s->suggestedPurchase);
    }

    public function test_surplus_of_a_source_store(): void
    {
        $this->assertSame('15.000', ReorderCalculator::surplus('40', '25', true));
        $this->assertSame('0.000', ReorderCalculator::surplus('20', '25', true));
        $this->assertSame('3.000', ReorderCalculator::surplus('3.9', '0', true));
        $this->assertSame('3.900', ReorderCalculator::surplus('3.9', '0', false));
        // Source reorder point: 60 sold / 30 days × (7 + 3) = 20, above its minimum of 5.
        $this->assertSame('20.000', ReorderCalculator::reorderPoint('60', 30, '5', 7, 3));
    }

    public function test_negative_stock_is_brought_back_and_cover_never_negative(): void
    {
        $s = ReorderCalculator::calculate($this->input(['onHand' => '-3', 'sold' => '30', 'minQty' => '0']));

        $this->assertSame('10.000', $s->reorderPoint);
        $this->assertSame('24.000', $s->target);
        $this->assertSame('27.000', $s->suggestedPurchase);
        $this->assertSame('0.0', $s->daysOfCover);
    }

    public function test_maximum_below_the_velocity_reorder_point_caps_the_order(): void
    {
        $s = ReorderCalculator::calculate($this->input(['onHand' => '8', 'sold' => '60', 'minQty' => '5', 'maxQty' => '12']));

        $this->assertSame('20.000', $s->reorderPoint);
        $this->assertSame('12.000', $s->target);
        $this->assertSame('4.000', $s->suggestedPurchase);
    }

    public function test_net_returns_beyond_sales_count_as_zero_velocity(): void
    {
        $s = ReorderCalculator::calculate($this->input(['onHand' => '1', 'sold' => '-4', 'minQty' => '2', 'maxQty' => '5']));

        $this->assertSame('0.000', $s->avgDaily);
        $this->assertNull($s->daysOfCover);
        $this->assertSame('4.000', $s->suggestedPurchase);
    }

    public function test_rejects_invalid_parameters(): void
    {
        $this->expectException(InvalidArgumentException::class);
        ReorderCalculator::calculate($this->input(['velocityDays' => 0]));
    }
}
