<?php

namespace App\Modules\Purchasing\Application\Services;

use App\Modules\Inventory\Application\Contracts\StockValuation;
use App\Modules\Products\Application\Contracts\ProductDirectory;
use App\Modules\Purchasing\Domain\LandedCost\LandedCostAllocator;
use App\Modules\Purchasing\Infrastructure\Models\GoodsReceipt;
use App\Modules\Purchasing\Infrastructure\Models\GoodsReceiptLine;
use App\Modules\Purchasing\Infrastructure\Models\LandedCostAllocation;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Shared\Domain\ValueObjects\Money;
use Illuminate\Support\Collection;

/**
 * SC3: the allocation table of a landed cost voucher — shared by the preview and the posting.
 *
 * 1. Every charge is spread over all lines of the selected receipts (LandedCostAllocator:
 *    by line subtotal or base quantity, largest remainder, exact).
 * 2. The quantity of each line still on hand comes from the stock ledger
 *    (StockValuation::onHandFromDocument — newest stock assumed on hand, see there), capped
 *    by what the line received minus what was returned to the supplier; when one receipt
 *    has several lines on the same store × variant × batch, the on-hand quantity is given to
 *    its last lines first. Products that do not track stock have nothing on hand.
 * 3. Each line's amount is split exactly between on hand (amount × on hand ÷ received) and
 *    consumed (the rest: sold, used, written off or returned).
 * 4. The on-hand shares are summed per stock level; the new average cost of a level is
 *    (quantity × average + Σ on-hand shares) ÷ quantity (4 dp).
 */
class LandedCostCalculator
{
    public function __construct(
        private readonly StockValuation $valuation,
        private readonly ProductDirectory $products,
    ) {}

