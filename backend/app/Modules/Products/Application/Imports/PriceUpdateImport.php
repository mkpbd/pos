<?php

namespace App\Modules\Products\Application\Imports;

use App\Modules\Catalog\Application\Contracts\CatalogDirectory;
use App\Modules\Imports\Application\Data\ImportColumn;
use App\Modules\Imports\Application\Data\ImportContext;
use App\Modules\Imports\Application\Data\RowErrors;
use App\Modules\Imports\Application\Data\RowResult;
use App\Modules\Imports\Domain\ColumnType;
use App\Modules\Products\Application\Actions\SaveProduct;
use App\Modules\Products\Application\DTOs\ProductData;
use App\Modules\Products\Infrastructure\Models\Product;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Illuminate\Validation\ValidationException;

/**
 * ST1: price update. Each row names an existing variant by SKU (case-insensitive) or barcode and
 * sets its selling, cost and/or wholesale price; a blank cell leaves that price unchanged, and a
 * row that changes nothing is skipped. Saved through SaveProduct (price changes are audited).
 * Cost prices need products.view_cost.
 */
final class PriceUpdateImport extends ProductImportSupport
{
    public function __construct(
        private readonly SaveProduct $save,
        CatalogDirectory $catalog,
    ) {
        parent::__construct($catalog);
    }

    public function type(): string
    {
        return 'price_update';
    }

    public function label(): string
    {
        return 'Price update';
    }

    public function permission(): string
    {
        return 'products.manage';
    }

    public function columns(): array
    {
        return [
            new ImportColumn('sku_or_barcode', 'SKU or barcode', true, 'JUICE-250', 'The SKU or a barcode of an existing product variant.', maxLength: 128),
            new ImportColumn('selling_price', 'Selling price', false, '26.00', 'New selling price; blank = unchanged.', ColumnType::Decimal),
            new ImportColumn('cost_price', 'Cost price', false, '', 'New purchase price; blank = unchanged (needs permission to see cost prices).', ColumnType::Decimal),
            new ImportColumn('wholesale_price', 'Wholesale price', false, '', 'New wholesale price; blank = unchanged.', ColumnType::Decimal),
        ];
    }

    public function keyOf(array $row): ?string
    {
        return ($match = $this->lookup($row)) === null ? 'code:'.self::fold($row['sku_or_barcode']) : 'variant:'.$match;
    }

    public function prepare(array $rows, ImportContext $context): void
    {
        $codes = array_column($rows, 'sku_or_barcode');
        $this->loadVariants($context, $codes, $codes);
        $this->variantsByCode = [];
        foreach ($rows as $row) {
            $this->variantsByCode[self::fold($row['sku_or_barcode'])] = $this->resolve($row, $context)['variant_id'] ?? null;
        }
    }

    /** @var array<string, ?string> code → variant id, for keyOf() (no context there) */
    private array $variantsByCode = [];

    public function validateRow(array $row, ImportContext $context): RowResult
    {
        $errors = new RowErrors;
        $this->checkPrices($row, $errors, $context);
        $match = $this->resolve($row, $context);
        if ($match === null) {
            $errors->add('sku_or_barcode', "No product has the SKU or barcode {$row['sku_or_barcode']}.");
        } elseif ($match['archived']) {
            $errors->add('sku_or_barcode', "{$match['product_name']} is archived. Restore it first.");
        }
        if ($errors->any()) {
            return $errors->result();
        }

        $changes = array_filter([
            'selling_price' => $row['selling_price'] !== null && Decimal::compare($row['selling_price'], $match['selling_price']) !== 0,
            'cost_price' => $row['cost_price'] !== null && Decimal::compare($row['cost_price'], $match['purchase_price']) !== 0,
            'wholesale_price' => $row['wholesale_price'] !== null && ($match['wholesale_price'] === null || Decimal::compare($row['wholesale_price'], $match['wholesale_price']) !== 0),
        ]);

        return $changes === [] ? RowResult::skip() : RowResult::update();
    }

    public function importRow(array $row, ImportContext $context): RowResult
    {
        $variant = $this->findVariant($context, ['sku' => $row['sku_or_barcode']])
            ?? $this->findVariant($context, ['barcode' => $row['sku_or_barcode']]);
        if ($variant === null) {
            throw ValidationException::withMessages(['sku_or_barcode' => ["No product has the SKU or barcode {$row['sku_or_barcode']}."]]);
        }
        $product = Product::query()->withTrashed()->lockForUpdate()->findOrFail($variant->product_id);
        if ($product->trashed()) {
            throw new BusinessRuleViolation('PRODUCT_ARCHIVED', "{$product->name} is archived. Restore it first.");
        }

        $payload = ProductPayload::of($product);
        $changed = false;
        foreach ($payload['variants'] as $i => $entry) {
            if ($entry['id'] !== $variant->id) {
                continue;
            }
            foreach (['selling_price' => 'selling_price', 'cost_price' => 'purchase_price', 'wholesale_price' => 'wholesale_price'] as $column => $field) {
                if ($row[$column] !== null && ($entry[$field] === null || Decimal::compare($row[$column], (string) $entry[$field]) !== 0)) {
                    $payload['variants'][$i][$field] = $row[$column];
                    $changed = true;
                }
            }
        }
        if (! $changed) {
            return RowResult::skip();
        }

        ($this->save)($product, ProductData::fromArray($payload));

        return RowResult::update();
    }

    /**
     * SKU first, then barcode.
     *
     * @param  array<string, mixed>  $row
     * @return array<string, mixed>|null
     */
    private function resolve(array $row, ImportContext $context): ?array
    {
        return $this->match(['sku' => $row['sku_or_barcode']], $context)
            ?? $this->match(['barcode' => $row['sku_or_barcode']], $context);
    }

    /**
     * @param  array<string, mixed>  $row
     */
    private function lookup(array $row): ?string
    {
        return $this->variantsByCode[self::fold($row['sku_or_barcode'])] ?? null;
    }
}
