<?php

namespace App\Modules\OnlineCatalog\Application\Queries;

use App\Modules\Catalog\Application\Contracts\CatalogDirectory;
use App\Modules\OnlineCatalog\Application\Contracts\ProductPageZones;
use App\Modules\OnlineCatalog\Application\Contracts\ProductQuestionCounts;
use App\Modules\OnlineCatalog\Application\Contracts\ProductRatings;
use App\Modules\OnlineCatalog\Domain\CatalogItem;
use App\Modules\OnlineCatalog\Domain\CatalogSort;
use App\Modules\OnlineCatalog\Domain\CoPurchaseCounter;
use App\Modules\OnlineCatalog\Domain\Pricing;
use App\Modules\OnlineCatalog\Infrastructure\Models\ProductListing;
use App\Modules\OnlineCatalog\Infrastructure\Models\RelatedProduct;
use App\Modules\OnlineCatalog\Infrastructure\ReadModels\CatalogReadModel;
use App\Modules\OnlineCatalog\Infrastructure\ReadModels\ProductAffinityProjection;
use App\Modules\Shared\Application\Localization\FixedText;
use App\Modules\Shared\Domain\PlainText;
use App\Modules\Shared\Domain\Translations;
use Illuminate\Database\Eloquent\ModelNotFoundException;

/**
 * The product page and its recommendations. Shoppers only see live products; staff
 * previews (`$preview`) also open drafts, scheduled and ended listings.
 *
 * E12b: name, descriptions, SEO texts and breadcrumbs in the request's language (each
 * field falls back to its base text).
 */
class ProductPage
{
    public const RELATED_FALLBACK = 8;

    /** P1b: automatic "frequently bought together" — the product plus up to this many others. */
    public const FREQUENTLY_BOUGHT_AUTOMATIC = 4;

    /** Product descriptions in structured data are cut to this many characters. */
    public const STRUCTURED_DESCRIPTION_LENGTH = 5000;

    public function __construct(
        private readonly CatalogReadModel $catalog,
        private readonly CatalogDirectory $directory,
        private readonly BrowseCatalog $browse,
        private readonly ProductRatings $ratings,
        private readonly SizeGuides $sizeGuides,
        private readonly DeliveryNote $delivery,
        private readonly ProductQuestionCounts $questions,
        private readonly ProductAffinityProjection $affinities,
    ) {}

    /**
     * P1b: resolved on use — the builder's implementation reaches back into the catalog (its
     * elements read product cards through StorefrontCatalog, which builds this class).
     */
    private function zones(): ProductPageZones
    {
        return app(ProductPageZones::class);
    }

    /**
     * P1a: the photo option's name as the product defines it, or null.
     *
     * @param  array<string, mixed>  $record
     */
    private function photoOption(array $record): ?string
    {
        $photoOption = mb_strtolower((string) ($record['photo_option'] ?? ''));
        foreach ($record['options'] as $option) {
            if ($photoOption !== '' && mb_strtolower((string) ($option['name'] ?? '')) === $photoOption) {
                return (string) $option['name'];
            }
        }

        return null;
    }

    /**
     * P1a: a variant without its own image shows the first photo of its photo-option value.
     *
     * @param  array<string, mixed>  $record
     * @param  array<string, mixed>  $variant
     */
    private function firstOptionPhoto(array $record, array $variant): ?string
    {
        $photoOption = mb_strtolower((string) ($record['photo_option'] ?? ''));
        if ($photoOption === '') {
            return null;
        }
        $imageIds = array_column($record['images'], 'id');
        foreach ($variant['option_values'] as $name => $value) {
            if (mb_strtolower((string) $name) === $photoOption) {
                foreach ($record['option_images'][$photoOption][mb_strtolower((string) $value)] ?? [] as $id) {
                    if (in_array($id, $imageIds, true)) {
                        return $id;
                    }
                }
            }
        }

        return null;
    }

    /**
     * The product page. P1b adds what only the page itself shows (not the builder's product
     * spotlight, so a zone can never contain itself): the store's `delivery` note, the builder
     * `zones` resolved for this product (product → nearest category → all products; `$draftZones`
     * for a staff draft preview) and the published `questions_count`.
     *
     * @return array<string, mixed>
     */
    public function show(string $slug, bool $preview = false, bool $draftZones = false): array
    {
        $record = $this->find($slug, $preview);
        $data = $this->detail($record, $preview);
        // {options: [{zone, method, min_days, max_days, fee, free_over}], cod_available} | null.
        $data['delivery'] = $this->delivery->current();
        // {"product.below_price": page|null, "product.after": page|null, "product.bottom": page|null}.
        $data['zones'] = $this->zones()->forProduct($record['id'], $this->categoryChain($record['category_id']), $draftZones);
        $data['questions_count'] = $this->questions->publishedCount($record['id']);

        return $data;
    }

    /**
     * P1b: the product's category and its ancestors, nearest first ([] without a category).
     *
     * @return list<string>
     */
    private function categoryChain(?string $categoryId): array
    {
        return $categoryId === null ? [] : $this->catalog->categoryTree()->selfAndAncestors($categoryId);
    }

