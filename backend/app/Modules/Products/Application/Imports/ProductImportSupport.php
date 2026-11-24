<?php

namespace App\Modules\Products\Application\Imports;

use App\Modules\Catalog\Application\Actions\SaveCategory;
use App\Modules\Catalog\Application\Contracts\CatalogDirectory;
use App\Modules\Imports\Application\Data\ImportContext;
use App\Modules\Imports\Application\Data\RowErrors;
use App\Modules\Imports\Application\Support\BaseImportHandler;
use App\Modules\Products\Domain\Barcode;
use App\Modules\Products\Infrastructure\Models\ProductBarcode;
use App\Modules\Products\Infrastructure\Models\ProductVariant;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

/**
 * ST1: lookups shared by the product and price-update imports: variants by SKU / barcode of the
 * organization (live variants only; another organization's SKU never matches), catalog
 * references by name, and the cell rules of codes and prices.
 */
abstract class ProductImportSupport extends BaseImportHandler
{
    private const CHUNK = 1000;

    public function __construct(protected readonly CatalogDirectory $catalog) {}

    /**
     * Loads the variants the file's SKUs and barcodes point to (one query per 1 000 codes).
     *
     * @param  list<?string>  $skus
     * @param  list<?string>  $barcodes
     */
    protected function loadVariants(ImportContext $context, array $skus, array $barcodes): void
    {
        $bySku = [];
        $byBarcode = [];
        $products = [];
        $remember = function (ProductVariant $v) use (&$products): array {
            $product = $v->product;
            $products[$product->id] ??= $product;

            return [
                'variant_id' => $v->id,
                'product_id' => $product->id,
                'product_name' => $product->name,
                'sku' => $v->sku,
                'archived' => $product->trashed(),
                'purchase_price' => $v->purchase_price,
                'selling_price' => $v->selling_price,
                'wholesale_price' => $v->wholesale_price,
            ];
        };

        $skus = array_values(array_unique(array_filter(array_map(fn ($s) => self::fold($s), $skus))));
        foreach (array_chunk($skus, self::CHUNK) as $chunk) {
            $this->variantQuery($context)->whereIn(DB::raw('lower(sku)'), $chunk)->get()
                ->each(function (ProductVariant $v) use (&$bySku, $remember) {
                    $bySku[mb_strtolower($v->sku)] = $remember($v);
                });
        }
        $barcodes = array_values(array_unique(array_filter($barcodes, fn ($b) => is_string($b) && $b !== '')));
        foreach (array_chunk($barcodes, self::CHUNK) as $chunk) {
            ProductBarcode::query()->where('organization_id', $context->organizationId)->whereIn('barcode', $chunk)->get(['variant_id', 'barcode'])
                ->groupBy('variant_id')
                ->each(function ($rows, string $variantId) use (&$byBarcode, $remember, $context) {
                    $variant = $this->variantQuery($context)->whereKey($variantId)->first();
                    if ($variant !== null) {
                        foreach ($rows as $row) {
                            $byBarcode[$row->barcode] = $remember($variant);
                        }
                    }
                });
        }

        $existing = [];
        foreach ($products as $id => $product) {
            $variants = $product->variants()->get(['id', 'option_values']);
            $existing[$id] = [
                'id' => $id,
                'name' => $product->name,
                'options' => $product->options ?: null,
                'combinations' => $variants->map(function (ProductVariant $v) {
                    $values = array_change_key_case(array_map('mb_strtolower', $v->option_values ?: []), CASE_LOWER);
                    ksort($values);

                    return (string) json_encode($values);
                })->all(),
                'variants' => $variants->count(),
            ];
        }

        $context->put('products.by_sku', $bySku);
        $context->put('products.by_barcode', $byBarcode);
        $context->put('products.existing', $existing);
    }

    /**
     * The live variant a row points to: by SKU when the row has one, else by barcode.
     *
     * @param  array<string, mixed>  $row
     * @return array{variant_id: string, product_id: string, product_name: string, sku: string, archived: bool, purchase_price: string, selling_price: string, wholesale_price: ?string}|null
     */
    protected function match(array $row, ImportContext $context, string $skuColumn = 'sku', string $barcodeColumn = 'barcode'): ?array
    {
        if (($sku = self::fold($row[$skuColumn] ?? null)) !== null) {
            return $context->remember('products.by_sku', fn () => [])[$sku] ?? null;
        }
        $barcode = $row[$barcodeColumn] ?? null;

        return $barcode === null ? null : ($context->remember('products.by_barcode', fn () => [])[$barcode] ?? null);
    }

