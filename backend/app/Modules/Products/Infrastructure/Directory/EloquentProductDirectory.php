<?php

namespace App\Modules\Products\Infrastructure\Directory;

use App\Modules\Catalog\Application\Contracts\CatalogDirectory;
use App\Modules\Products\Application\Contracts\ProductDirectory;
use App\Modules\Products\Domain\ProductType;
use App\Modules\Products\Infrastructure\Models\Product;
use App\Modules\Products\Infrastructure\Models\ProductImage;
use App\Modules\Products\Infrastructure\Models\ProductVariant;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;

class EloquentProductDirectory implements ProductDirectory
{
    public function __construct(private readonly CatalogDirectory $catalog) {}

    public function variants(string $organizationId, array $variantIds): array
    {
        if ($variantIds === []) {
            return [];
        }

        $variants = ProductVariant::query()->withoutGlobalScope('organization')->withTrashed()
            ->where('organization_id', $organizationId)
            ->whereKey(array_values(array_unique($variantIds)))
            ->with(['product' => fn ($q) => $q->withoutGlobalScope('organization')->withTrashed()])
            ->get();

        return $this->describe($organizationId, $variants)->all();
    }

    public function products(string $organizationId, array $productIds): array
    {
        if ($productIds === []) {
            return [];
        }

        return Product::query()->withoutGlobalScope('organization')
            ->where('organization_id', $organizationId)
            ->whereKey(array_values(array_unique($productIds)))
            ->get(['id', 'name'])
            ->mapWithKeys(fn (Product $p) => [$p->id => ['id' => $p->id, 'name' => $p->name]])
            ->all();
    }

    public function searchVariantIds(string $organizationId, string $search, int $limit = 500): array
    {
        $like = '%'.addcslashes($search, '%_\\').'%';

        return ProductVariant::query()->withoutGlobalScope('organization')
            ->where('organization_id', $organizationId)
            ->where(fn (Builder $q) => $q
                ->whereLike('sku', $like)
                ->orWhereHas('barcodes', fn (Builder $b) => $b->where('barcode', $search))
                ->orWhereHas('product', fn (Builder $p) => $p->withoutGlobalScope('organization')->whereLike('name', $like)))
            ->limit($limit)
            ->pluck('id')
            ->all();
    }

    public function sellablePage(string $organizationId, array $filters, int $page, int $perPage): array
    {
        $search = trim((string) ($filters['search'] ?? ''));
        $like = '%'.addcslashes($search, '%_\\').'%';

        $query = ProductVariant::query()->withoutGlobalScope('organization')
            ->select('product_variants.*')
            ->join('products', 'products.id', '=', 'product_variants.product_id')
            ->where('product_variants.organization_id', $organizationId)
            ->where('product_variants.is_active', true)
            ->where('products.is_active', true)
            ->whereNull('products.deleted_at')
            ->when($filters['category_ids'] ?? null, fn (Builder $q, array $ids) => $q->whereIn('products.category_id', $ids))
            ->when($search !== '', fn (Builder $q) => $q->where(fn (Builder $w) => $w
                ->whereLike('products.name', $like)
                ->orWhereLike('product_variants.sku', $like)
                ->orWhereHas('barcodes', fn (Builder $b) => $b->where('barcode', $search))));

        $total = (clone $query)->count();
        $variants = $query
            ->orderBy('products.name')->orderBy('product_variants.sort_order')
            ->forPage($page, $perPage)
            ->with(['product' => fn ($q) => $q->withoutGlobalScope('organization')])
            ->get();

        $images = ProductImage::query()->withoutGlobalScope('organization')
            ->whereIn('product_id', $variants->pluck('product_id')->unique()->all())
            ->orderBy('sort_order')
            ->get()
            ->unique('product_id')
            ->keyBy('product_id');

        $items = $this->describe($organizationId, $variants)
            ->map(fn (array $v) => $v + ['image_url' => $images->get($v['product_id'])?->url()])
            ->values()
            ->all();

        return ['items' => $items, 'total' => $total];
    }

    /**
     * @param  Collection<int, ProductVariant>  $variants
     * @return Collection<string, array<string, mixed>>
     */
    private function describe(string $organizationId, Collection $variants): Collection
    {
        $products = $variants->pluck('product');
        $refs = $this->catalog->describe($organizationId, [
            'units' => $products->pluck('unit_id')->filter()->all(),
            'tax_rates' => $products->pluck('tax_rate_id')->filter()->all(),
        ]);

        return $variants->mapWithKeys(function (ProductVariant $v) use ($refs) {
            /** @var Product $p */
            $p = $v->product;
            $unit = $refs['units'][$p->unit_id] ?? null;

            return [$v->id => [
                'variant_id' => $v->id,
                'product_id' => $p->id,
                'product_name' => $p->name,
                'variant_name' => $v->name ?? ($v->option_values ? implode(' / ', $v->option_values) : null),
                'sku' => $v->sku,
                'track_stock' => $p->type === ProductType::Standard && $p->track_stock,
                'track_batches' => $p->track_batches,
                'track_serials' => $p->track_serials,
                'allow_decimal' => (bool) ($unit['allow_decimal'] ?? false),
                'unit_code' => $unit['code'] ?? null,
                'tax_rate' => $p->tax_rate_id ? ($refs['tax_rates'][$p->tax_rate_id]['rate'] ?? null) : null,
                'purchase_price' => $v->purchase_price,
                'selling_price' => $v->selling_price,
                'reorder_level' => $v->reorder_level,
                'max_discount_percent' => $p->max_discount_percent,
                'category_id' => $p->category_id,
                'sellable' => ! $v->trashed() && ! $p->trashed() && $v->is_active && $p->is_active,
            ]];
        });
    }
}
