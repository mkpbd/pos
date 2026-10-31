<?php

namespace App\Modules\OnlineCatalog\Infrastructure\ReadModels;

use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * Rebuilds product_stats (units sold in the last 30 days and in total) from completed POS
 * sales minus completed returns. Returns count against the period of the sale they
 * reverse. Sums are exact decimals (computed in PHP, so SQLite matches PostgreSQL).
 * Reads the Sales and Products tables read-only.
 */
class ProductStatsProjection
{
    /**
     * @return int organizations refreshed
     */
    public function rebuild(?string $organizationId = null): int
    {
        $organizations = $organizationId !== null
            ? [$organizationId]
            : DB::table('organizations')->orderBy('id')->pluck('id')->all();

        foreach ($organizations as $org) {
            $this->rebuildOrganization($org);
        }

        return count($organizations);
    }

    private function rebuildOrganization(string $organizationId): void
    {
        $now = CarbonImmutable::now();
        $since = $now->subDays(30);
        $totals = [];

        $add = function (string $productId, string $quantity, bool $recent, int $sign) use (&$totals) {
            $totals[$productId] ??= ['30d' => '0.000', 'total' => '0.000'];
            $quantity = $sign < 0 ? Decimal::negate($quantity, 3) : Decimal::round($quantity, 3);
            $totals[$productId]['total'] = Decimal::add($totals[$productId]['total'], $quantity, 3);
            if ($recent) {
                $totals[$productId]['30d'] = Decimal::add($totals[$productId]['30d'], $quantity, 3);
            }
        };

        DB::table('sale_lines as sl')
            ->join('sales as s', 's.id', '=', 'sl.sale_id')
            ->join('product_variants as pv', 'pv.id', '=', 'sl.variant_id')
            ->where('sl.organization_id', $organizationId)
            ->where('s.status', 'completed')
            ->orderBy('sl.id')
            ->select(['sl.id', 'pv.product_id', 'sl.quantity', 's.sold_at'])
            ->lazyById(1000, 'sl.id', 'id')
            ->each(fn (object $row) => $add($row->product_id, (string) $row->quantity, CarbonImmutable::parse($row->sold_at)->gte($since), 1));

        DB::table('sale_return_lines as rl')
            ->join('sale_returns as r', 'r.id', '=', 'rl.sale_return_id')
            ->join('sales as s', 's.id', '=', 'r.sale_id')
            ->join('product_variants as pv', 'pv.id', '=', 'rl.variant_id')
            ->where('rl.organization_id', $organizationId)
            ->where('r.status', 'completed')
            ->where('s.status', 'completed')
            ->orderBy('rl.id')
            ->select(['rl.id', 'pv.product_id', 'rl.quantity', 's.sold_at'])
            ->lazyById(1000, 'rl.id', 'id')
            ->each(fn (object $row) => $add($row->product_id, (string) $row->quantity, CarbonImmutable::parse($row->sold_at)->gte($since), -1));

        DB::transaction(function () use ($organizationId, $totals, $now) {
            DB::table('product_stats')->where('organization_id', $organizationId)->delete();
            $rows = [];
            foreach ($totals as $productId => $t) {
                $rows[] = [
                    'product_id' => $productId,
                    'organization_id' => $organizationId,
                    'units_sold_30d' => Decimal::isNegative($t['30d']) ? '0.000' : $t['30d'],
                    'units_sold_total' => Decimal::isNegative($t['total']) ? '0.000' : $t['total'],
                    'refreshed_at' => $now,
                ];
            }
            foreach (array_chunk($rows, 500) as $chunk) {
                DB::table('product_stats')->insert($chunk);
            }
        });
    }
}
