<?php

namespace App\Modules\Inventory\Application\Queries;

use App\Modules\Inventory\Infrastructure\Models\StockLevel;
use App\Modules\Inventory\Infrastructure\Models\Stocktake;
use App\Modules\Inventory\Infrastructure\Models\StocktakeLine;
use App\Modules\Products\Application\Contracts\ProductDirectory;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Illuminate\Support\Collection;

/**
 * ST1: a stocktake's progress and variance. A line's difference is `counted − system snapshot`;
 * its value is the difference at the stock row's current average cost (else the product's
 * purchase price) — the cost the posting would use.
 */
class StocktakeFigures
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly ProductDirectory $products,
    ) {}

    /**
     * @return array{lines: int, counted: int, uncounted: int, with_variance: int, variance_quantity_in: string, variance_quantity_out: string, variance_value: string}
     */
    public function summary(Stocktake $stocktake): array
    {
        $row = StocktakeLine::query()->where('stocktake_id', $stocktake->id)->toBase()->selectRaw(<<<'SQL'
            COUNT(*) AS lines,
            COUNT(counted_quantity) AS counted,
            COALESCE(SUM(CASE WHEN counted_quantity <> system_quantity THEN 1 ELSE 0 END), 0) AS with_variance,
            COALESCE(SUM(CASE WHEN counted_quantity > system_quantity THEN counted_quantity - system_quantity ELSE 0 END), 0) AS quantity_in,
            COALESCE(SUM(CASE WHEN counted_quantity < system_quantity THEN system_quantity - counted_quantity ELSE 0 END), 0) AS quantity_out
        SQL)->first();

        $variance = StocktakeLine::query()->where('stocktake_id', $stocktake->id)->whereNotNull('counted_quantity')
            ->whereColumn('counted_quantity', '<>', 'system_quantity')->get(['variant_id', 'batch_id', 'counted_quantity', 'system_quantity']);
        $value = '0.00';
        foreach ($this->values($stocktake, $variance) as $lineValue) {
            $value = Decimal::add($value, $lineValue ?? '0', 2);
        }

        return [
            'lines' => (int) $row->lines,
            'counted' => (int) $row->counted,
            'uncounted' => (int) $row->lines - (int) $row->counted,
            'with_variance' => (int) $row->with_variance,
            'variance_quantity_in' => Decimal::round((string) $row->quantity_in, 3),
            'variance_quantity_out' => Decimal::round((string) $row->quantity_out, 3),
            'variance_value' => $value,
        ];
    }

    /**
     * Value of each counted line's difference (money string, 2 dp), keyed like the input; null for uncounted lines.
     *
     * @param  Collection<int, StocktakeLine>  $lines
     * @return array<int|string, ?string>
     */
    public function values(Stocktake $stocktake, Collection $lines): array
    {
        $counted = $lines->filter(fn (StocktakeLine $l) => $l->counted_quantity !== null);
        if ($counted->isEmpty()) {
            return $lines->map(fn () => null)->all();
        }

        $variantIds = $counted->pluck('variant_id')->unique()->values()->all();
        $costs = StockLevel::query()->where('store_id', $stocktake->store_id)->whereIn('variant_id', $variantIds)
            ->get(['variant_id', 'batch_id', 'average_cost'])
            ->mapWithKeys(fn (StockLevel $l) => [$l->variant_id.'|'.($l->batch_id ?? '') => (string) $l->average_cost])
            ->all();
        $prices = array_map(fn (array $v) => (string) $v['purchase_price'], $this->products->variants($this->tenant->requireOrganization(), $variantIds));

        return $lines->map(function (StocktakeLine $l) use ($costs, $prices) {
            if ($l->counted_quantity === null) {
                return null;
            }
            $average = $costs[$l->variant_id.'|'.($l->batch_id ?? '')] ?? '0';
            $cost = Decimal::compare($average, '0') > 0 ? $average : ($prices[$l->variant_id] ?? '0');

            return Decimal::round(Decimal::mul(Decimal::sub((string) $l->counted_quantity, (string) $l->system_quantity, 3), $cost, 6), 2);
        })->all();
    }
}
