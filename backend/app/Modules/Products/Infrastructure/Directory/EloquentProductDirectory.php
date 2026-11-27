<?php

namespace App\Modules\Products\Infrastructure\Directory;

use App\Modules\Catalog\Application\Contracts\CatalogDirectory;
use App\Modules\Products\Application\Contracts\ProductDirectory;
use App\Modules\Products\Domain\ProductType;
use App\Modules\Products\Infrastructure\Models\Product;
use App\Modules\Products\Infrastructure\Models\ProductImage;
use App\Modules\Products\Infrastructure\Models\ProductVariant;
use App\Modules\Shared\Infrastructure\Persistence\WhereInChunks;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

class EloquentProductDirectory implements ProductDirectory
{
    public function __construct(private readonly CatalogDirectory $catalog) {}

    public function variants(string $organizationId, array $variantIds): array
    {
        if ($variantIds === []) {
            return [];
        }

        // G1c: chunked — a store can stock more variants than PostgreSQL allows bound parameters.
        $variants = WhereInChunks::get(ProductVariant::query()->withoutGlobalScope('organization')->withTrashed()
            ->where('organization_id', $organizationId)
            ->with(['product' => fn ($q) => $q->withoutGlobalScope('organization')->withTrashed()]), 'product_variants.id', $variantIds);

        return $this->describe($organizationId, $variants)->all();
    }

    public function stockFlags(string $organizationId, array $variantIds): array
    {
        if ($variantIds === []) {
            return [];
        }

        // Plain rows instead of models: the same rules as describe(), at a fraction of the cost.
        $rows = WhereInChunks::get(DB::table('product_variants as v')->join('products as p', 'p.id', '=', 'v.product_id')
            ->where('v.organization_id', $organizationId), 'v.id', $variantIds,
            ['v.id', 'v.is_active as variant_active', 'v.deleted_at as variant_deleted_at', 'p.is_active', 'p.deleted_at', 'p.type', 'p.track_stock', 'p.unit_id']);
        $units = $this->catalog->describe($organizationId, ['units' => $rows->pluck('unit_id')->filter()->unique()->values()->all()])['units'];

        $flags = [];
        foreach ($rows as $row) {
            $flags[$row->id] = [
                'track_stock' => $row->type === ProductType::Standard->value && (bool) $row->track_stock,
                'sellable' => $row->variant_deleted_at === null && $row->deleted_at === null && (bool) $row->variant_active && (bool) $row->is_active,
                'allow_decimal' => (bool) ($units[$row->unit_id]['allow_decimal'] ?? false),
            ];
        }

        return $flags;
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

    public function variantIdByCode(string $organizationId, string $code): ?string
    {
        $code = trim($code);
        if ($code === '') {
            return null;
        }

        $byBarcode = DB::table('product_barcodes')->where('organization_id', $organizationId)->where('barcode', $code)->value('variant_id');
        if ($byBarcode !== null) {
            return (string) $byBarcode;
        }

        // A SKU is unique among live variants; an archived variant may share it, so live ones win.
        $bySku = DB::table('product_variants')->where('organization_id', $organizationId)
            ->whereRaw('lower(sku) = ?', [mb_strtolower($code)])
            ->orderByRaw('deleted_at IS NOT NULL')->orderBy('id')
            ->value('id');

        return $bySku === null ? null : (string) $bySku;
    }

    public function primaryBarcodes(string $organizationId, array $variantIds): array
    {
        if ($variantIds === []) {
            return [];
        }

        // ST2c: unit barcodes only — a pack (carton) barcode does not name one unit.
        $rows = WhereInChunks::get(DB::table('product_barcodes')->where('organization_id', $organizationId)->where('units', 1), 'variant_id', $variantIds, ['variant_id', 'barcode', 'id']);
        $barcodes = [];
        foreach ($rows->sortBy('id') as $row) {
            $barcodes[(string) $row->variant_id] ??= (string) $row->barcode;
        }

        return $barcodes;
    }

    public function branchPrices(string $organizationId, string $branchId, array $variantIds): array
    {
        if ($variantIds === []) {
            return [];
        }

        return WhereInChunks::get(DB::table('product_branch_prices')->where('organization_id', $organizationId)->where('branch_id', $branchId),
            'variant_id', $variantIds, ['variant_id', 'price'])
            ->mapWithKeys(fn ($row) => [(string) $row->variant_id => (string) $row->price])
            ->all();
    }

    public function images(string $organizationId, array $imageIds): array
    {
        $ids = array_values(array_unique(array_filter($imageIds, fn ($id) => is_string($id) && preg_match('/^[0-9a-f-]{36}$/i', $id) === 1)));
        if ($ids === []) {
            return [];
        }

        return ProductImage::query()->withoutGlobalScope('organization')
            ->where('organization_id', $organizationId)
            ->whereKey(array_map('strtolower', $ids))
            ->get(['id', 'product_id', 'path', 'mime_type'])
            ->mapWithKeys(fn (ProductImage $i) => [$i->id => ['id' => $i->id, 'product_id' => $i->product_id, 'url' => $i->url(), 'mime_type' => $i->mime_type]])
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
        // ST2c: quantity breaks of every variant in one query (no N+1 per cart line).
        $tiers = WhereInChunks::get(DB::table('product_price_tiers')->where('organization_id', $organizationId)->orderBy('min_quantity'),
            'variant_id', $variants->pluck('id')->all(), ['variant_id', 'min_quantity', 'price'])
            ->groupBy('variant_id')
            ->map(fn (Collection $rows) => $rows->map(fn ($t) => ['min_quantity' => (string) $t->min_quantity, 'price' => (string) $t->price])->values()->all());
        // ST2c: pack barcodes (units > 1) a till or purchase line can scan or pick.
        $packs = WhereInChunks::get(DB::table('product_barcodes')->where('organization_id', $organizationId)->where('units', '>', 1)->orderBy('units'),
            'variant_id', $variants->pluck('id')->all(), ['variant_id', 'barcode', 'units', 'pack_name'])
            ->groupBy('variant_id')
            ->map(fn (Collection $rows) => $rows->map(fn ($b) => ['barcode' => (string) $b->barcode, 'units' => (string) $b->units, 'pack_name' => $b->pack_name])->values()->all());

        return $variants->mapWithKeys(function (ProductVariant $v) use ($refs, $tiers, $packs) {
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
                // ST2c: charged to wholesale customers; quantity breaks lowest first.
                'wholesale_price' => $v->wholesale_price,
                'price_tiers' => $tiers->get($v->id, []),
                'packs' => $packs->get($v->id, []),
                'reorder_level' => $v->reorder_level,
                'max_discount_percent' => $p->max_discount_percent,
                'category_id' => $p->category_id,
                // POS1a: promotions match brands; open-price products are priced at the till.
                'brand_id' => $p->brand_id,
                'open_price' => (bool) $p->open_price,
                'sellable' => ! $v->trashed() && ! $p->trashed() && $v->is_active && $p->is_active,
            ]];
        });
    }
}