    /**
     * @return array{variant_id: string, product_id: string, product_name: string, sku: string, archived: bool}|null
     */
    protected function barcodeOwner(string $barcode, ImportContext $context): ?array
    {
        return $context->remember('products.by_barcode', fn () => [])[$barcode] ?? null;
    }

    /**
     * Fresh lookup inside the run's transaction (the dry run's view may be stale).
     *
     * @param  array<string, mixed>  $row
     */
    protected function findVariant(ImportContext $context, array $row, string $skuColumn = 'sku', string $barcodeColumn = 'barcode'): ?ProductVariant
    {
        if (($sku = self::fold($row[$skuColumn] ?? null)) !== null) {
            return $this->variantQuery($context)->whereRaw('lower(sku) = ?', [$sku])->first();
        }
        $barcode = $row[$barcodeColumn] ?? null;
        if ($barcode === null) {
            return null;
        }
        $variantId = ProductBarcode::query()->where('organization_id', $context->organizationId)->where('barcode', $barcode)->value('variant_id');

        return $variantId === null ? null : $this->variantQuery($context)->whereKey($variantId)->first();
    }

    /**
     * @return Builder<ProductVariant>
     */
    private function variantQuery(ImportContext $context)
    {
        return ProductVariant::query()->where('organization_id', $context->organizationId)
            ->with(['product' => fn ($q) => $q->withTrashed()]);
    }

    /**
     * @param  array<string, mixed>  $row
     */
    protected function checkCodes(array $row, RowErrors $errors): void
    {
        if ($row['sku'] !== null && preg_match('/^[A-Za-z0-9\-_.\/]+$/', $row['sku']) !== 1) {
            $errors->add('sku', 'A SKU may contain letters, digits and - _ . / only.');
        }
        if ($row['barcode'] !== null && ! Barcode::isValid(Barcode::normalize($row['barcode']))) {
            $errors->add('barcode', "Barcode {$row['barcode']} is invalid (check digit or characters).");
        }
    }

    /**
     * Prices: 0 or more, at most 2 decimals; cost prices only for users who may see them.
     *
     * @param  array<string, mixed>  $row
     */
    protected function checkPrices(array $row, RowErrors $errors, ImportContext $context): void
    {
        foreach (['cost_price', 'selling_price', 'wholesale_price'] as $column) {
            $value = $row[$column] ?? null;
            if ($value === null) {
                continue;
            }
            if (Decimal::isNegative($value) || self::tooPrecise($value, 2) || Decimal::compare($value, '9999999999999999') > 0) {
                $errors->add($column, 'Enter a price of 0 or more with at most 2 decimals.');
            }
        }
        if (($row['cost_price'] ?? null) !== null && ! $context->can('products.view_cost')) {
            $errors->add('cost_price', 'You may not set cost prices (permission to see cost prices is needed). Leave the column blank.');
        }
    }

    /**
     * Category path, brand, unit and tax rate must exist (or may be created).
     *
     * @param  array<string, mixed>  $row
     */
    protected function checkCatalog(array $row, RowErrors $errors, ImportContext $context): void
    {
        if ($row['category'] !== null) {
            $path = self::categoryPath($row['category']);
            $category = $this->category($context, $path);
            if ($path === [] || count($path) > SaveCategory::MAX_DEPTH) {
                $errors->add('category', 'Write the category path top level first, e.g. Drinks > Juice (at most '.SaveCategory::MAX_DEPTH.' levels).');
            } elseif (array_any($path, fn (string $name) => mb_strlen($name) > 100)) {
                $errors->add('category', 'A category name has at most 100 characters.');
            } elseif ($category['inactive'] !== null) {
                $errors->add('category', "Category {$category['inactive']} is inactive.");
            } elseif ($category['id'] === null && ! $context->can('categories.manage')) {
                $errors->add('category', "Category {$row['category']} does not exist (you may not create categories).");
            }
        }
        if ($row['brand'] !== null) {
            $brand = $this->brand($context, $row['brand']);
            if ($brand['inactive']) {
                $errors->add('brand', "Brand {$row['brand']} is inactive.");
            } elseif ($brand['id'] === null && ! $context->can('brands.manage')) {
                $errors->add('brand', "Brand {$row['brand']} does not exist (you may not create brands).");
            }
        }
        if ($row['unit'] !== null && $this->unit($context, $row['unit'])['id'] === null) {
            $codes = implode(', ', array_column(array_filter($context->remember('catalog.units', fn () => $this->catalog->units($context->organizationId)), fn (array $u) => $u['is_active']), 'code'));
            $errors->add('unit', "Unit {$row['unit']} does not exist or is inactive".($codes === '' ? '.' : " (units: {$codes})."));
        }
        if ($row['tax'] !== null && $this->tax($context, $row['tax'])['id'] === null) {
            $errors->add('tax', "Tax rate {$row['tax']} does not exist or is inactive.");
        }
    }

