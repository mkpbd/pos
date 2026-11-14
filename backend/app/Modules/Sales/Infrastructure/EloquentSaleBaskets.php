<?php

namespace App\Modules\Sales\Infrastructure;

use App\Modules\Products\Application\Contracts\ProductDirectory;
use App\Modules\Sales\Application\Contracts\SaleBaskets;
use App\Modules\Sales\Domain\ReturnStatus;
use App\Modules\Sales\Domain\SaleStatus;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use DateTimeInterface;
use Illuminate\Support\Facades\DB;

/**
 * P1b: completed POS sales as baskets of distinct products, read in pages of sales (keyset on
 * the id): one query for each page's lines, one for their completed returns; variants are named
 * by product through the Products module's directory.
 */
class EloquentSaleBaskets implements SaleBaskets
{
    private const PAGE = 500;

    public function __construct(private readonly ProductDirectory $products) {}

    public function since(string $organizationId, DateTimeInterface $since): iterable
    {
        $lastId = null;
        do {
            $ids = DB::table('sales')
                ->where('organization_id', $organizationId)
                ->where('status', SaleStatus::Completed->value)
                ->where('sold_at', '>=', $since)
                ->when($lastId !== null, fn ($q) => $q->where('id', '>', $lastId))
                ->orderBy('id')
                ->limit(self::PAGE)
                ->pluck('id')->all();
            if ($ids === []) {
                return;
            }
            $lastId = (string) end($ids);

            $lines = DB::table('sale_lines')
                ->where('organization_id', $organizationId)
                ->whereIn('sale_id', $ids)
                ->orderBy('sale_id')->orderBy('position')
                ->get(['id', 'sale_id', 'variant_id', 'quantity']);
            $returned = DB::table('sale_return_lines as rl')
                ->join('sale_returns as r', 'r.id', '=', 'rl.sale_return_id')
                ->where('rl.organization_id', $organizationId)
                ->where('r.status', ReturnStatus::Completed->value)
                ->whereIn('r.sale_id', $ids)
                ->groupBy('rl.sale_line_id')
                ->select('rl.sale_line_id', DB::raw('sum(rl.quantity) as quantity'))
                ->pluck('quantity', 'sale_line_id')->all();
            $variants = $this->products->variants($organizationId, array_values(array_unique($lines->pluck('variant_id')->map(fn ($id) => (string) $id)->all())));

            $baskets = [];
            foreach ($lines as $line) {
                $productId = $variants[(string) $line->variant_id]['product_id'] ?? null;
                $back = (string) ($returned[(string) $line->id] ?? '0');
                // A line whose whole quantity came back was not bought after all.
                if ($productId === null || Decimal::compare($back, (string) $line->quantity) >= 0) {
                    continue;
                }
                $baskets[(string) $line->sale_id][(string) $productId] = true;
            }
            foreach ($baskets as $products) {
                if (count($products) >= 2) {
                    yield array_map('strval', array_keys($products));
                }
            }
        } while (count($ids) === self::PAGE);
    }
}
