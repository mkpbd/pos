<?php

namespace App\Modules\Products\Application\Actions;

use App\Modules\Catalog\Application\Contracts\CatalogDirectory;
use App\Modules\Products\Application\DTOs\ProductData;
use App\Modules\Products\Application\DTOs\VariantData;
use App\Modules\Products\Domain\ProductDefinitionRules;
use App\Modules\Products\Infrastructure\Models\Product;
use App\Modules\Products\Infrastructure\Models\ProductBarcode;
use App\Modules\Products\Infrastructure\Models\ProductVariant;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\SequenceGenerator;
use App\Modules\Shared\Application\Support\Changes;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Creates or fully replaces a product definition: product fields, its variants
 * (matched by id; omitted variants are archived) and each variant's barcodes.
 * Blank SKUs get the next "SKU-000123" number. Price changes are audited.
 */
class SaveProduct
{
    private const REFERENCE_LABELS = [
        'category_id' => 'category',
        'brand_id' => 'brand',
        'unit_id' => 'unit',
        'tax_rate_id' => 'tax rate',
    ];

    public function __construct(
        private readonly TenantContext $tenant,
        private readonly CatalogDirectory $catalog,
        private readonly SequenceGenerator $sequences,
        private readonly AuditTrail $audit,
    ) {}

    public function __invoke(?Product $product, ProductData $data): Product
    {
        $organizationId = $this->tenant->requireOrganization();
        $errors = ProductDefinitionRules::violations($data);
        $errors += $this->referenceViolations($organizationId, $product, $data);
        $this->failIf($errors);

        return DB::transaction(function () use ($product, $data, $organizationId) {
            $creating = $product === null;
            $product ??= new Product(['organization_id' => $organizationId]);
            $existing = $creating ? collect() : $product->variants()->with('barcodes')->get()->keyBy('id');
            $before = $creating ? [] : $this->snapshot($product, $existing);

            $this->failIf($this->persistenceViolations($organizationId, $data, $existing));

            $product->fill([
                'name' => $data->name,
                'description' => $data->description,
                'type' => $data->type,
                'category_id' => $data->categoryId,
                'brand_id' => $data->brandId,
                'unit_id' => $data->unitId,
                'tax_rate_id' => $data->taxRateId,
                'track_stock' => $data->trackStock,
                'track_batches' => $data->trackBatches,
                'track_serials' => $data->trackSerials,
                'max_discount_percent' => $data->maxDiscountPercent,
                'options' => $data->options,
                'is_active' => $data->isActive,
            ])->save();

            $this->syncVariants($product, $data, $existing, $organizationId);

            $after = $this->snapshot($product, $product->variants()->with('barcodes')->get()->keyBy('id'));
            [$old, $new] = Changes::between($before, $after);
            if ($creating || $new !== []) {
                $this->audit->record($creating ? 'product.created' : 'product.updated', $product, $old, $new);
            }

            return $product;
        });
    }

    /**
     * Only references that are new or changed must point to active catalog records,
     * so editing a product does not fail because its brand was deactivated later.
     *
     * @return array<string, string>
     */
    private function referenceViolations(string $organizationId, ?Product $product, ProductData $data): array
    {
        $references = [
            'category_id' => $data->categoryId,
            'brand_id' => $data->brandId,
            'unit_id' => $data->unitId,
            'tax_rate_id' => $data->taxRateId,
        ];
        if ($product !== null) {
            $references = array_filter($references, fn (?string $id, string $field) => $id !== $product->getAttribute($field), ARRAY_FILTER_USE_BOTH);
        }

        $errors = [];
        foreach ($this->catalog->invalidReferences($organizationId, $references) as $field) {
            $errors[$field] = 'The selected '.self::REFERENCE_LABELS[$field].' does not exist or is inactive.';
        }

        return $errors;
    }