    /**
     * @param  list<string>  $path
     * @return array{id: ?string, inactive: ?string}
     */
    protected function category(ImportContext $context, array $path): array
    {
        $categories = $context->remember('catalog.categories', fn () => $this->catalog->categories($context->organizationId));
        $parentId = null;
        foreach ($path as $name) {
            $found = array_find($categories, fn (array $c) => $c['parent_id'] === $parentId && mb_strtolower($c['name']) === mb_strtolower($name));
            if ($found === null) {
                return ['id' => null, 'inactive' => null];
            }
            if (! $found['is_active']) {
                return ['id' => null, 'inactive' => $found['name']];
            }
            $parentId = $found['id'];
        }

        return ['id' => $parentId, 'inactive' => null];
    }

    /**
     * @return array{id: ?string, inactive: bool}
     */
    protected function brand(ImportContext $context, string $name): array
    {
        $brands = $context->remember('catalog.brands', fn () => $this->catalog->brands($context->organizationId));
        $found = array_find($brands, fn (array $b) => mb_strtolower($b['name']) === mb_strtolower(trim($name)));

        return ['id' => $found !== null && $found['is_active'] ? $found['id'] : null, 'inactive' => $found !== null && ! $found['is_active']];
    }

    /**
     * Active unit by code or name.
     *
     * @return array{id: ?string}
     */
    protected function unit(ImportContext $context, string $text): array
    {
        $units = $context->remember('catalog.units', fn () => $this->catalog->units($context->organizationId));
        $text = mb_strtolower(trim($text));
        $found = array_find($units, fn (array $u) => $u['is_active'] && mb_strtolower($u['code']) === $text)
            ?? array_find($units, fn (array $u) => $u['is_active'] && mb_strtolower($u['name']) === $text);

        return ['id' => $found['id'] ?? null];
    }

    /**
     * Active tax rate by name, or by rate ("15", "15%") when exactly one rate has it.
     *
     * @return array{id: ?string}
     */
    protected function tax(ImportContext $context, string $text): array
    {
        $rates = array_values(array_filter(
            $context->remember('catalog.tax_rates', fn () => $this->catalog->taxRates($context->organizationId)),
            fn (array $t) => $t['is_active'],
        ));
        $text = trim($text);
        $found = array_find($rates, fn (array $t) => mb_strtolower($t['name']) === mb_strtolower($text));
        if ($found === null && preg_match('/^(\d+(?:\.\d+)?)\s*%?$/', $text, $m) === 1) {
            $same = array_values(array_filter($rates, fn (array $t) => Decimal::compare($t['rate'], $m[1]) === 0));
            $found = count($same) === 1 ? $same[0] : null;
        }

        return ['id' => $found['id'] ?? null];
    }

    /**
     * "Drinks > Juice" → ["Drinks", "Juice"].
     *
     * @return list<string>
     */
    protected static function categoryPath(string $text): array
    {
        return array_values(array_filter(array_map('trim', explode('>', $text)), fn (string $p) => $p !== ''));
    }

    /**
     * "Size=M; Color=Red" → ["Size" => "M", "Color" => "Red"], or an error message.
     *
     * @return array{0: array<string, string>, 1: ?string}
     */
    protected static function attributes(?string $text): array
    {
        if ($text === null) {
            return [[], null];
        }

        $attributes = [];
        foreach (array_filter(array_map('trim', explode(';', $text)), fn (string $p) => $p !== '') as $pair) {
            if (preg_match('/^([^=:]+)[=:](.+)$/u', $pair, $m) !== 1) {
                return [[], "Write the options as Name=Value pairs separated by \";\", e.g. Size=M; Color=Red (\"{$pair}\" is not)."];
            }
            [$name, $value] = [trim($m[1]), trim($m[2])];
            if ($name === '' || $value === '' || mb_strlen($name) > 50 || mb_strlen($value) > 50) {
                return [[], 'Option names and values have 1 to 50 characters.'];
            }
            if (array_any(array_keys($attributes), fn (string $n) => mb_strtolower($n) === mb_strtolower($name))) {
                return [[], "Option {$name} is given twice."];
            }
            $attributes[$name] = $value;
        }
        if (count($attributes) > 3) {
            return [[], 'A product can have at most 3 options.'];
        }

        return [$attributes, null];
    }
}
