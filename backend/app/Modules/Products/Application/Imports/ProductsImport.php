<?php

namespace App\Modules\Products\Application\Imports;

use App\Modules\Catalog\Application\Actions\EnsureCatalogEntries;
use App\Modules\Catalog\Application\Contracts\CatalogDirectory;
use App\Modules\Imports\Application\Contracts\GroupedImportHandler;
use App\Modules\Imports\Application\Data\ImportColumn;
use App\Modules\Imports\Application\Data\ImportContext;
use App\Modules\Imports\Application\Data\RowErrors;
use App\Modules\Imports\Application\Data\RowResult;
use App\Modules\Imports\Domain\ColumnType;
use App\Modules\Products\Application\Actions\SaveProduct;
use App\Modules\Products\Application\DTOs\ProductData;
use App\Modules\Products\Domain\Barcode;
use App\Modules\Products\Domain\ProductDefinitionRules;
use App\Modules\Products\Infrastructure\Models\Product;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;

/**
 * ST1: product import. One row per variant; rows sharing `parent_sku` are the variants of one
 * product (`variant_attributes` "Size=M; Color=Red", options built in the order they appear).
 * A row whose SKU (else barcode) belongs to a live variant updates that variant and its product
 * — blank cells leave a field unchanged; rows with new SKUs in a group whose other rows match a
 * product become new variants of it. Everything is saved through SaveProduct (same rules, SKU
 * numbering, audit). Product details (name, category, unit…) come from the group's first row
 * that has them. Categories (`Drinks > Juice`) and brands are created when missing, only for
 * users with categories.manage / brands.manage; units and tax rates must exist. Cost prices need
 * products.view_cost. Existing variants keep their option values.
 */
final class ProductsImport extends ProductImportSupport implements GroupedImportHandler
{
    private const PRODUCT_FIELDS = ['name', 'description', 'category', 'brand', 'unit', 'tax', 'track_stock', 'track_batches', 'is_active'];

    public function __construct(
        private readonly SaveProduct $save,
        private readonly EnsureCatalogEntries $catalogEntries,
        CatalogDirectory $catalog,
    ) {
        parent::__construct($catalog);
    }

    public function type(): string
    {
        return 'products';
    }

    public function label(): string
    {
        return 'Products';
    }

    public function permission(): string
    {
        return 'products.manage';
    }

    public function columns(): array
    {
        return [
            new ImportColumn('name', 'Product name', true, 'Mango Juice 250ml', 'The product name (repeat it on every variant row).', maxLength: 255),
            new ImportColumn('sku', 'SKU', false, 'JUICE-250', 'Identifies the variant: a row with an existing SKU updates it. Blank: a new SKU number is given. Letters, digits, - _ . /', maxLength: 64),
            new ImportColumn('barcode', 'Barcode', false, '8901234567890', 'Identifies the variant when the SKU is blank. EAN/UPC codes need a correct check digit.', maxLength: Barcode::MAX_LENGTH),
            new ImportColumn('parent_sku', 'Parent SKU', false, '', 'Rows with the same parent SKU are the variants (sizes, colours) of one product. Leave blank for products without variants.', maxLength: 64),
            new ImportColumn('variant_attributes', 'Variant attributes', false, '', 'For variants: option=value pairs separated by ";", e.g. Size=M; Color=Red. Every variant of a product uses the same options.', maxLength: 500),
            new ImportColumn('category', 'Category', false, 'Drinks > Juice', 'Category path, top level first, separated by ">". Missing categories are created if you may manage categories.', maxLength: 500),
            new ImportColumn('brand', 'Brand', false, 'Pran', 'Brand name; created if missing and you may manage brands.', maxLength: 100),
            new ImportColumn('unit', 'Unit', false, 'pcs', 'Code or name of an existing unit (required for new products).', maxLength: 50),
            new ImportColumn('cost_price', 'Cost price', false, '18.50', 'Purchase price per unit (needs permission to see cost prices).', ColumnType::Decimal),
            new ImportColumn('selling_price', 'Selling price', false, '25.00', 'Required for new products and variants.', ColumnType::Decimal),
            new ImportColumn('wholesale_price', 'Wholesale price', false, '', '', ColumnType::Decimal),
            new ImportColumn('tax', 'Tax rate', false, 'VAT 15%', 'Name of an existing tax rate (or its rate, e.g. 15). Blank: no tax for new products.', maxLength: 100),
            new ImportColumn('track_stock', 'Track stock', false, 'yes', 'yes (default) or no — no for services and items you do not count.', ColumnType::Boolean),
            new ImportColumn('track_batches', 'Track batches', false, 'no', 'yes for batch / expiry tracked goods (medicine, food).', ColumnType::Boolean),
            new ImportColumn('reorder_level', 'Reorder level', false, '10', 'Alert when stock falls to this quantity.', ColumnType::Decimal),
            new ImportColumn('is_active', 'Active', false, 'yes', 'yes (default) or no.', ColumnType::Boolean),
            new ImportColumn('description', 'Description', false, '', maxLength: 5000),
        ];
    }

