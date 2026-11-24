<?php

namespace App\Modules\Inventory\Presentation\Http\Support;

use App\Modules\Catalog\Application\Contracts\CatalogDirectory;
use App\Modules\Inventory\Application\Queries\StocktakeFigures;
use App\Modules\Inventory\Domain\StocktakeScope;
use App\Modules\Inventory\Infrastructure\Models\Batch;
use App\Modules\Inventory\Infrastructure\Models\StockAdjustment;
use App\Modules\Inventory\Infrastructure\Models\Stocktake;
use App\Modules\Inventory\Infrastructure\Models\StocktakeLine;
use App\Modules\Products\Application\Contracts\ProductDirectory;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Users\Application\Contracts\UserDirectory;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Gate;

/**
 * ST1: shapes stocktakes and their lines. Blind stocktakes hide the system quantity (and with
 * it every difference) from users without `inventory.adjust`; values need `products.view_cost`.
 */
class StocktakePresenter
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly InventoryPresenter $inventory,
        private readonly ProductDirectory $products,
        private readonly CatalogDirectory $catalog,
        private readonly UserDirectory $users,
        private readonly StocktakeFigures $figures,
    ) {}

    public static function seesSystem(TenantUser $user, Stocktake $stocktake): bool
    {
        return ! $stocktake->blind || Gate::forUser($user)->allows('inventory.adjust');
    }

    public static function seesCost(TenantUser $user): bool
    {
        return Gate::forUser($user)->allows('products.view_cost');
    }

    /**
     * @param  Collection<int, Stocktake>  $stocktakes
     * @return callable(Stocktake): array<string, mixed>
     */
    public function rows(Collection $stocktakes): callable
    {
        $org = $this->tenant->requireOrganization();
        $stores = $this->inventory->lookups(storeIds: $stocktakes->pluck('store_id')->unique()->values()->all())['stores'];
        $users = $this->users->names($org, $stocktakes->flatMap(fn (Stocktake $s) => [$s->created_by, $s->posted_by, $s->cancelled_by])->filter()->unique()->values()->all());
        $adjustments = StockAdjustment::query()->whereKey($stocktakes->pluck('adjustment_id')->filter()->values()->all())->pluck('number', 'id');
        $user = fn (?string $id) => $id === null ? null : ['id' => $id, 'name' => $users[$id] ?? null];

        return fn (Stocktake $s) => [
            'id' => $s->id,
            'number' => $s->number,
            'status' => $s->status->value,
            'scope' => $s->scope->value,
            'scope_ids' => $s->scope_ids ?? [],
            'blind' => $s->blind,
            'notes' => $s->notes,
            'store' => $stores[$s->store_id] ?? null,
            'branch_id' => $s->branch_id,
            'started_at' => $s->started_at?->toIso8601String(),
            'uncounted_policy' => $s->uncounted_policy?->value,
            'posted_at' => $s->posted_at?->toIso8601String(),
            'posted_by' => $user($s->posted_by),
            'adjustment' => $s->adjustment_id === null ? null : ['id' => $s->adjustment_id, 'number' => $adjustments[$s->adjustment_id] ?? null],
            'cancelled_at' => $s->cancelled_at?->toIso8601String(),
            'cancelled_by' => $user($s->cancelled_by),
            'created_by' => $user($s->created_by),
            'created_at' => $s->created_at?->toIso8601String(),
            // Only on the list (withCount).
            'lines_count' => isset($s->getAttributes()['lines_count']) ? (int) $s->getAttributes()['lines_count'] : null,
            'counted_count' => isset($s->getAttributes()['counted_count']) ? (int) $s->getAttributes()['counted_count'] : null,
        ];
    }

    /**
     * The stocktake with its summary (`GET …/{id}`).
     *
     * @return array<string, mixed>
     */
    public function detail(Stocktake $stocktake, TenantUser $user): array
    {
        $org = $this->tenant->requireOrganization();
        $row = ($this->rows(collect([$stocktake])))($stocktake);
        $ids = $stocktake->scope_ids ?? [];
        $names = match ($stocktake->scope) {
            StocktakeScope::Categories => $this->catalog->describe($org, ['categories' => $ids])['categories'],
            StocktakeScope::Products => $this->products->products($org, $ids),
            StocktakeScope::All => [],
        };
        $summary = $this->figures->summary($stocktake);
        $seesSystem = self::seesSystem($user, $stocktake);
        if (! $seesSystem) {
            $summary = array_merge($summary, ['with_variance' => null, 'variance_quantity_in' => null, 'variance_quantity_out' => null, 'variance_value' => null]);
        } elseif (! self::seesCost($user)) {
            $summary['variance_value'] = null;
        }

        return $row + [
            'scope_items' => array_values(array_map(fn (string $id) => ['id' => $id, 'name' => $names[$id]['name'] ?? null], $ids)),
            'summary' => $summary,
            'can_see_system_quantity' => $seesSystem,
        ];
    }

    /**
     * @param  Collection<int, StocktakeLine>  $lines
     * @return list<array<string, mixed>>
     */
    public function lines(Stocktake $stocktake, Collection $lines, TenantUser $user): array
    {
        $org = $this->tenant->requireOrganization();
        $lines = $lines->values();
        $variantIds = $lines->pluck('variant_id')->unique()->values()->all();
        $variants = $this->products->variants($org, $variantIds);
        $barcodes = $this->products->primaryBarcodes($org, $variantIds);
        $batches = Batch::query()->whereKey($lines->pluck('batch_id')->filter()->unique()->values()->all())->get(['id', 'batch_number', 'expires_on'])->keyBy('id');
        $users = $this->users->names($org, $lines->pluck('counted_by')->filter()->unique()->values()->all());
        $seesSystem = self::seesSystem($user, $stocktake);
        $values = $seesSystem && self::seesCost($user) ? $this->figures->values($stocktake, $lines) : [];

        return $lines->map(function (StocktakeLine $l, int $i) use ($variants, $barcodes, $batches, $users, $seesSystem, $values) {
            $v = $variants[$l->variant_id] ?? null;
            $b = $l->batch_id !== null ? $batches->get($l->batch_id) : null;
            $difference = $l->counted_quantity === null ? null : Decimal::sub((string) $l->counted_quantity, (string) $l->system_quantity, 3);

            return [
                'id' => $l->id,
                'variant' => $v === null ? null : [
                    'id' => $l->variant_id,
                    'name' => $v['variant_name'],
                    'sku' => $v['sku'],
                    'barcode' => $barcodes[$l->variant_id] ?? null,
                    'product_name' => $v['product_name'],
                    'unit_code' => $v['unit_code'],
                    'allow_decimal' => $v['allow_decimal'],
                    'track_batches' => $v['track_batches'],
                ],
                'batch' => $b === null ? null : ['id' => $b->id, 'number' => $b->batch_number, 'expires_on' => $b->expires_on?->toDateString()],
                'is_extra' => $l->is_extra,
                'system_quantity' => $seesSystem ? $l->system_quantity : null,
                'counted_quantity' => $l->counted_quantity,
                'difference' => $seesSystem ? $difference : null,
                'value_difference' => $values[$i] ?? null,
                'note' => $l->note,
                'counted_at' => $l->counted_at?->toIso8601String(),
                'counted_by' => $l->counted_by === null ? null : ['id' => $l->counted_by, 'name' => $users[$l->counted_by] ?? null],
            ];
        })->all();
    }
}