    /**
     * @param  list<array{amount: string, allocation: string}>  $charges
     * @param  Collection<int, GoodsReceipt>  $receipts  in voucher order
     * @return array{
     *   lines: list<array<string, mixed>>,
     *   levels: array<string, array{store_id: string, variant_id: string, batch_id: ?string, quantity: string, average_before: string, average_after: string, amount: string}>,
     *   on_hand_total: string, consumed_total: string, charges_total: string
     * }
     */
    public function calculate(string $organizationId, string $currency, array $charges, Collection $receipts, bool $lock = false): array
    {
        $position = $receipts->pluck('id')->flip();
        $byId = $receipts->keyBy('id');
        // A deterministic order, so the preview and the posting break allocation ties alike.
        $lines = GoodsReceiptLine::query()->whereIn('goods_receipt_id', $receipts->pluck('id')->all())->orderBy('id')->get()
            ->sortBy(fn (GoodsReceiptLine $l) => $position[$l->goods_receipt_id])
            ->values();
        if ($lines->isEmpty() || $charges === []) {
            return ['lines' => [], 'levels' => [], 'on_hand_total' => '0.00', 'consumed_total' => '0.00', 'charges_total' => '0.00'];
        }

        $allocated = LandedCostAllocator::allocate($charges, $lines->map(fn (GoodsReceiptLine $l) => [
            'quantity' => $l->quantity,
            'value' => $l->line_subtotal,
        ])->all(), $currency);

        $variants = $this->products->variants($organizationId, $lines->pluck('variant_id')->unique()->values()->all());
        $tracked = $lines->filter(fn (GoodsReceiptLine $l) => (bool) ($variants[$l->variant_id]['track_stock'] ?? false));
        $attribution = $this->valuation->onHandFromDocument($tracked->map(fn (GoodsReceiptLine $l) => [
            'reference_type' => 'goods_receipt',
            'reference_id' => $l->goods_receipt_id,
            'store_id' => $byId[$l->goods_receipt_id]->store_id,
            'variant_id' => $l->variant_id,
            'batch_id' => $l->batch_id,
        ])->values()->all(), $lock);

        // On hand per (receipt, level), handed to the receipt's last lines on that level first.
        $onHand = [];
        $levelFacts = [];
        $groups = [];
        foreach ($tracked->values() as $i => $line) {
            $key = $line->goods_receipt_id.'|'.$this->levelKey($byId[$line->goods_receipt_id]->store_id, $line);
            $groups[$key]['available'] ??= $attribution[$i]['on_hand'];
            $groups[$key]['lines'][] = $line;
            $levelFacts[$this->levelKey($byId[$line->goods_receipt_id]->store_id, $line)] = $attribution[$i];
        }
        foreach ($groups as $group) {
            $available = $group['available'];
            foreach (array_reverse($group['lines']) as $line) {
                $net = Decimal::sub($line->quantity, $line->returned_quantity, 3);
                $take = Decimal::compare($available, '0') > 0 ? Decimal::min($available, $net) : '0.000';
                $take = Decimal::isNegative($take) ? '0.000' : $take;
                $onHand[$line->id] = Decimal::round($take, 3);
                $available = Decimal::sub($available, $take, 3);
            }
        }

        $prior = LandedCostAllocation::query()->whereIn('goods_receipt_line_id', $lines->pluck('id')->all())
            ->get(['goods_receipt_line_id', 'amount'])
            ->groupBy('goods_receipt_line_id')
            ->map(fn (Collection $rows) => $rows->reduce(fn (string $sum, LandedCostAllocation $a) => Decimal::add($sum, $a->amount, 2), '0.00'));

        $rows = [];
        $levels = [];
        $onHandTotal = Money::zero($currency);
        $consumedTotal = Money::zero($currency);
        foreach ($lines as $i => $line) {
            $receipt = $byId[$line->goods_receipt_id];
            $amount = $allocated['lines'][$i];
            $lineOnHand = $onHand[$line->id] ?? '0.000';
            $split = LandedCostAllocator::split($amount, $lineOnHand, $line->quantity, $currency);
            $onHandTotal = $onHandTotal->plus(Money::of($split['on_hand'], $currency));
            $consumedTotal = $consumedTotal->plus(Money::of($split['consumed'], $currency));

            $levelKey = $this->levelKey($receipt->store_id, $line);
            if (Decimal::compare($split['on_hand'], '0') > 0) {
                $facts = $levelFacts[$levelKey];
                $levels[$levelKey] ??= [
                    'store_id' => $receipt->store_id,
                    'variant_id' => $line->variant_id,
                    'batch_id' => $line->batch_id,
                    'quantity' => $facts['level_quantity'],
                    'average_before' => $facts['average_cost'],
                    'average_after' => $facts['average_cost'],
                    'amount' => '0.00',
                ];
                $levels[$levelKey]['amount'] = Decimal::add($levels[$levelKey]['amount'], $split['on_hand'], 2);
            }

            $priorAmount = $prior[$line->id] ?? '0.00';
            $rows[] = [
                'level_key' => $levelKey,
                'goods_receipt_id' => $receipt->id,
                'goods_receipt_number' => $receipt->number,
                'goods_receipt_line_id' => $line->id,
                'store_id' => $receipt->store_id,
                'variant_id' => $line->variant_id,
                'batch_id' => $line->batch_id,
                'received_quantity' => Decimal::round($line->quantity, 3),
                'returned_quantity' => Decimal::round($line->returned_quantity, 3),
                'on_hand_quantity' => $lineOnHand,
                'consumed_quantity' => Decimal::sub($line->quantity, $lineOnHand, 3),
                'line_value' => $line->line_subtotal,
                'amount' => $amount,
                'on_hand_amount' => $split['on_hand'],
                'consumed_amount' => $split['consumed'],
                'landed_unit_cost' => $line->landed_unit_cost,
                'previous_voucher_cost' => $priorAmount,
                'new_landed_unit_cost' => LandedCostAllocator::landedUnitCost($line->landed_unit_cost, Decimal::add($priorAmount, $amount, 2), $line->quantity),
            ];
        }

        foreach ($levels as $key => $level) {
            $levels[$key]['average_after'] = Decimal::div(
                Decimal::add(Decimal::mul($level['quantity'], $level['average_before'], 8), $level['amount'], 8),
                $level['quantity'],
                4,
            );
        }
        foreach ($rows as $i => $row) {
            $level = $levels[$row['level_key']] ?? null;
            $rows[$i]['average_cost_before'] = $level['average_before'] ?? null;
            $rows[$i]['average_cost_after'] = $level['average_after'] ?? null;
        }

        return [
            'lines' => $rows,
            'levels' => $levels,
            'on_hand_total' => $onHandTotal->amount(),
            'consumed_total' => $consumedTotal->amount(),
            'charges_total' => $allocated['total'],
        ];
    }

    private function levelKey(string $storeId, GoodsReceiptLine $line): string
    {
        return $storeId.'|'.$line->variant_id.'|'.($line->batch_id ?? '');
    }
}
