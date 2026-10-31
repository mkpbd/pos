<?php

namespace App\Modules\OnlineCatalog\Application\Queries;

use App\Modules\Catalog\Application\Contracts\CatalogDirectory;
use App\Modules\OnlineCatalog\Domain\CatalogItem;
use App\Modules\OnlineCatalog\Domain\CatalogSort;
use App\Modules\OnlineCatalog\Domain\Pricing;
use App\Modules\OnlineCatalog\Infrastructure\Models\ProductListing;
use App\Modules\OnlineCatalog\Infrastructure\Models\RelatedProduct;
use App\Modules\OnlineCatalog\Infrastructure\ReadModels\CatalogReadModel;
use Illuminate\Database\Eloquent\ModelNotFoundException;

/**
 * The product page and its recommendations. Shoppers only see live products; staff
 * previews (`$preview`) also open drafts, scheduled and ended listings.
 */
class ProductPage
{
    public const RELATED_FALLBACK = 8;

    public function __construct(
        private readonly CatalogReadModel $catalog,
        private readonly CatalogDirectory $directory,
        private readonly BrowseCatalog $browse,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function show(string $slug, bool $preview = false): array
    {
        $record = $this->find($slug, $preview);
        /** @var ProductListing $listing */
        $listing = $record['listing'];
        $variants = $this->catalog->activeVariants($record);
        $pricing = Pricing::summary($variants === [] ? [['price' => '0.00', 'compare_at_price' => null]] : $variants);

        $default = null;
        foreach ($variants as $variant) {
            if ($variant['in_stock']) {
                $default = $variant['id'];
                break;
            }
        }
        $default ??= $variants[0]['id'] ?? null;

        $unitInfo = $record['unit_id'] === null ? null
            : ($this->directory->describe($this->catalog->organizationId(), ['units' => [$record['unit_id']]])['units'][$record['unit_id']] ?? null);
        $unit = $unitInfo['code'] ?? null;

        $data = [
            'id' => $record['id'],
            'slug' => $listing->slug,
            'name' => $record['name'],
            'url' => '/product/'.$listing->slug,
            'short_description' => $listing->short_description,
            'description_html' => $listing->description_html,
            'specifications' => array_values($listing->specifications ?? []),
            'brand' => $this->catalog->brandLink($record['brand_id']),
            'category' => $this->catalog->categoryLink($record['category_id']),
            'breadcrumbs' => [
                ['name' => 'Home', 'url' => '/'],
                ...$this->categoryCrumbs($record['category_id']),
                ['name' => $record['name'], 'url' => null],
            ],
            'images' => array_map(fn (array $i) => ['id' => $i['id'], 'url' => $i['url'], 'alt' => $record['name']], $record['images']),
            'options' => $this->options($record),
            'variants' => array_map(fn (array $v) => [
                'id' => $v['id'],
                'sku' => $v['sku'],
                'name' => $this->variantName($record, $v),
                'option_values' => (object) $v['option_values'],
                'price' => $v['price'],
                'compare_at_price' => $v['compare_at_price'],
                'on_sale' => $v['compare_at_price'] !== null,
                'discount_percent' => Pricing::discountPercent($v['price'], $v['compare_at_price']),
                // Unit price after the automatic promotion (E8b), null when none applies.
                'promo_price' => $this->catalog->promotion($record, $v['price'])['price'] ?? null,
                'in_stock' => $v['in_stock'],
                'low_stock' => $v['low_stock'],
                'image_id' => $v['image_id'],
            ], $variants),
            'price' => $pricing['price'],
            'price_max' => $pricing['price_max'],
            'on_sale' => $pricing['on_sale'],
            'promotion' => $variants === [] ? null : $this->catalog->promotion($record, $pricing['price']),
            'in_stock' => $this->catalog->inStock($record),
            'is_new' => $this->catalog->isNew($listing),
            'default_variant_id' => $default,
            'unit' => $unit,
            // Quantities may have up to 3 decimals (kg, litre) instead of whole units.
            'allow_decimal' => (bool) ($unitInfo['allow_decimal'] ?? false),
            'seo' => [
                'title' => $listing->seo_title ?? $record['name'],
                'description' => $listing->seo_description ?? $listing->short_description,
                'image_url' => $record['images'][0]['url'] ?? null,
            ],
        ];
        if ($preview) {
            $data['preview_state'] = $listing->state()->value;
        }

        return $data;
    }

    /**
     * Hand-picked related and frequently-bought-together products (live only, in order).
     * Without live related picks, up to eight other products of the same category follow,
     * newest first; frequently bought has no fallback.
     *
     * @return array{related: list<array<string, mixed>>, frequently_bought: list<array<string, mixed>>}
     */
    public function related(string $slug, bool $preview = false): array
    {
        $record = $this->find($slug, $preview);
        $picks = RelatedProduct::query()->withoutGlobalScope('organization')
            ->where('organization_id', $this->catalog->organizationId())
            ->where('product_id', $record['id'])
            ->orderBy('sort_order')->get()->groupBy('kind');

        $related = $this->browse->cards(($picks['related'] ?? collect())->pluck('related_product_id')->all());
        if ($related === [] && $record['category_id'] !== null) {
            $items = [];
            $byId = [];
            foreach ($this->catalog->products(['category_ids' => [$record['category_id']]]) as $candidate) {
                if ($candidate['id'] !== $record['id']) {
                    $byId[$candidate['id']] = $candidate;
                    $items[] = $this->catalog->item($candidate);
                }
            }
            $related = array_map(
                fn (CatalogItem $i) => $this->catalog->card($byId[$i->id]),
                array_slice(CatalogSort::Latest->sort($items), 0, self::RELATED_FALLBACK),
            );
        }

        return [
            'related' => $related,
            'frequently_bought' => $this->browse->cards(($picks['frequently_bought'] ?? collect())->pluck('related_product_id')->all()),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function find(string $slug, bool $preview): array
    {
        return $this->catalog->products(['slug' => $slug, 'live' => ! $preview])[0]
            ?? throw (new ModelNotFoundException)->setModel(ProductListing::class);
    }

    /**
     * @return list<array{name: string, url: string}>
     */
    private function categoryCrumbs(?string $categoryId): array
    {
        $tree = $this->catalog->categoryTree();
        if ($categoryId === null || ! $tree->has($categoryId)) {
            return [];
        }

        $ids = $tree->visibleAncestors($categoryId);
        if ($tree->isVisible($categoryId)) {
            $ids[] = $categoryId;
        }

        return array_map(fn (string $id) => [
            'name' => $tree->node($id)['name'],
            'url' => '/category/'.$this->catalog->categoryListings()[$id]->slug,
        ], $ids);
    }

    /**
     * The product's options with the values its active variants use. A linked attribute
     * gives the slug, display and value order (dictionary order, unknown values after).
     *
     * @param  array<string, mixed>  $record
     * @return list<array{name: string, slug: ?string, display: string, values: list<array{value: string, swatch_hex: ?string}>}>
     */
    private function options(array $record): array
    {
        $attributes = [];
        foreach ($this->catalog->attributes() as $attribute) {
            $attributes[mb_strtolower($attribute['name'])] = $attribute;
        }

        $result = [];
        foreach ($record['options'] as $option) {
            $name = (string) ($option['name'] ?? '');
            $used = [];
            foreach ($this->catalog->activeVariants($record) as $variant) {
                foreach ($variant['option_values'] as $key => $value) {
                    if (mb_strtolower((string) $key) === mb_strtolower($name)) {
                        $used[mb_strtolower((string) $value)] = true;
                    }
                }
            }
            $values = array_values(array_filter((array) ($option['values'] ?? []), fn ($v) => isset($used[mb_strtolower((string) $v)])));

            $attribute = $attributes[mb_strtolower($name)] ?? null;
            $swatches = [];
            if ($attribute !== null) {
                $order = [];
                foreach ($attribute['values'] as $position => $known) {
                    $order[mb_strtolower($known['value'])] = $position;
                    $swatches[mb_strtolower($known['value'])] = $known['swatch_hex'];
                }
                $fallback = count($order);
                $indexed = array_map(null, $values, array_keys($values));
                usort($indexed, fn (array $a, array $b) => [$order[mb_strtolower($a[0])] ?? $fallback, $a[1]] <=> [$order[mb_strtolower($b[0])] ?? $fallback, $b[1]]);
                $values = array_column($indexed, 0);
            }

            $result[] = [
                'name' => $name,
                'slug' => $attribute['slug'] ?? null,
                'display' => $attribute['display'] ?? 'button',
                'values' => array_map(fn (string $v) => ['value' => $v, 'swatch_hex' => $swatches[mb_strtolower($v)] ?? null], $values),
            ];
        }

        return $result;
    }

    /**
     * @param  array<string, mixed>  $record
     * @param  array<string, mixed>  $variant
     */
    private function variantName(array $record, array $variant): string
    {
        if (is_string($variant['name']) && $variant['name'] !== '') {
            return $variant['name'];
        }

        return $variant['option_values'] !== [] ? implode(' / ', array_values($variant['option_values'])) : $record['name'];
    }
}
