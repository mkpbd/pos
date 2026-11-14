<?php

namespace App\Modules\OnlineCatalog\Infrastructure;

use App\Modules\OnlineCatalog\Infrastructure\Models\BackInStockRequest;
use App\Modules\OnlineCatalog\Infrastructure\Models\VariantListing;
use App\Modules\Products\Application\Contracts\VariantWebData;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Domain\ValueObjects\Decimal;

/**
 * P1a: the online catalog's per-variant data for the product variant grid (current organization).
 */
class ListingVariantWebData implements VariantWebData
{
    public function __construct(private readonly AuditTrail $audit) {}

    public function compareAtPrices(array $variantIds): array
    {
        $result = array_fill_keys($variantIds, null);
        if ($variantIds === []) {
            return $result;
        }
        foreach (VariantListing::query()->whereIn('variant_id', $variantIds)->get(['variant_id', 'compare_at_price']) as $row) {
            $result[$row->variant_id] = $row->compare_at_price;
        }

        return $result;
    }

    public function saveCompareAtPrices(array $prices): void
    {
        if ($prices === []) {
            return;
        }
        $existing = VariantListing::query()->whereIn('variant_id', array_keys($prices))->get()->keyBy('variant_id');
        $changes = [];
        foreach ($prices as $variantId => $price) {
            $price = $price === null ? null : Decimal::round($price, 2);
            $row = $existing->get($variantId);
            if ($row === null && $price === null) {
                continue;
            }
            $row ??= new VariantListing(['variant_id' => $variantId]);
            $old = $row->compare_at_price;
            $row->fill(['compare_at_price' => $price])->save();
            if ($old !== $row->compare_at_price) {
                $changes[$variantId] = ['old' => $old, 'new' => $row->compare_at_price];
            }
        }
        if ($changes !== []) {
            $this->audit->record('online_catalog.compare_at_prices.saved', null, context: ['variants' => $changes]);
        }
    }

    public function openBackInStockRequests(array $variantIds): array
    {
        $result = array_fill_keys($variantIds, 0);
        if ($variantIds === []) {
            return $result;
        }
        $counts = BackInStockRequest::query()->whereIn('variant_id', $variantIds)->whereNull('notified_at')
            ->groupBy('variant_id')->selectRaw('variant_id, count(*) as aggregate')->pluck('aggregate', 'variant_id');
        foreach ($counts as $variantId => $count) {
            $result[$variantId] = (int) $count;
        }

        return $result;
    }
}
