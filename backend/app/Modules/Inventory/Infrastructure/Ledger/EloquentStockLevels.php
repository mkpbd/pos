<?php

namespace App\Modules\Inventory\Infrastructure\Ledger;

use App\Modules\Inventory\Application\Contracts\StockLevels;
use App\Modules\Inventory\Infrastructure\Models\StockLevel;
use App\Modules\Shared\Domain\ValueObjects\Decimal;

class EloquentStockLevels implements StockLevels
{
    public function onHand(string $storeId, array $variantIds): array
    {
        $result = array_fill_keys(array_values(array_unique($variantIds)), '0.000');
        if ($result === []) {
            return [];
        }

        $rows = StockLevel::query()
            ->leftJoin('batches', 'batches.id', '=', 'stock_levels.batch_id')
            ->where('stock_levels.store_id', $storeId)
            ->whereIn('stock_levels.variant_id', array_keys($result))
            ->where(fn ($q) => $q->whereNull('batches.expires_on')->orWhere('batches.expires_on', '>=', now()->toDateString()))
            ->get(['stock_levels.variant_id', 'stock_levels.quantity']);

        foreach ($rows as $row) {
            $result[$row->variant_id] = Decimal::add($result[$row->variant_id], $row->quantity, 3);
        }

        return $result;
    }
}
