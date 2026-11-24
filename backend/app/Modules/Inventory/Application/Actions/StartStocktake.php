<?php

namespace App\Modules\Inventory\Application\Actions;

use App\Modules\Catalog\Application\Contracts\CatalogDirectory;
use App\Modules\Inventory\Application\Services\StocktakeAccess;
use App\Modules\Inventory\Application\Services\StoreAccess;
use App\Modules\Inventory\Domain\StocktakeScope;
use App\Modules\Inventory\Domain\StocktakeStatus;
use App\Modules\Inventory\Infrastructure\Models\Batch;
use App\Modules\Inventory\Infrastructure\Models\StockLevel;
use App\Modules\Inventory\Infrastructure\Models\Stocktake;
use App\Modules\Products\Application\Contracts\ProductDirectory;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * ST1: starts counting. Creates a line for every stock-tracked, active product in scope that
 * has a stock row in the store — batch-tracked products one line per batch with stock — in
 * product-name order. Category scope includes sub-categories. Lines start uncounted.
 */
class StartStocktake
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly StocktakeAccess $access,
        private readonly StoreAccess $storeAccess,
        private readonly CatalogDirectory $catalog,
        private readonly ProductDirectory $products,
        private readonly AuditTrail $audit,
    ) {}

    public function __invoke(TenantUser $actor, Stocktake $stocktake): Stocktake
    {
        $organizationId = $this->tenant->requireOrganization();

        return DB::transaction(function () use ($actor, $organizationId, $stocktake) {
            $locked = $this->access->lockForChange($actor, $stocktake);
            if ($locked->status !== StocktakeStatus::Draft) {
                throw StocktakeAccess::invalidChange($locked, 'started');
            }
            $this->storeAccess->require($actor, $locked->store_id);

            $lines = $this->scopeLines($organizationId, $locked);
            $now = now();
            foreach (array_chunk($lines, 1000) as $chunk) {
                DB::table('stocktake_lines')->insert(array_map(fn (array $l) => $l + [
                    'id' => (string) Str::uuid7(),
                    'organization_id' => $organizationId,
                    'stocktake_id' => $locked->id,
                    'is_extra' => false,
                    'created_at' => $now,
                    'updated_at' => $now,
                ], $chunk));
            }

            $locked->update(['status' => StocktakeStatus::Counting, 'started_at' => $now]);
            $this->audit->record('stocktake.started', $locked, old: ['status' => StocktakeStatus::Draft->value], new: [
                'number' => $locked->number,
                'status' => StocktakeStatus::Counting->value,
                'lines' => count($lines),
            ]);

            return $locked;
        });
    }

    /**
     * @return list<array{variant_id: string, batch_id: ?string, position: int}>
     */
    private function scopeLines(string $organizationId, Stocktake $stocktake): array
    {
        $levels = StockLevel::query()->where('store_id', $stocktake->store_id)->get(['variant_id', 'batch_id', 'quantity']);
        $variants = $this->products->variants($organizationId, $levels->pluck('variant_id')->unique()->values()->all());

        $categories = null;
        if ($stocktake->scope === StocktakeScope::Categories) {
            $categories = [];
            foreach ($stocktake->scope_ids ?? [] as $id) {
                foreach ($this->catalog->categoryWithDescendants($organizationId, $id) as $category) {
                    $categories[$category] = true;
                }
            }
        }
        $products = $stocktake->scope === StocktakeScope::Products ? array_fill_keys($stocktake->scope_ids ?? [], true) : null;

        $candidates = [];
        foreach ($levels as $level) {
            $variant = $variants[$level->variant_id] ?? null;
            if ($variant === null || ! $variant['track_stock'] || ! $variant['sellable']) {
                continue;
            }
            if ($categories !== null && ($variant['category_id'] === null || ! isset($categories[$variant['category_id']]))) {
                continue;
            }
            if ($products !== null && ! isset($products[$variant['product_id']])) {
                continue;
            }
            // Batch-tracked: one line per batch that has stock; otherwise the product's (un-batched) row.
            if ($variant['track_batches'] ? ($level->batch_id === null || Decimal::isZero((string) $level->quantity)) : $level->batch_id !== null) {
                continue;
            }
            $candidates[$level->variant_id.'|'.($level->batch_id ?? '')] = ['variant_id' => $level->variant_id, 'batch_id' => $level->batch_id];
        }

        $batches = Batch::query()->whereKey(array_values(array_filter(array_column($candidates, 'batch_id'))))->get(['id', 'batch_number', 'expires_on'])->keyBy('id');
        $sortKey = function (array $c) use ($variants, $batches) {
            $v = $variants[$c['variant_id']];
            $b = $c['batch_id'] !== null ? $batches->get($c['batch_id']) : null;

            return mb_strtolower($v['product_name'].' '.($v['variant_name'] ?? '')).'|'.($b?->expires_on?->toDateString() ?? '9999').'|'.($b?->batch_number ?? '');
        };
        $candidates = array_values($candidates);
        usort($candidates, fn (array $a, array $b) => strcmp($sortKey($a), $sortKey($b)));

        return array_map(fn (array $c, int $i) => $c + ['position' => $i + 1], $candidates, array_keys($candidates));
    }
}
