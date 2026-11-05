<?php

namespace App\Modules\OnlineCatalog\Application\Actions;

use App\Modules\OnlineCatalog\Application\Queries\ListingEditor;
use App\Modules\OnlineCatalog\Infrastructure\Models\ProductListing;
use App\Modules\OnlineCatalog\Infrastructure\Models\VariantListing;
use App\Modules\OnlineCatalog\Infrastructure\ReadModels\CatalogReadModel;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\HtmlSanitizer;
use App\Modules\Shared\Application\Support\Changes;
use App\Modules\Shared\Application\Support\Instants;
use App\Modules\Shared\Application\Support\TranslationInput;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Creates or updates a product's web listing and its per-variant web data. Only active
 * products can be published; a compare-at price must be above the variant's selling price.
 */
class SaveProductListing
{
    /** E12b: translatable texts with the limits of their base fields (name: the product's). */
    public const TRANSLATABLE = [
        'name' => ['max:255'],
        'short_description' => ['max:500'],
        'description_html' => ['max:100000'],
        'seo_title' => ['max:70'],
        'seo_description' => ['max:160'],
    ];

    public function __construct(
        private readonly CatalogReadModel $catalog,
        private readonly HtmlSanitizer $sanitizer,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  array<string, mixed>  $data  validated request data
     */
    public function __invoke(string $productId, array $data): ProductListing
    {
        $product = $this->catalog->adminProducts([$productId])[$productId]
            ?? throw (new ModelNotFoundException)->setModel(ProductListing::class, [$productId]);

        $variantData = array_key_exists('variants', $data) ? array_values($data['variants'] ?? []) : null;
        unset($data['variants']);
        $this->checkVariants($product, $variantData ?? []);

        if (($data['is_published'] ?? false) && ! $product['is_active']) {
            throw new BusinessRuleViolation('PRODUCT_NOT_SELLABLE', 'Only active products can be published. Activate the product first.');
        }

        $data = Instants::normalize($data, ['published_at', 'unpublished_at']);
        if (array_key_exists('description_html', $data)) {
            $html = $data['description_html'] === null ? '' : $this->sanitizer->clean((string) $data['description_html']);
            $data['description_html'] = trim(strip_tags($html, '<img>')) === '' ? null : $html;
        }
        if (array_key_exists('specifications', $data)) {
            $data['specifications'] = array_values(array_map(fn (array $s) => ['label' => trim($s['label']), 'value' => trim($s['value'])], $data['specifications'] ?? []));
        }
        foreach (['short_description', 'seo_title', 'seo_description'] as $key) {
            if (array_key_exists($key, $data) && is_string($data[$key]) && trim($data[$key]) === '') {
                $data[$key] = null;
            }
        }

        return DB::transaction(function () use ($productId, $product, $data, $variantData) {
            $listing = ProductListing::query()->where('product_id', $productId)->lockForUpdate()->first();
            $creating = $listing === null;
            $listing ??= new ProductListing(['product_id' => $productId]);
            $before = $creating ? [] : $this->snapshot($listing);

            $slug = isset($data['slug']) && $data['slug'] !== '' ? $data['slug'] : null;
            unset($data['slug']);
            if (array_key_exists('translations', $data)) {
                $data['translations'] = TranslationInput::apply($listing->translations, $data['translations'], array_keys(self::TRANSLATABLE), ['description_html'], $this->sanitizer);
            }
            $listing->fill($data);
            $listing->slug = $slug ?? $listing->slug ?? ListingEditor::suggestSlug($product['name'], ProductListing::class, $listing->id);
            if ($listing->published_at !== null && $listing->unpublished_at !== null && $listing->unpublished_at <= $listing->published_at) {
                throw new BusinessRuleViolation('SCHEDULE_INVALID', 'The end of the publishing window must be after its start.');
            }
            $listing->save();

            $variantChanges = [];
            foreach ($variantData ?? [] as $row) {
                $values = [
                    'compare_at_price' => isset($row['compare_at_price']) ? Decimal::round((string) $row['compare_at_price'], 2) : null,
                    'image_id' => $row['image_id'] ?? null,
                ];
                $existing = VariantListing::query()->where('variant_id', $row['variant_id'])->first();
                if ($existing === null && $values['compare_at_price'] === null && $values['image_id'] === null) {
                    continue;
                }
                $existing ??= new VariantListing(['variant_id' => $row['variant_id']]);
                $old = $existing->only(['compare_at_price', 'image_id']);
                $existing->fill($values)->save();
                if ($old != $existing->only(['compare_at_price', 'image_id'])) {
                    $variantChanges[$row['variant_id']] = $values;
                }
            }

            [$old, $new] = Changes::between($before, $this->snapshot($listing));
            if ($creating || $new !== [] || $variantChanges !== []) {
                $this->audit->record('online_catalog.product_listing.saved', $listing, $old, $new, $variantChanges === [] ? [] : ['variants' => $variantChanges]);
            }

            return $listing;
        });
    }

    /**
     * Variant and image ids must belong to the product; compare-at prices must be above the price.
     *
     * @param  array<string, mixed>  $product
     * @param  list<array<string, mixed>>  $rows
     */
    private function checkVariants(array $product, array $rows): void
    {
        $variants = array_column($product['variants'], null, 'id');
        $imageIds = array_column($product['images'], 'id');
        $errors = [];

        foreach ($rows as $i => $row) {
            $variant = $variants[$row['variant_id']] ?? null;
            if ($variant === null) {
                $errors["variants.{$i}.variant_id"] = ['This variant does not belong to the product.'];

                continue;
            }
            if (isset($row['image_id']) && ! in_array($row['image_id'], $imageIds, true)) {
                $errors["variants.{$i}.image_id"] = ['Choose one of the product\'s images.'];
            }
        }
        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        foreach ($rows as $row) {
            $variant = $variants[$row['variant_id']];
            if (isset($row['compare_at_price']) && Decimal::compare((string) $row['compare_at_price'], $variant['price']) <= 0) {
                throw new BusinessRuleViolation(
                    'COMPARE_AT_NOT_ABOVE_PRICE',
                    "The compare-at price of {$variant['sku']} must be higher than its selling price ({$variant['price']}).",
                    ['variant_id' => $variant['id'], 'selling_price' => $variant['price']],
                );
            }
        }
    }

    /**
     * @return array<string, mixed>
     */
    private function snapshot(ProductListing $l): array
    {
        return [
            'slug' => $l->slug,
            'is_published' => $l->is_published,
            'published_at' => $l->published_at?->toIso8601String(),
            'unpublished_at' => $l->unpublished_at?->toIso8601String(),
            'is_featured' => $l->is_featured,
            'is_new_until' => $l->is_new_until?->toDateString(),
            'short_description' => $l->short_description,
            'description_hash' => $l->description_html === null ? null : hash('xxh128', $l->description_html),
            'specifications' => $l->specifications,
            'seo_title' => $l->seo_title,
            'seo_description' => $l->seo_description,
            'sort_weight' => $l->sort_weight,
            'translations_hash' => $l->translations === null ? null : hash('xxh128', (string) json_encode($l->translations)),
        ];
    }
}
