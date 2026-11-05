<?php

namespace App\Modules\OnlineCatalog\Application\Queries;

use App\Modules\Media\Application\Contracts\MediaLibrary;
use App\Modules\OnlineCatalog\Domain\ListingState;
use App\Modules\OnlineCatalog\Infrastructure\Models\BrandListing;
use App\Modules\OnlineCatalog\Infrastructure\Models\CategoryListing;
use App\Modules\OnlineCatalog\Infrastructure\Models\ProductListing;
use App\Modules\OnlineCatalog\Infrastructure\Models\RelatedProduct;
use App\Modules\OnlineCatalog\Infrastructure\Models\VariantListing;
use App\Modules\OnlineCatalog\Infrastructure\ReadModels\CatalogReadModel;
use App\Modules\Shared\Application\Support\TranslationInput;
use App\Modules\Shared\Domain\Slug;
use Illuminate\Database\Eloquent\ModelNotFoundException;

/**
 * What the admin's online-store editors show: a product's, category's or brand's web
 * listing, or suggested defaults (with a free slug) when it was never listed.
 */
class ListingEditor
{
    public function __construct(
        private readonly CatalogReadModel $catalog,
        private readonly MediaLibrary $media,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function product(string $productId): array
    {
        $product = $this->catalog->adminProducts([$productId])[$productId]
            ?? throw (new ModelNotFoundException)->setModel(ProductListing::class, [$productId]);
        $listing = ProductListing::query()->where('product_id', $productId)->first();
        $variantListings = VariantListing::query()->whereIn('variant_id', array_column($product['variants'], 'id'))->get()->keyBy('variant_id');
        $slug = $listing->slug ?? self::suggestSlug($product['name'], ProductListing::class, $listing?->id);

        $picks = RelatedProduct::query()->where('product_id', $productId)->orderBy('sort_order')->get();
        $pickedProducts = $this->catalog->adminProducts($picks->pluck('related_product_id')->all());
        $related = ['related' => [], 'frequently_bought' => []];
        foreach ($picks as $pick) {
            $p = $pickedProducts[$pick->related_product_id] ?? null;
            if ($p !== null) {
                $related[$pick->kind][] = [
                    'id' => $p['id'],
                    'name' => $p['name'],
                    'image_url' => $p['images'][0]['url'] ?? null,
                    'sku' => $p['variants'][0]['sku'] ?? null,
                ];
            }
        }

        return [
            'product' => [
                'id' => $product['id'],
                'name' => $product['name'],
                'category_id' => $product['category_id'],
                'brand_id' => $product['brand_id'],
                'is_active' => $product['is_active'],
                'options' => $product['options'],
                'images' => $product['images'],
                'variants' => array_map(fn (array $v) => [
                    'id' => $v['id'],
                    'sku' => $v['sku'],
                    'name' => $v['name'],
                    'option_values' => (object) $v['option_values'],
                    'selling_price' => $v['price'],
                    'is_active' => $v['is_active'],
                ], $product['variants']),
            ],
            'listing' => [
                'exists' => $listing !== null,
                'slug' => $slug,
                'is_published' => $listing->is_published ?? false,
                'published_at' => $listing?->published_at?->toIso8601String(),
                'unpublished_at' => $listing?->unpublished_at?->toIso8601String(),
                'is_featured' => $listing->is_featured ?? false,
                'is_new_until' => $listing?->is_new_until?->toDateString(),
                'short_description' => $listing?->short_description,
                'description_html' => $listing?->description_html,
                'specifications' => array_values($listing->specifications ?? []),
                'seo_title' => $listing?->seo_title,
                'seo_description' => $listing?->seo_description,
                'sort_weight' => $listing->sort_weight ?? 0,
                'state' => ($listing?->state() ?? ListingState::Draft)->value,
                // E12b: {bn: {name, short_description, description_html, seo_title, seo_description}}.
                'translations' => TranslationInput::present($listing?->translations),
                'updated_at' => $listing?->updated_at?->toIso8601String(),
            ],
            'variants' => array_map(fn (array $v) => [
                'variant_id' => $v['id'],
                'compare_at_price' => $variantListings[$v['id']]->compare_at_price ?? null,
                'image_id' => $variantListings[$v['id']]->image_id ?? null,
            ], $product['variants']),
            'related' => $related,
            'url' => '/product/'.$slug,
        ];
    }

    /**
     * Every category in tree order with its listing (null when never listed).
     *
     * @return list<array<string, mixed>>
     */
    public function categories(): array
    {
        $listings = $this->catalog->categoryListings();
        $refs = $this->refs(array_merge(...array_map(fn (CategoryListing $l) => [$l->image_media_id, $l->banner_media_id], array_values($listings)) ?: [[]]));

        return array_map(function (array $c) use ($listings, $refs) {
            $listing = $listings[$c['id']] ?? null;

            return [
                'id' => $c['id'],
                'name' => $c['name'],
                'parent_id' => $c['parent_id'],
                'depth' => $c['depth'],
                'is_active' => $c['is_active'],
                'listing' => $listing === null ? null : $this->categoryListing($listing, $refs),
            ];
        }, $this->catalog->categoryTree()->flatten());
    }

    /**
     * @return array<string, mixed>
     */
    public function category(string $categoryId): array
    {
        $node = $this->catalog->categoryTree()->node($categoryId)
            ?? throw (new ModelNotFoundException)->setModel(CategoryListing::class, [$categoryId]);
        $listing = CategoryListing::query()->where('category_id', $categoryId)->first();
        $refs = $listing === null ? [] : $this->refs([$listing->image_media_id, $listing->banner_media_id]);
        $data = $listing === null
            ? ['exists' => false, 'slug' => self::suggestSlug($node['name'], CategoryListing::class, null), 'is_visible' => true,
                'image_media_id' => null, 'banner_media_id' => null, 'image' => null, 'banner' => null,
                'description_html' => null, 'seo_title' => null, 'seo_description' => null, 'translations' => TranslationInput::present(null), 'updated_at' => null]
            : ['exists' => true] + $this->categoryListing($listing, $refs);

        return [
            'category' => ['id' => $node['id'], 'name' => $node['name'], 'parent_id' => $node['parent_id'], 'is_active' => $node['is_active']],
            'listing' => $data,
            'url' => '/category/'.$data['slug'],
        ];
    }

    /**
     * Every brand by name with its listing (null when never listed).
     *
     * @return list<array<string, mixed>>
     */
    public function brands(): array
    {
        $listings = $this->catalog->brandListings();
        $refs = $this->refs(array_map(fn (BrandListing $l) => $l->logo_media_id, array_values($listings)));

        return array_map(fn (array $b) => [
            'id' => $b['id'],
            'name' => $b['name'],
            'is_active' => $b['is_active'],
            'listing' => isset($listings[$b['id']]) ? $this->brandListing($listings[$b['id']], $refs) : null,
        ], array_values($this->catalog->brands()));
    }

    /**
     * @return array<string, mixed>
     */
    public function brand(string $brandId): array
    {
        $brand = $this->catalog->brands()[$brandId]
            ?? throw (new ModelNotFoundException)->setModel(BrandListing::class, [$brandId]);
        $listing = BrandListing::query()->where('brand_id', $brandId)->first();
        $data = $listing === null
            ? ['exists' => false, 'slug' => self::suggestSlug($brand['name'], BrandListing::class, null), 'is_visible' => true,
                'logo_media_id' => null, 'logo' => null, 'description' => null, 'seo_title' => null, 'seo_description' => null, 'translations' => TranslationInput::present(null), 'updated_at' => null]
            : ['exists' => true] + $this->brandListing($listing, $this->refs([$listing->logo_media_id]));

        return [
            'brand' => ['id' => $brand['id'], 'name' => $brand['name'], 'is_active' => $brand['is_active']],
            'listing' => $data,
            'url' => '/brand/'.$data['slug'],
        ];
    }

    /**
     * A free slug for a listing of this kind in the current organization.
     *
     * @param  class-string<ProductListing|CategoryListing|BrandListing>  $model
     */
    public static function suggestSlug(string $name, string $model, ?string $ignoreId): string
    {
        return Slug::suggest($name, fn (string $candidate) => $model::query()
            ->whereRaw('lower(slug) = ?', [$candidate])
            ->when($ignoreId !== null, fn ($q) => $q->whereKeyNot($ignoreId))
            ->exists(), 120, match ($model) {
                CategoryListing::class => 'category',
                BrandListing::class => 'brand',
                default => 'product',
            });
    }

    /**
     * @param  array<string, array<string, mixed>>  $refs
     * @return array<string, mixed>
     */
    private function categoryListing(CategoryListing $l, array $refs): array
    {
        return [
            'slug' => $l->slug,
            'is_visible' => $l->is_visible,
            'image_media_id' => $l->image_media_id,
            'banner_media_id' => $l->banner_media_id,
            'image' => $refs[$l->image_media_id] ?? null,
            'banner' => $refs[$l->banner_media_id] ?? null,
            'description_html' => $l->description_html,
            'seo_title' => $l->seo_title,
            'seo_description' => $l->seo_description,
            // E12b: {bn: {name, description_html, seo_title, seo_description}}.
            'translations' => TranslationInput::present($l->translations),
            'updated_at' => $l->updated_at?->toIso8601String(),
        ];
    }

    /**
     * @param  array<string, array<string, mixed>>  $refs
     * @return array<string, mixed>
     */
    private function brandListing(BrandListing $l, array $refs): array
    {
        return [
            'slug' => $l->slug,
            'is_visible' => $l->is_visible,
            'logo_media_id' => $l->logo_media_id,
            'logo' => $refs[$l->logo_media_id] ?? null,
            'description' => $l->description,
            'seo_title' => $l->seo_title,
            'seo_description' => $l->seo_description,
            // E12b: {bn: {name, description, seo_title, seo_description}}.
            'translations' => TranslationInput::present($l->translations),
            'updated_at' => $l->updated_at?->toIso8601String(),
        ];
    }

    /**
     * @param  array<array-key, ?string>  $ids
     * @return array<string, array<string, mixed>>
     */
    private function refs(array $ids): array
    {
        return $this->media->refs(array_values(array_unique(array_filter($ids, 'is_string'))));
    }
}
