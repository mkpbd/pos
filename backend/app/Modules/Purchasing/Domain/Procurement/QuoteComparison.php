<?php

namespace App\Modules\Purchasing\Domain\Procurement;

use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Shared\Domain\ValueObjects\Money;

/**
 * Side-by-side comparison of the quotes received for an RFQ (SC2), pure and unit-tested.
 *
 * Per line: every quoting supplier's unit price, line total (requested quantity × unit price,
 * so totals are comparable; `partial` when the supplier offers less), lead time, and the flags
 * `lowest_price` (lowest unit price — ties flag every tied supplier) and `fastest` (shortest
 * lead time among quotes that state one). Per supplier: lines quoted, coverage and the total
 * of the quoted lines. Prices are tax-exclusive, like purchase order unit costs.
 */
final class QuoteComparison
{
    /**
     * @param  list<array{id: string, quantity: string}>  $lines
     * @param  list<array{supplier_id: string, status: string, valid_until: ?string, prices: array<string, array{unit_price: string, quantity_offered: ?string, lead_time_days: ?int}>}>  $suppliers  status pending|received|declined; prices keyed by RFQ line id
     * @param  string  $today  Y-m-d, for the expired flag
     * @return array{lines: list<array{rfq_line_id: string, quantity: string, quotes: list<array<string, mixed>>, lowest_price_supplier_ids: list<string>, fastest_supplier_ids: list<string>}>, suppliers: list<array<string, mixed>>}
     */
    public static function compare(array $lines, array $suppliers, string $currency, string $today): array
    {
        $totals = [];
        $quoted = [];
        foreach ($suppliers as $s) {
            $totals[$s['supplier_id']] = Money::zero($currency);
            $quoted[$s['supplier_id']] = 0;
        }

        $outLines = [];
        foreach ($lines as $line) {
            $quotes = [];
            foreach ($suppliers as $s) {
                $price = $s['status'] === QuoteStatus::Received->value ? ($s['prices'][$line['id']] ?? null) : null;
                if ($price === null) {
                    continue;
                }
                $lineTotal = Money::ofProduct($line['quantity'], $price['unit_price'], $currency);
                $totals[$s['supplier_id']] = $totals[$s['supplier_id']]->plus($lineTotal);
                $quoted[$s['supplier_id']]++;
                $quotes[] = [
                    'supplier_id' => $s['supplier_id'],
                    'unit_price' => $price['unit_price'],
                    'quantity_offered' => $price['quantity_offered'],
                    'line_total' => $lineTotal->amount(),
                    'lead_time_days' => $price['lead_time_days'],
                    'valid_until' => $s['valid_until'],
                    'expired' => self::expired($s['valid_until'], $today),
                    'partial' => $price['quantity_offered'] !== null && Decimal::compare($price['quantity_offered'], $line['quantity']) < 0,
                ];
            }

            $lowest = null;
            $fastest = null;
            foreach ($quotes as $q) {
                $lowest = $lowest === null ? $q['unit_price'] : Decimal::min($lowest, $q['unit_price']);
                if ($q['lead_time_days'] !== null) {
                    $fastest = $fastest === null ? $q['lead_time_days'] : min($fastest, $q['lead_time_days']);
                }
            }
            $lowestIds = [];
            $fastestIds = [];
            foreach ($quotes as $i => $q) {
                $quotes[$i]['lowest_price'] = $lowest !== null && Decimal::compare($q['unit_price'], $lowest) === 0;
                $quotes[$i]['fastest'] = $fastest !== null && $q['lead_time_days'] === $fastest;
                if ($quotes[$i]['lowest_price']) {
                    $lowestIds[] = $q['supplier_id'];
                }
                if ($quotes[$i]['fastest']) {
                    $fastestIds[] = $q['supplier_id'];
                }
            }

            $outLines[] = [
                'rfq_line_id' => $line['id'],
                'quantity' => $line['quantity'],
                'quotes' => $quotes,
                'lowest_price_supplier_ids' => $lowestIds,
                'fastest_supplier_ids' => $fastestIds,
            ];
        }

        $lineCount = count($lines);
        $outSuppliers = [];
        foreach ($suppliers as $s) {
            $n = $quoted[$s['supplier_id']];
            $outSuppliers[] = [
                'supplier_id' => $s['supplier_id'],
                'status' => $s['status'],
                'valid_until' => $s['valid_until'],
                'expired' => self::expired($s['valid_until'], $today),
                'lines_quoted' => $n,
                'lines_total' => $lineCount,
                'coverage_percent' => $lineCount === 0 ? 0 : intdiv($n * 100, $lineCount),
                'complete' => $lineCount > 0 && $n === $lineCount,
                'total' => $totals[$s['supplier_id']]->amount(),
            ];
        }

        return ['lines' => $outLines, 'suppliers' => $outSuppliers];
    }

    private static function expired(?string $validUntil, string $today): bool
    {
        return $validUntil !== null && $validUntil < $today;
    }
}
