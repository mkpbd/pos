<?php

namespace App\Modules\OnlineCatalog\Infrastructure;

use App\Modules\Inventory\Application\Contracts\StockLevels;
use App\Modules\OnlineCatalog\Application\Contracts\StorefrontCatalog;
use App\Modules\OnlineCatalog\Application\Queries\BrowseCatalog;
use App\Modules\OnlineCatalog\Application\Queries\CatalogNavigation;
use App\Modules\OnlineCatalog\Application\Queries\ProductPage;
use App\Modules\OnlineCatalog\Domain\ListingState;
use App\Modules\OnlineCatalog\Infrastructure\ReadModels\CatalogReadModel;
use App\Modules\Products\Application\Contracts\ProductDirectory;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

class ReadModelStorefrontCatalog implements StorefrontCatalog
{
    public function __construct(
        private readonly CatalogReadModel $catalog,
        private readonly BrowseCatalog $browse,
        private readonly CatalogNavigation $navigation,
        private readonly ProductDirectory $products,
        private readonly StockLevels $stock,
        private readonly ProductPage $productPage,
    ) {}

    public function productCards(array $productIds): array
    {
        return $this->browse->cards($productIds);
    }

    public function productDetails(array $productIds, bool $preview = false): array
    {
        return $this->productPage->details($productIds, $preview);
    }

    public function liveProductIds(): array
    {
        return array_values(array_map(fn (array $record) => (string) $record['id'], $this->catalog->products()));
    }

    public function sourceProductCards(string $source, ?string $categoryId, int $limit): array
    {
        return $this->browse->sourceCards($source, $categoryId, $limit);
    }

    public function hotDealCards(?string $promotionId, int $limit): array
    {
        return $this->browse->hotDealCards($promotionId, $limit);
    }

    public function categoryStrip(?array $categoryIds, int $limit): array
    {
        return $this->navigation->categoryStrip($categoryIds, $limit);
    }

    public function brandStrip(?array $brandIds, int $limit): array
    {
        return $this->navigation->brandStrip($brandIds, $limit);
    }

    public function visibleCategories(array $categoryIds): array
    {
        return $this->navigation->visibleCategories($categoryIds);
    }

    public function visibleBrands(array $brandIds): array
    {
        return $this->navigation->visibleBrands($brandIds);
    }

    public function existing(string $type, array $ids): array
    {
        if ($ids === []) {
            return [];
        }

        $table = match ($type) {
            'product' => 'products',
            'category' => 'categories',
            'brand' => 'brands',
        };

        return DB::table($table)
            ->where('organization_id', $this->catalog->organizationId())
            ->whereIn('id', array_values(array_unique($ids)))
            ->when($type === 'product', fn ($q) => $q->whereNull('deleted_at'))
            ->pluck('id')->all();
    }

    public function linkTargets(): array
    {
        $tree = $this->catalog->categoryTree();
        $listings = $this->catalog->categoryListings();
        $brands = $this->catalog->visibleBrands();

        return [
            'categories' => array_map(fn (array $c) => [
                'id' => $c['id'],
                'name' => $c['name'],
                'url' => $tree->isVisible($c['id']) ? '/category/'.$listings[$c['id']]->slug : null,
                'parent_id' => $c['parent_id'],
                'depth' => $c['depth'],
            ], $tree->flatten()),
            'brands' => array_map(fn (array $b) => [
                'id' => $b['id'],
                'name' => $b['name'],
                'url' => isset($brands[$b['id']]) ? '/brand/'.$brands[$b['id']]['slug'] : null,
            ], array_values($this->catalog->brands())),
        ];
    }

    public function itemSummaries(string $type, array $ids): array
    {
        $ids = array_values(array_unique($ids));
        if ($ids === []) {
            return [];
        }

        $result = [];
        if ($type === 'product') {
            foreach ($this->catalog->adminProducts($ids) as $id => $p) {
                $result[$id] = ['id' => $id, 'name' => $p['name'], 'image_url' => $p['images'][0]['url'] ?? null];
            }
        } elseif ($type === 'category') {
            foreach ($ids as $id) {
                if (($node = $this->catalog->categoryTree()->node($id)) !== null) {
                    $result[$id] = ['id' => $id, 'name' => $node['name'], 'image_url' => null];
                }
            }
        } elseif ($type === 'brand') {
            foreach ($ids as $id) {
                if (($brand = $this->catalog->brands()[$id] ?? null) !== null) {
                    $result[$id] = ['id' => $id, 'name' => $brand['name'], 'image_url' => null];
                }
            }
        }

        return $result;
    }