    public function keyOf(array $row): ?string
    {
        if (($sku = self::fold($row['sku'])) !== null) {
            return 'sku:'.$sku;
        }

        return $row['barcode'] === null ? null : 'barcode:'.$row['barcode'];
    }

    public function groupOf(array $row): string
    {
        return ($parent = self::fold($row['parent_sku'])) !== null ? 'parent:'.$parent : 'row:'.$row['_row'];
    }

    public function prepare(array $rows, ImportContext $context): void
    {
        $this->loadVariants($context, array_column($rows, 'sku'), array_column($rows, 'barcode'));
    }

    public function validateRow(array $row, ImportContext $context): RowResult
    {
        $errors = new RowErrors;
        $this->checkCodes($row, $errors);
        $this->checkPrices($row, $errors, $context);
        if (self::tooPrecise($row['reorder_level'], 3) || ($row['reorder_level'] !== null && str_starts_with($row['reorder_level'], '-'))) {
            $errors->add('reorder_level', 'Enter a quantity of 0 or more with at most 3 decimals.');
        }
        [, $attributeError] = self::attributes($row['variant_attributes']);
        if ($attributeError !== null) {
            $errors->add('variant_attributes', $attributeError);
        }
        $this->checkCatalog($row, $errors, $context);

        $match = $this->match($row, $context);
        if ($match !== null && $match['archived']) {
            $errors->add($row['sku'] !== null ? 'sku' : 'barcode', "This belongs to the archived product \"{$match['product_name']}\". Restore the product first.");
        }
        if ($row['barcode'] !== null && ($owner = $this->barcodeOwner($row['barcode'], $context)) !== null && $owner['variant_id'] !== ($match['variant_id'] ?? null)) {
            $errors->add('barcode', "Barcode {$row['barcode']} belongs to {$owner['product_name']} ({$owner['sku']}).");
        }
        if ($match === null) {
            if ($row['selling_price'] === null) {
                $errors->add('selling_price', 'Enter the selling price of the new product.');
            }
            if ($row['unit'] === null && $row['parent_sku'] === null) {
                $errors->add('unit', 'Enter the unit of the new product.');
            }
        }

        if ($errors->any()) {
            return $errors->result();
        }

        return match (true) {
            $match === null => RowResult::create(),
            $context->updateExisting() => RowResult::update(),
            default => RowResult::skip(),
        };
    }

    public function validateGroup(array $rows, ImportContext $context): array
    {
        $matches = array_map(fn (array $row) => $this->match($row, $context), $rows);
        $productIds = array_values(array_unique(array_filter(array_map(fn (?array $m) => $m['product_id'] ?? null, $matches))));
        $label = ($parent = reset($rows)['parent_sku']) !== null ? "parent SKU {$parent}" : 'this row';

        if (count($productIds) > 1) {
            return self::failAll($rows, null, "The rows of {$label} match variants of different products.");
        }

        if ($productIds !== []) {
            if (! $context->updateExisting()) {
                return array_map(fn () => RowResult::skip(), $rows);
            }
            $existing = $context->remember('products.existing', fn () => [])[$productIds[0]];
            $newRows = array_filter($rows, fn (array $row, int $n) => $matches[$n] === null, ARRAY_FILTER_USE_BOTH);
            if ($newRows === []) {
                return [];
            }
            if ($existing['options'] === null) {
                return self::failAll($newRows, 'variant_attributes', "{$existing['name']} has no variants; add variants to it in the product editor.");
            }

            return $this->checkNewVariants($newRows, $existing);
        }

        return $this->checkNewProduct($rows);
    }

    public function importRow(array $row, ImportContext $context): RowResult
    {
        return $this->importGroup([$row['_row'] => $row], $context)[$row['_row']];
    }

    public function importGroup(array $rows, ImportContext $context): array
    {
        $variants = [];
        foreach ($rows as $number => $row) {
            $variants[$number] = $this->findVariant($context, $row);
        }
        $productIds = array_values(array_unique(array_filter(array_map(fn ($v) => $v?->product_id, $variants))));
        if (count($productIds) > 1) {
            throw new BusinessRuleViolation('IMPORT_ROWS_SPLIT', 'These rows match variants of different products.');
        }

        $product = $productIds === [] ? null : Product::query()->withTrashed()->lockForUpdate()->findOrFail($productIds[0]);
        if ($product?->trashed()) {
            throw new BusinessRuleViolation('PRODUCT_ARCHIVED', "{$product->name} is archived. Restore it first.");
        }
        if ($product !== null && ! $context->updateExisting()) {
            return array_map(fn () => RowResult::skip(), $rows);
        }

        $payload = $product === null ? [
            'type' => 'standard', 'track_stock' => true, 'track_batches' => false, 'is_active' => true,
            'category_id' => null, 'brand_id' => null, 'tax_rate_id' => null, 'description' => null, 'options' => null, 'variants' => [],
        ] : ProductPayload::of($product);

        $payload = $this->applyProductFields($payload, self::productValues($rows), $context);
        $payload = $this->applyVariants($payload, $rows, $variants);

        ($this->save)($product, ProductData::fromArray($payload));

        return array_map(fn ($variant) => $variant === null ? RowResult::create() : RowResult::update(), $variants);
    }

