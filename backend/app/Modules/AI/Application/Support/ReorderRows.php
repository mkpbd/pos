<?php

namespace App\Modules\AI\Application\Support;

use App\Modules\Shared\Domain\ValueObjects\Decimal;

/**
 * SC1 reorder suggestion rows prepared for the model: most urgent first (below the minimum, then
 * the fewest days of cover; no sales history last), only the fields that explain the suggestion,
 * the unit cost only with products.view_cost.
 */
final class ReorderRows
{
    /**
     * @param  list<array<string, mixed>>  $rows  ReorderSuggestions::forStore()['rows']
     * @return list<array<string, mixed>>
     */
    public static function prioritized(array $rows): array
    {
        usort($rows, function (array $a, array $b) {
            $reason = fn (array $r) => ($r['reason'] ?? null) === 'below_min' ? 0 : 1;
            if (($c = $reason($a) <=> $reason($b)) !== 0) {
                return $c;
            }
            $ca = $a['days_of_cover'] ?? null;
            $cb = $b['days_of_cover'] ?? null;
            if ($ca === null || $cb === null) {
                return ($ca === null) <=> ($cb === null) ?: self::name($a) <=> self::name($b);
            }

            return Decimal::compare((string) $ca, (string) $cb) ?: self::name($a) <=> self::name($b);
        });

        return $rows;
    }

    /**
     * @param  list<array<string, mixed>>  $rows
     * @return list<array<string, mixed>>
     */
    public static function forModel(array $rows, bool $canViewCost, int $limit): array
    {
        $result = [];
        foreach (array_slice(self::prioritized($rows), 0, $limit) as $row) {
            $item = [
                'product' => self::name($row),
                'sku' => $row['variant']['sku'] ?? null,
                'on_hand' => $row['on_hand'],
                'on_order' => $row['on_order'],
                'in_transit' => $row['in_transit'],
                'avg_daily_sales' => $row['avg_daily'],
                'days_of_cover' => $row['days_of_cover'],
                'reorder_point' => $row['reorder_point'],
                'target' => $row['target'],
                'suggested_purchase' => $row['suggested_purchase'],
                'suggested_transfer' => $row['suggested_transfer'],
                'reason' => $row['reason'],
                'supplier' => $row['supplier']['name'] ?? null,
                'lead_time_days' => $row['lead_time_days'],
                'draft_on_order' => $row['draft_on_order'] ?? '0.000',
            ];
            if ($canViewCost) {
                $item['unit_cost'] = $row['unit_cost'];
            }
            $result[] = $item;
        }

        return $result;
    }

    /**
     * @param  array<string, mixed>  $row
     */
    private static function name(array $row): string
    {
        $variant = $row['variant'] ?? [];
        $name = (string) ($variant['product_name'] ?? '');

        return ($variant['variant_name'] ?? null) ? $name.' — '.$variant['variant_name'] : $name;
    }
}
