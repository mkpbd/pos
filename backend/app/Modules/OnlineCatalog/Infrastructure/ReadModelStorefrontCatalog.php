<?php

namespace App\Modules\OnlineCatalog\Infrastructure;

use App\Modules\Inventory\Application\Contracts\StockLevels;
use App\Modules\OnlineCatalog\Application\Contracts\StorefrontCatalog;
use App\Modules\OnlineCatalog\Application\Queries\BrowseCatalog;
use App\Modules\OnlineCatalog\Application\Queries\CatalogNavigation;
use App\Modules\OnlineCatalog\Domain\ListingState;
use App\Modules\OnlineCatalog\Infrastructure\ReadModels\CatalogReadModel;
use App\Modules\Products\Application\Contracts\ProductDirectory;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Illuminate\Support\Facades\DB;

class ReadModelStorefrontCatalog implements StorefrontCatalog
{
    public function __construct(
        private readonly CatalogReadModel $catalog,
        private readonly BrowseCatalog $browse,
        private readonly CatalogNavigation $navigation,
        private readonly ProductDirectory $products,
        private readonly StockLevels $stock,
    ) {}

    public function productCards(array $productIds): array
    {
        return $this->browse->cards($productIds);
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
                $image = $picked === null ? null : ['url' => $picked['url'], 'alt' => $v['product_name']];
            }
            $optionValues = $variant['option_values'] ?? [];
            $name = $variant['name'] ?? null;

            $result[$id] = [
                'variant_id' => $id,
                'product_id' => $v['product_id'],
                'brand_id' => $record['brand_id'] ?? null,
                'category_id' => $record['category_id'] ?? ($v['category_id'] ?? null),
                'product_slug' => $record === null ? null : $record['listing']->slug,
                'product_name' => $v['product_name'],
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

    public function pageMeta(string $type, string $slug): ?array
    {
        return $this->navigation->meta($type, $slug);
    }
}
