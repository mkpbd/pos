<?php

namespace App\Modules\OnlineCatalog\Infrastructure;

use App\Modules\OnlineCatalog\Application\Contracts\CatalogFeed;
use App\Modules\OnlineCatalog\Domain\CategoryTree;
use App\Modules\OnlineCatalog\Infrastructure\Models\ProductListing;
use App\Modules\OnlineCatalog\Infrastructure\ReadModels\CatalogReadModel;
use App\Modules\Shared\Domain\PlainText;
use App\Modules\Shared\Domain\Translations;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Illuminate\Contracts\Container\Container;

/**
 * P2b: product-feed items from the storefront's live candidate set (CatalogReadModel, cached per
 * content version) — the same products, prices, promotions and stock flags shoppers see.
 */
class ReadModelCatalogFeed implements CatalogFeed
{
    /** Option names read as the colour / size of a variant (lower case). */
    private const COLOR_OPTIONS = ['color', 'colour', 'রং', 'রঙ'];

    private const SIZE_OPTIONS = ['size', 'সাইজ', 'মাপ'];

    private const TITLE_MAX = 150;

    private const DESCRIPTION_MAX = 5000;

    public function __construct(private readonly Container $container) {}

    public function items(int $limit = self::MAX_ITEMS): iterable
    {
        // A fresh read model: it caches names in the language it was first used in.
        $catalog = $this->container->make(CatalogReadModel::class);
        $locale = $catalog->locale();
        $tree = $catalog->categoryTree();
        $brands = $catalog->brands();
        $records = $catalog->products();
        usort($records, fn (array $a, array $b) => [mb_strtolower($a['name']), $a['id']] <=> [mb_strtolower($b['name']), $b['id']]);

        $count = 0;
        foreach ($records as $record) {
            $variants = $catalog->activeVariants($record);
            if ($variants === []) {
                continue;
            }
            /** @var ProductListing $listing */
            $listing = $record['listing'];
            $text = Translations::pickMany($listing, ['short_description', 'description_html'], $locale);
            $several = count($variants) > 1;
            $brand = $record['brand_id'] === null ? null : ($brands[$record['brand_id']]['name'] ?? null);
            $productType = $this->categoryPath($tree, $record['category_id']);
            $images = array_column($record['images'], 'url', 'id');

            foreach ($variants as $variant) {
                if ($count >= $limit) {
                    return;
                }
                $label = CatalogReadModel::variantLabel($record['name'], $variant);
                $title = mb_substr($several && $label !== $record['name'] ? $record['name'].' - '.$label : $record['name'], 0, self::TITLE_MAX);
                $description = PlainText::excerpt($text['description_html'] ?? null, self::DESCRIPTION_MAX)
                    ?? PlainText::excerpt($text['short_description'] ?? null, self::DESCRIPTION_MAX)
                    ?? $title;

                $promotion = $catalog->promotion($record, $variant['price']);
                $regular = $variant['compare_at_price'] ?? $variant['price'];
                $current = $promotion['price'] ?? $variant['price'];
                $onSale = Decimal::compare($current, $regular) < 0;

                yield [
                    'id' => is_string($variant['sku']) && trim($variant['sku']) !== '' ? trim($variant['sku']) : $variant['id'],
                    'variant_id' => $variant['id'],
                    'item_group_id' => $several ? $record['id'] : null,
                    'title' => $title,
                    'description' => $description,
                    'path' => '/product/'.$listing->slug.($several ? '?variant='.$variant['id'] : ''),
                    'image_urls' => $this->imageUrls($record, $variant, $images),
                    'in_stock' => (bool) $variant['in_stock'],
                    'price' => $regular,
                    'sale_price' => $onSale ? $current : null,
                    'sale_ends_at' => $onSale && $promotion !== null ? ($promotion['ends_at'] ?? null) : null,
                    'brand' => $brand,
                    'product_type' => $productType,
                    'color' => $this->option($variant['option_values'], self::COLOR_OPTIONS),
                    'size' => $this->option($variant['option_values'], self::SIZE_OPTIONS),
                ];
                $count++;
            }
        }
    }

    /**
     * The variant's photo first (its own, else the first photo of its photo-option value), then
     * the product's other photos; at most 1 + MAX_ADDITIONAL_IMAGES.
     *
     * @param  array<string, mixed>  $record
     * @param  array<string, mixed>  $variant
     * @param  array<string, string>  $images  url by image id, in gallery order
     * @return list<string>
     */
    private function imageUrls(array $record, array $variant, array $images): array
    {
        $first = is_string($variant['image_id'] ?? null) && isset($images[$variant['image_id']]) ? $variant['image_id'] : null;
        $photoOption = mb_strtolower((string) ($record['photo_option'] ?? ''));
        if ($first === null && $photoOption !== '') {
            foreach ($variant['option_values'] as $name => $value) {
                if (mb_strtolower((string) $name) !== $photoOption) {
                    continue;
                }
                foreach ($record['option_images'][$photoOption][mb_strtolower((string) $value)] ?? [] as $id) {
                    if (isset($images[$id])) {
                        $first = $id;
                        break 2;
                    }
                }
            }
        }
        $ordered = $first === null ? $images : [$first => $images[$first]] + $images;

        return array_slice(array_values($ordered), 0, 1 + self::MAX_ADDITIONAL_IMAGES);
    }

    /**
     * "Parent > Child" names of the category and its ancestors, or null.
     */
    private function categoryPath(CategoryTree $tree, ?string $categoryId): ?string
    {
        if ($categoryId === null || ! $tree->has($categoryId)) {
            return null;
        }
        $names = array_map(fn (string $id) => (string) ($tree->node($id)['name'] ?? ''), array_reverse($tree->selfAndAncestors($categoryId)));

        return implode(' > ', array_filter($names, fn (string $n) => $n !== ''));
    }

    /**
     * @param  array<string, string>  $values
     * @param  list<string>  $names
     */
    private function option(array $values, array $names): ?string
    {
        foreach ($values as $name => $value) {
            if (in_array(mb_strtolower(trim((string) $name)), $names, true) && trim((string) $value) !== '') {
                return trim((string) $value);
            }
        }

        return null;
    }
}