    /**
     * @param  Collection<string, ProductVariant>  $existing
     * @return array<string, string>
     */
    private function persistenceViolations(string $organizationId, ProductData $data, Collection $existing): array
    {
        $errors = [];

        foreach ($data->variants as $i => $variant) {
            if ($variant->id !== null && ! $existing->has($variant->id)) {
                $errors["variants.{$i}.id"] = 'This variant does not belong to the product.';
            }
        }

        // SKUs must not collide with live variants of other products (this product's own
        // variants are either kept or archived before new SKUs are written).
        $skus = collect($data->variants)->pluck('sku')->filter()->map(fn (string $s) => mb_strtolower($s));
        if ($skus->isNotEmpty()) {
            $taken = ProductVariant::query()
                ->where('organization_id', $organizationId)
                ->whereIn(DB::raw('lower(sku)'), $skus->all())
                ->whereNotIn('id', $existing->keys()->all())
                ->pluck('sku')
                ->map(fn (string $s) => mb_strtolower($s))
                ->all();

            foreach ($data->variants as $i => $variant) {
                if ($variant->sku !== null && in_array(mb_strtolower($variant->sku), $taken, true)) {
                    $errors["variants.{$i}.sku"] = "SKU \"{$variant->sku}\" is already used by another product.";
                }
            }
        }

        // Barcodes must not belong to another product's variants.
        $barcodes = collect($data->variants)->flatMap(fn (VariantData $v) => $v->barcodes)->all();
        if ($barcodes !== []) {
            $taken = ProductBarcode::query()
                ->where('organization_id', $organizationId)
                ->whereIn('barcode', $barcodes)
                ->whereNotIn('variant_id', $existing->keys()->all())
                ->pluck('barcode')
                ->all();

            foreach ($data->variants as $i => $variant) {
                foreach ($variant->barcodes as $j => $barcode) {
                    if (in_array($barcode, $taken, true)) {
                        $errors["variants.{$i}.barcodes.{$j}"] = "Barcode \"{$barcode}\" is already assigned to another product.";
                    }
                }
            }
        }

        return $errors;
    }

    /**
     * @param  Collection<string, ProductVariant>  $existing
     */
    private function syncVariants(Product $product, ProductData $data, Collection $existing, string $organizationId): void
    {
        $keptIds = collect($data->variants)->pluck('id')->filter()->all();

        // 1. Release everything that is going away before anything new claims it.
        foreach ($existing as $id => $variant) {
            if (! in_array($id, $keptIds, true)) {
                $variant->barcodes()->delete();
                $variant->delete();
            }
        }
        foreach ($data->variants as $variantData) {
            if ($variantData->id !== null) {
                $existing[$variantData->id]->barcodes()->whereNotIn('barcode', $variantData->barcodes)->delete();
            }
        }

        // 2. Upsert variants and add their new barcodes.
        foreach ($data->variants as $position => $variantData) {
            $variant = $variantData->id !== null ? $existing[$variantData->id] : new ProductVariant([
                'organization_id' => $organizationId,
                'product_id' => $product->id,
            ]);

            $variant->fill([
                'sku' => $variantData->sku ?? $variant->sku ?? $this->sequences->next($organizationId, 'sku', 'SKU-'),
                'name' => $variantData->name,
                'option_values' => $this->canonicalOptionValues($data, $variantData),
                'purchase_price' => $variantData->purchasePrice,
                'selling_price' => $variantData->sellingPrice,
                'wholesale_price' => $variantData->wholesalePrice,
                'reorder_level' => $variantData->reorderLevel,
                'is_active' => $variantData->isActive,
                'sort_order' => $position,
            ])->save();

            $current = $variant->barcodes()->pluck('barcode')->all();
            foreach (array_diff($variantData->barcodes, $current) as $barcode) {
                $variant->barcodes()->create(['organization_id' => $organizationId, 'barcode' => $barcode]);
            }
        }
    }

    /**
     * Stores option names and values with the spelling used in the product's option definitions.
     *
     * @return array<string, string>
     */
    private function canonicalOptionValues(ProductData $data, VariantData $variant): array
    {
        if ($data->options === null) {
            return [];
        }

        $values = array_change_key_case($variant->optionValues, CASE_LOWER);
        $canonical = [];
        foreach ($data->options as $option) {
            $given = mb_strtolower($values[mb_strtolower($option['name'])]);
            foreach ($option['values'] as $value) {
                if (mb_strtolower($value) === $given) {
                    $canonical[$option['name']] = $value;
                }
            }
        }

        return $canonical;
    }

    /**
     * @param  Collection<string, ProductVariant>  $variants
     * @return array<string, mixed>
     */
    private function snapshot(Product $product, Collection $variants): array
    {
        $values = $product->only(['name', 'category_id', 'brand_id', 'unit_id', 'tax_rate_id', 'track_stock', 'track_batches', 'track_serials', 'max_discount_percent', 'is_active']);
        $values['type'] = $product->type->value;
        $values['variants'] = $variants->mapWithKeys(fn (ProductVariant $v) => [$v->sku => [
            'purchase_price' => $v->purchase_price,
            'selling_price' => $v->selling_price,
            'wholesale_price' => $v->wholesale_price,
            'is_active' => $v->is_active,
            'barcodes' => $v->barcodes->pluck('barcode')->sort()->values()->all(),
        ]])->sortKeys()->all();

        return $values;
    }

    /**
     * @param  array<string, string>  $errors
     */
    private function failIf(array $errors): void
    {
        if ($errors !== []) {
            throw ValidationException::withMessages(array_map(fn (string $m) => [$m], $errors));
        }
    }
}