    /**
     * @param  array<int, array<string, mixed>>  $rows
     * @param  array{id: string, name: string, options: list<array{name: string, values: list<string>}>, combinations: list<string>, variants: int}  $existing
     * @return array<int, RowResult>
     */
    private function checkNewVariants(array $rows, array $existing): array
    {
        $names = array_map(fn (array $o) => mb_strtolower($o['name']), $existing['options']);
        sort($names);
        $seen = array_flip($existing['combinations']);
        $results = [];
        foreach ($rows as $number => $row) {
            [$attributes] = self::attributes($row['variant_attributes']);
            $given = array_map('mb_strtolower', array_keys($attributes));
            sort($given);
            if ($given !== $names) {
                $results[$number] = RowResult::error('variant_attributes', 'Give a value for each option of '.$existing['name'].': '.implode(', ', array_column($existing['options'], 'name')).'.');

                continue;
            }
            $combination = self::combination($attributes);
            if (isset($seen[$combination])) {
                $results[$number] = RowResult::error('variant_attributes', "{$existing['name']} already has a variant with these values.");
            }
            $seen[$combination] = true;
        }
        if ($existing['variants'] + count($rows) > ProductDefinitionRules::MAX_VARIANTS) {
            return self::failAll($rows, null, "{$existing['name']} would have more than ".ProductDefinitionRules::MAX_VARIANTS.' variants.');
        }

        return $results;
    }

    /**
     * @param  array<int, array<string, mixed>>  $rows
     * @return array<int, RowResult>
     */
    private function checkNewProduct(array $rows): array
    {
        $first = array_key_first($rows);
        $values = self::productValues($rows);
        if ($values['unit'] === null) {
            return [$first => RowResult::error('unit', 'Enter the unit of the new product.')];
        }

        $withAttributes = array_filter($rows, fn (array $r) => $r['variant_attributes'] !== null);
        if (count($rows) === 1 && $withAttributes === []) {
            return [];
        }
        if (count($rows) > ProductDefinitionRules::MAX_VARIANTS) {
            return self::failAll($rows, null, 'A product can have at most '.ProductDefinitionRules::MAX_VARIANTS.' variants.');
        }

        $results = [];
        $names = null;
        $seen = [];
        foreach ($rows as $number => $row) {
            [$attributes] = self::attributes($row['variant_attributes']);
            if ($attributes === []) {
                $results[$number] = RowResult::error('variant_attributes', 'Each variant needs its option values, e.g. Size=M; Color=Red.');

                continue;
            }
            $given = array_map('mb_strtolower', array_keys($attributes));
            sort($given);
            $names ??= $given;
            if ($given !== $names) {
                $results[$number] = RowResult::error('variant_attributes', 'Every variant of the product needs the same options as its first row.');

                continue;
            }
            $combination = self::combination($attributes);
            if (isset($seen[$combination])) {
                $results[$number] = RowResult::error('variant_attributes', "Row {$seen[$combination]} already has these option values.");

                continue;
            }
            $seen[$combination] = $number;
        }

        return $results;
    }

    /**
     * @param  array<string, mixed>  $payload
     * @param  array<string, mixed>  $values
     * @return array<string, mixed>
     */
    private function applyProductFields(array $payload, array $values, ImportContext $context): array
    {
        $payload['name'] = $values['name'] ?? $payload['name'];
        if ($values['description'] !== null) {
            $payload['description'] = $values['description'];
        }
        if ($values['category'] !== null) {
            $path = self::categoryPath($values['category']);
            $payload['category_id'] = $this->category($context, $path)['id']
                ?? ($context->can('categories.manage') ? $this->catalogEntries->categoryPath($path) : throw new BusinessRuleViolation('CATEGORY_NOT_FOUND', "Category {$values['category']} does not exist."));
        }
        if ($values['brand'] !== null) {
            $payload['brand_id'] = $this->brand($context, $values['brand'])['id']
                ?? ($context->can('brands.manage') ? $this->catalogEntries->brand($values['brand']) : throw new BusinessRuleViolation('BRAND_NOT_FOUND', "Brand {$values['brand']} does not exist."));
        }
        if ($values['unit'] !== null) {
            $payload['unit_id'] = $this->unit($context, $values['unit'])['id']
                ?? throw new BusinessRuleViolation('UNIT_NOT_FOUND', "Unit {$values['unit']} does not exist or is inactive.");
        }
        if (! isset($payload['unit_id'])) {
            throw new BusinessRuleViolation('UNIT_REQUIRED', 'Enter the unit of the new product.');
        }
        if ($values['tax'] !== null) {
            $payload['tax_rate_id'] = $this->tax($context, $values['tax'])['id']
                ?? throw new BusinessRuleViolation('TAX_RATE_NOT_FOUND', "Tax rate {$values['tax']} does not exist or is inactive.");
        }
        foreach (['track_stock', 'track_batches', 'is_active'] as $flag) {
            if ($values[$flag] !== null) {
                $payload[$flag] = $values[$flag];
            }
        }

        return $payload;
    }

