<?php

namespace App\Modules\OnlineCatalog\Infrastructure;

use App\Modules\OnlineCatalog\Application\Contracts\StorefrontCatalog;
use App\Modules\OnlineCatalog\Application\Queries\BrowseCatalog;
use App\Modules\OnlineCatalog\Application\Queries\CatalogNavigation;
use App\Modules\OnlineCatalog\Infrastructure\ReadModels\CatalogReadModel;
use Illuminate\Support\Facades\DB;

class ReadModelStorefrontCatalog implements StorefrontCatalog
{
    public function __construct(
        private readonly CatalogReadModel $catalog,
        private readonly BrowseCatalog $browse,
        private readonly CatalogNavigation $navigation,
    ) {}

    public function productCards(array $productIds): array
    {
        return $this->browse->cards($productIds);
    }

    public function sourceProductCards(string $source, ?string $categoryId, int $limit): array
    {
        return $this->browse->sourceCards($source, $categoryId, $limit);
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

    public function pageMeta(string $type, string $slug): ?array
    {
        return $this->navigation->meta($type, $slug);
    }
}