    public function variantsForCart(array $variantIds): array
    {
        $variantIds = array_values(array_unique($variantIds));
        if ($variantIds === []) {
            return [];
        }

        $organizationId = $this->catalog->organizationId();
        $info = $this->products->variants($organizationId, $variantIds);
        if ($info === []) {
            return [];
        }

        $records = array_column($this->catalog->products([
            'ids' => array_values(array_unique(array_column($info, 'product_id'))),
            'live' => false,
            'include_inactive_variants' => true,
        ]), null, 'id');

        $tracked = [];
        foreach ($info as $id => $v) {
            $variant = $this->recordVariant($records[$v['product_id']] ?? null, $id);
            if ($variant['tracked'] ?? $v['track_stock']) {
                $tracked[] = $id;
            }
        }
        $store = $this->catalog->fulfilmentStoreId();
        $onHand = $store === null || $tracked === [] ? [] : $this->stock->onHand($store, $tracked);

        $result = [];
        foreach ($info as $id => $v) {
            $record = $records[$v['product_id']] ?? null;
            $variant = $this->recordVariant($record, $id);
            $isTracked = in_array($id, $tracked, true);
            $live = $record !== null && $record['is_active'] && $record['listing']->state() === ListingState::Live;
            $max = $isTracked ? Decimal::round($onHand[$id] ?? '0', 3) : null;
            if ($max !== null && Decimal::isNegative($max)) {
                $max = '0.000';
            }

            $image = null;
            if ($record !== null) {
                $images = array_column($record['images'], null, 'id');
                $picked = ($variant['image_id'] ?? null) !== null ? ($images[$variant['image_id']] ?? null) : null;
                $picked ??= $record['images'][0] ?? null;
                $image = $picked === null ? null : ['url' => $picked['url'], 'alt' => $record['name']];
            }
            $optionValues = $variant['option_values'] ?? [];
            $name = $variant['name'] ?? null;

            $result[$id] = [
                'variant_id' => $id,
                'product_id' => $v['product_id'],
                'brand_id' => $record['brand_id'] ?? null,
                'category_id' => $record['category_id'] ?? ($v['category_id'] ?? null),
                'product_slug' => $record === null ? null : $record['listing']->slug,
                // E12b: the listing's name in the request's language (orders snapshot the base name).
                'product_name' => $record['name'] ?? $v['product_name'],
                'variant_name' => is_string($name) && $name !== '' ? $name : ($optionValues !== [] ? implode(' / ', $optionValues) : null),
                'option_values' => $optionValues,
                'sku' => $v['sku'],
                'image' => $image,
                'price' => $variant['price'] ?? Decimal::round((string) $v['selling_price'], 2),
                'compare_at_price' => $variant['compare_at_price'] ?? null,
                'purchasable' => $v['sellable'] && $live && $variant !== null && $variant['is_active'],
                'in_stock' => $max === null || Decimal::compare($max, '0') > 0,
                'max_quantity' => $max,
                'allow_decimal' => $v['allow_decimal'],
                'tax_rate' => Decimal::round($v['tax_rate'] ?? '0', 4),
            ];
        }

        return $result;
    }

    /**
     * @param  array<string, mixed>|null  $record
     * @return array<string, mixed>|null
     */
    private function recordVariant(?array $record, string $variantId): ?array
    {
        foreach ($record['variants'] ?? [] as $variant) {
            if ($variant['id'] === $variantId) {
                return $variant;
            }
        }

        return null;
    }

    public function liveProductId(string $slug): ?string
    {
        return $this->catalog->products(['slug' => $slug])[0]['id'] ?? null;
    }

    public function productSummaries(array $productIds): array
    {
        $productIds = array_values(array_unique($productIds));
        if ($productIds === []) {
            return [];
        }

        $slugs = [];
        $names = [];
        foreach ($this->catalog->products(['ids' => $productIds]) as $record) {
            $slugs[$record['id']] = $record['listing']->slug;
            // E12b: live products show their name in the request's language.
            $names[$record['id']] = $record['name'];
        }
        $images = $this->catalog->images($productIds);

        return DB::table('products')
            ->where('organization_id', $this->catalog->organizationId())
            ->whereIn('id', $productIds)
            ->get(['id', 'name'])
            ->mapWithKeys(fn ($p) => [$p->id => [
                'id' => $p->id,
                'name' => $names[$p->id] ?? $p->name,
                'slug' => $slugs[$p->id] ?? null,
                'image_url' => $images[$p->id][0]['url'] ?? null,
            ]])->all();
    }