    /**
     * @param  array<string, mixed>  $payload
     * @param  array<int, array<string, mixed>>  $rows
     * @param  array<int, mixed>  $variants  matched variant (model) or null per row
     * @return array<string, mixed>
     */
    private function applyVariants(array $payload, array $rows, array $variants): array
    {
        $index = [];
        foreach ($payload['variants'] as $i => $variant) {
            $index[$variant['id']] = $i;
        }

        foreach ($rows as $number => $row) {
            $matched = $variants[$number];
            if ($matched !== null) {
                $i = $index[$matched->id];
                $payload['variants'][$i] = self::applyPrices($payload['variants'][$i], $row);
                if ($row['barcode'] !== null && ! in_array($row['barcode'], $payload['variants'][$i]['barcodes'], true)) {
                    $payload['variants'][$i]['barcodes'][] = $row['barcode'];
                }

                continue;
            }

            [$attributes] = self::attributes($row['variant_attributes']);
            $payload['options'] = self::mergeOptions($payload['options'], $attributes);
            $payload['variants'][] = self::applyPrices([
                'sku' => $row['sku'],
                'option_values' => $attributes,
                'purchase_price' => '0',
                'selling_price' => '0',
                'wholesale_price' => null,
                'reorder_level' => '0',
                'barcodes' => $row['barcode'] === null ? [] : [$row['barcode']],
                'is_active' => true,
            ], $row);
        }

        return $payload;
    }

    /**
     * @param  array<string, mixed>  $variant
     * @param  array<string, mixed>  $row
     * @return array<string, mixed>
     */
    private static function applyPrices(array $variant, array $row): array
    {
        foreach (['cost_price' => 'purchase_price', 'selling_price' => 'selling_price', 'wholesale_price' => 'wholesale_price', 'reorder_level' => 'reorder_level'] as $column => $field) {
            if ($row[$column] !== null) {
                $variant[$field] = $row[$column];
            }
        }

        return $variant;
    }

    /**
     * Adds option names and values (case-insensitive; existing spelling wins).
     *
     * @param  list<array{name: string, values: list<string>}>|null  $options
     * @param  array<string, string>  $attributes
     * @return list<array{name: string, values: list<string>}>|null
     */
    private static function mergeOptions(?array $options, array $attributes): ?array
    {
        if ($attributes === []) {
            return $options;
        }
        $options ??= [];
        foreach ($attributes as $name => $value) {
            $i = array_find_key($options, fn (array $o) => mb_strtolower($o['name']) === mb_strtolower($name));
            if ($i === null) {
                $options[] = ['name' => $name, 'values' => [$value]];

                continue;
            }
            if (! in_array(mb_strtolower($value), array_map('mb_strtolower', $options[$i]['values']), true)) {
                $options[$i]['values'][] = $value;
            }
        }

        return $options;
    }

    /**
     * Product details of a group: the first row that has each value.
     *
     * @param  array<int, array<string, mixed>>  $rows
     * @return array<string, mixed>
     */
    private static function productValues(array $rows): array
    {
        $values = array_fill_keys(self::PRODUCT_FIELDS, null);
        foreach ($rows as $row) {
            foreach (self::PRODUCT_FIELDS as $field) {
                $values[$field] ??= $row[$field];
            }
        }

        return $values;
    }

    /**
     * @param  array<string, string>  $attributes
     */
    private static function combination(array $attributes): string
    {
        $attributes = array_change_key_case(array_map('mb_strtolower', $attributes), CASE_LOWER);
        ksort($attributes);

        return (string) json_encode($attributes);
    }

    /**
     * @param  array<int, array<string, mixed>>  $rows
     * @return array<int, RowResult>
     */
    private static function failAll(array $rows, ?string $column, string $message): array
    {
        return array_map(fn () => RowResult::error($column, $message), $rows);
    }
}