    /**
     * B6: the product page objects of several products (live ones; `$preview` also drafts,
     * scheduled and ended listings), keyed by product id in the given order — the store
     * builder's product spotlight.
     *
     * @param  list<string>  $productIds
     * @return array<string, array<string, mixed>>
     */
    public function details(array $productIds, bool $preview = false): array
    {
        $productIds = array_values(array_unique($productIds));
        if ($productIds === []) {
            return [];
        }
        $records = array_column($this->catalog->products(['ids' => $productIds, 'live' => ! $preview]), null, 'id');

        $result = [];
        foreach ($productIds as $id) {
            if (isset($records[$id])) {
                $result[$id] = $this->detail($records[$id], $preview);
            }
        }

        return $result;
    }

    /**
     * @param  array<string, mixed>  $record
     * @return array<string, mixed>
     */
    private function detail(array $record, bool $preview): array
    {
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
        $text = $this->texts($listing);

        $data = [
            'id' => $record['id'],
            'slug' => $listing->slug,
            'name' => $record['name'],
            'url' => '/product/'.$listing->slug,
            'short_description' => $text['short_description'],
            'description_html' => $text['description_html'],
            'specifications' => array_values($listing->specifications ?? []),
            'brand' => $this->catalog->brandLink($record['brand_id']),
            'category' => $this->catalog->categoryLink($record['category_id']),
            'breadcrumbs' => [
                ['name' => FixedText::get('Home', $this->catalog->locale()), 'url' => '/'],
                ...$this->categoryCrumbs($record['category_id']),
                ['name' => $record['name'], 'url' => null],
            ],
            'images' => array_map(fn (array $i) => ['id' => $i['id'], 'url' => $i['url'], 'alt' => $record['name']], $record['images']),
            // P1a: display button|swatch|image|text; values carry swatch_hex, image (first photo) and image_ids.
            'options' => $this->catalog->productOptions($record),
            'photo_option' => $this->photoOption($record),
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
                // P1a: whole units left when few are left (at or below the low-stock threshold), else null.
                'stock_left' => $v['stock_left'] ?? null,
                'image_id' => $v['image_id'] ?? $this->firstOptionPhoto($record, $v),
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
            // Approved reviews (E9): {average: "4.5", count: 12}, null without any.
            'rating' => $this->ratings->summary($record['id']),
            // P1a: the listing's own size guide, else its category's (nearest ancestor), localized.
            'size_guide' => $this->sizeGuides->forProduct($listing->size_guide_id, $record['category_id']),
            // P1b: the gallery's video {provider, id, url} (YouTube / Vimeo) and custom badges [{text, tone}].
            'video' => $this->catalog->video($listing),
            'badges' => $this->catalog->badges($listing),
            'seo' => [
                'title' => $text['seo_title'] ?? $record['name'],
                'description' => $text['seo_description'] ?? $text['short_description'],
                'image_url' => $record['images'][0]['url'] ?? null,
            ],
        ];
        if ($preview) {
            $data['preview_state'] = $listing->state()->value;
        }

        return $data;
    }

    /**
     * What the HTML shell writes as schema.org `Product` data (E12) for a live product, or
     * null: plain-text description (≤ 5000 characters), images, brand, category breadcrumbs,
     * one offer per active variant with the price a shopper pays now (the automatic
     * promotion's price and its end when one applies), availability from storefront stock,
     * and the approved-review rating.
     *
     * @return array{name: string, url: string, description: ?string, sku: ?string, images: list<string>, brand: ?string, breadcrumbs: list<array{name: string, url: string}>, offers: list<array{sku: string, name: string, price: string, price_valid_until: ?string, availability: string}>, rating: array{average: string, count: int}|null}|null
     */
    public function structuredData(string $slug): ?array
    {
        $record = $this->catalog->products(['slug' => $slug])[0] ?? null;
        if ($record === null) {
            return null;
        }
        /** @var ProductListing $listing */
        $listing = $record['listing'];
        $variants = $this->catalog->activeVariants($record);
        $url = '/product/'.$listing->slug;
        $text = $this->texts($listing);

        return [
            'name' => $record['name'],
            'url' => $url,
            'description' => PlainText::excerpt($text['description_html'] ?? $text['short_description'], self::STRUCTURED_DESCRIPTION_LENGTH),
            'sku' => count($variants) === 1 ? $variants[0]['sku'] : null,
            'images' => array_column($record['images'], 'url'),
            'brand' => $this->catalog->brandLink($record['brand_id'])['name'] ?? null,
            'breadcrumbs' => [
                ['name' => FixedText::get('Home', $this->catalog->locale()), 'url' => '/'],
                ...$this->categoryCrumbs($record['category_id']),
                ['name' => $record['name'], 'url' => $url],
            ],
            'offers' => array_map(function (array $v) use ($record) {
                $promotion = $this->catalog->promotion($record, $v['price']);

                return [
                    'sku' => $v['sku'],
                    'name' => $this->variantName($record, $v),
                    'price' => $promotion['price'] ?? $v['price'],
                    'price_valid_until' => $promotion === null || $promotion['ends_at'] === null ? null : substr($promotion['ends_at'], 0, 10),
                    'availability' => match (true) {
                        ! $v['in_stock'] => 'OutOfStock',
                        $v['low_stock'] => 'LimitedAvailability',
                        default => 'InStock',
                    },
                ];
            }, $variants),
            'rating' => $record['rating'] ?? null,
        ];
    }