    public function pageMeta(string $type, string $slug): ?array
    {
        $meta = $this->navigation->meta($type, $slug);
        if ($meta !== null && $type === 'product' && ($product = $this->productPage->structuredData($slug)) !== null) {
            $meta['breadcrumbs'] = $product['breadcrumbs'];
            $meta['product'] = $product;
        }

        return $meta;
    }

    public function nextScheduledChange(): ?CarbonImmutable
    {
        return $this->catalog->nextScheduledChange();
    }

    public function latestProductSlug(?string $categoryId = null): ?string
    {
        return $this->catalog->latestProductSlug($categoryId);
    }

    public function pageSample(string $type, ?string $idOrSlug): ?array
    {
        return $this->navigation->pageSample($type, $idOrSlug);
    }

    public function listing(array $params): array
    {
        return $this->browse->search($params);
    }

    public function sitemapEntries(string $type): array
    {
        return match ($type) {
            'product' => $this->catalog->sitemapProducts(),
            'category' => $this->navigation->sitemapCategories(),
            'brand' => $this->navigation->sitemapBrands(),
        };
    }

    public function portableReferences(string $type, array $ids): array
    {
        $ids = array_values(array_unique(array_filter($ids, 'is_string')));
        if ($ids === []) {
            return [];
        }
        $organizationId = $this->catalog->organizationId();
        [$table, $listings, $key] = self::portableTables($type);
        $rows = DB::table($table)->where("{$table}.organization_id", $organizationId)->whereIn("{$table}.id", $ids)
            ->when($type === 'product', fn ($q) => $q->whereNull("{$table}.deleted_at"))
            ->leftJoin($listings, "{$listings}.{$key}", '=', "{$table}.id")
            ->get(["{$table}.id", "{$table}.name", "{$listings}.slug"]);
        $skus = $type !== 'product' ? [] : DB::table('product_variants')->where('organization_id', $organizationId)
            ->whereIn('product_id', $ids)->whereNull('deleted_at')->orderBy('sort_order')->orderBy('created_at')
            ->get(['product_id', 'sku'])->groupBy('product_id')->map(fn ($v) => $v->first()->sku)->all();

        $result = [];
        foreach ($rows as $row) {
            $result[$row->id] = ['sku' => $skus[$row->id] ?? null, 'slug' => $row->slug, 'name' => (string) $row->name];
        }

        return $result;
    }

    public function findPortable(string $type, ?string $sku, ?string $slug, ?string $name): ?string
    {
        $organizationId = $this->catalog->organizationId();
        [$table, $listings, $key] = self::portableTables($type);
        if ($type === 'product' && is_string($sku) && $sku !== '') {
            $id = DB::table('product_variants')->join('products', 'products.id', '=', 'product_variants.product_id')
                ->where('product_variants.organization_id', $organizationId)->whereNull('product_variants.deleted_at')->whereNull('products.deleted_at')
                ->whereRaw('lower(product_variants.sku) = ?', [mb_strtolower($sku)])->orderBy('product_variants.sort_order')->value('products.id');
            if (is_string($id)) {
                return $id;
            }
        }
        if (is_string($slug) && $slug !== '') {
            $id = DB::table($listings)->join($table, "{$table}.id", '=', "{$listings}.{$key}")
                ->where("{$listings}.organization_id", $organizationId)->where("{$listings}.slug", mb_strtolower($slug))
                ->when($type === 'product', fn ($q) => $q->whereNull("{$table}.deleted_at"))->value("{$table}.id");
            if (is_string($id)) {
                return $id;
            }
        }
        if ($type !== 'product' && is_string($name) && trim($name) !== '') {
            $id = DB::table($table)->where('organization_id', $organizationId)->whereRaw('lower(name) = ?', [mb_strtolower(trim($name))])->orderBy('id')->value('id');

            return is_string($id) ? $id : null;
        }

        return null;
    }

    /**
     * @return array{0: string, 1: string, 2: string} the record table, its listing table and the listing's key
     */
    private static function portableTables(string $type): array
    {
        return match ($type) {
            'product' => ['products', 'product_listings', 'product_id'],
            'category' => ['categories', 'category_listings', 'category_id'],
            'brand' => ['brands', 'brand_listings', 'brand_id'],
        };
    }
}