    /**
     * Hand-picked related and frequently-bought-together products (live only, in order).
     *
     * - Related: without live picks, up to eight other live products — P1b: in stock first, then
     *   the same category before the same brand, newest first within each group.
     * - Frequently bought together (P1b): the live picks (`frequently_bought_source: manual`), else
     *   the products most often bought with this one (web orders and POS sales of the last 180
     *   days, at least twice; live and in stock; up to four — `automatic`), else none (null).
     *
     * @return array{related: list<array<string, mixed>>, frequently_bought: list<array<string, mixed>>, frequently_bought_source: 'manual'|'automatic'|null}
     */
    public function related(string $slug, bool $preview = false): array
    {
        $record = $this->find($slug, $preview);
        $picks = RelatedProduct::query()->withoutGlobalScope('organization')
            ->where('organization_id', $this->catalog->organizationId())
            ->where('product_id', $record['id'])
            ->orderBy('sort_order')->get()->groupBy('kind');

        $related = $this->browse->cards(($picks['related'] ?? collect())->pluck('related_product_id')->all());
        if ($related === []) {
            $related = $this->relatedFallback($record);
        }

        $frequently = $this->browse->cards(($picks['frequently_bought'] ?? collect())->pluck('related_product_id')->all());
        $source = $frequently === [] ? null : 'manual';
        if ($frequently === []) {
            $frequently = $this->automaticFrequentlyBought($record['id']);
            $source = $frequently === [] ? null : 'automatic';
        }

        return [
            'related' => $related,
            'frequently_bought' => $frequently,
            'frequently_bought_source' => $source,
        ];
    }

    /**
     * P1b: other live products of the same category, then of the same brand; in stock first,
     * category before brand, newest first; never the product itself.
     *
     * @param  array<string, mixed>  $record
     * @return list<array<string, mixed>>
     */
    private function relatedFallback(array $record): array
    {
        $candidates = [];
        $tier = [];
        if ($record['category_id'] !== null) {
            foreach ($this->catalog->products(['category_ids' => [$record['category_id']]]) as $candidate) {
                $candidates[$candidate['id']] = $candidate;
                $tier[$candidate['id']] = 0;
            }
        }
        if ($record['brand_id'] !== null) {
            foreach ($this->catalog->products() as $candidate) {
                if ($candidate['brand_id'] === $record['brand_id'] && ! isset($candidates[$candidate['id']])) {
                    $candidates[$candidate['id']] = $candidate;
                    $tier[$candidate['id']] = 1;
                }
            }
        }
        unset($candidates[$record['id']]);
        if ($candidates === []) {
            return [];
        }

        $items = CatalogSort::Latest->sort(array_values(array_map(fn (array $c) => $this->catalog->item($c), $candidates)));
        // usort is stable: newest first stays the order inside each group.
        usort($items, fn (CatalogItem $a, CatalogItem $b) => [$a->inStock ? 0 : 1, $tier[$a->id]] <=> [$b->inStock ? 0 : 1, $tier[$b->id]]);

        return array_map(fn (CatalogItem $i) => $this->catalog->card($candidates[$i->id]), array_slice($items, 0, self::RELATED_FALLBACK));
    }

    /**
     * P1b: the products most often bought together with this one (score ≥ 2), live and in stock,
     * up to FREQUENTLY_BOUGHT_AUTOMATIC, best first.
     *
     * @return list<array<string, mixed>>
     */
    private function automaticFrequentlyBought(string $productId): array
    {
        $ids = $this->affinities->relatedIds($this->catalog->organizationId(), $productId, CoPurchaseCounter::MIN_SCORE, CoPurchaseCounter::MAX_PER_PRODUCT);
        $cards = array_values(array_filter(
            $this->browse->cards(array_values(array_diff($ids, [$productId]))),
            fn (array $card) => $card['in_stock'] === true,
        ));

        return array_slice($cards, 0, self::FREQUENTLY_BOUGHT_AUTOMATIC);
    }

    /**
     * The listing's texts in the request's language (E12b).
     *
     * @return array{short_description: ?string, description_html: ?string, seo_title: ?string, seo_description: ?string}
     */
    private function texts(ProductListing $listing): array
    {
        /** @var array{short_description: ?string, description_html: ?string, seo_title: ?string, seo_description: ?string} */
        return Translations::pickMany($listing, ['short_description', 'description_html', 'seo_title', 'seo_description'], $this->catalog->locale());
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
