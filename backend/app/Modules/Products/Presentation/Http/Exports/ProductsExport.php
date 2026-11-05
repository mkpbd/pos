<?php

namespace App\Modules\Products\Presentation\Http\Exports;

use App\Modules\Catalog\Application\Contracts\CatalogDirectory;
use App\Modules\Shared\Application\Export\ExportColumn;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Shared\Infrastructure\Http\Exports\FilterSummary;
use App\Modules\Shared\Infrastructure\Http\Exports\ListExport;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Gate;

/**
 * GET /products?export=xlsx|pdf — one row per product (as the list shows them); prices are the
 * lowest of its variants, cost prices only for `products.view_cost`.
 */
class ProductsExport extends ListExport
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly CatalogDirectory $catalog,
    ) {}

    public function name(): string
    {
        return 'products';
    }

    public function title(): string
    {
        return 'Products';
    }

    public function columns(): array
    {
        $columns = [
            ExportColumn::text('name', 'Product'),
            ExportColumn::text('sku', 'SKU', fn (array $r) => self::variants($r)->pluck('sku')->filter()->implode(', ')),
            ExportColumn::text('barcodes', 'Barcodes', fn (array $r) => self::variants($r)->flatMap(fn (array $v) => collect($v['barcodes'] ?? []))->implode(', ')),
            ExportColumn::status('type', 'Type'),
            ExportColumn::text('category.name', 'Category'),
            ExportColumn::text('brand.name', 'Brand'),
            ExportColumn::text('unit.code', 'Unit', fn (array $r) => $r['unit']['code'] ?? $r['unit']['name'] ?? null),
            ExportColumn::number('variant_count', 'Variants', fn (array $r) => self::variants($r)->count()),
            ExportColumn::money('selling_price', 'Price', fn (array $r) => self::lowest($r, 'selling_price')),
        ];
        if (Gate::allows('products.view_cost')) {
            $columns[] = ExportColumn::money('purchase_price', 'Cost', fn (array $r) => self::lowest($r, 'purchase_price'));
        }
        $columns[] = ExportColumn::yesNo('is_active', 'Active');

        return $columns;
    }

    public function filters(Request $request): array
    {
        $org = $this->tenant->requireOrganization();

        return FilterSummary::of($request)
            ->search()
            ->lookup('category_id', 'Category', fn (string $id) => $this->catalog->describe($org, ['categories' => [$id]])['categories'][$id]['name'] ?? null)
            ->lookup('brand_id', 'Brand', fn (string $id) => $this->catalog->describe($org, ['brands' => [$id]])['brands'][$id]['name'] ?? null)
            ->value('type', 'Type')
            ->boolean('is_active', 'Active')
            ->flag('archived', 'Archived only')
            ->all();
    }

    /**
     * @param  array<string, mixed>  $row
     * @return Collection<int, array<string, mixed>>
     */
    private static function variants(array $row): Collection
    {
        return collect($row['variants'] ?? [])->map(fn ($v) => (array) $v);
    }

    /**
     * @param  array<string, mixed>  $row
     */
    private static function lowest(array $row, string $field): ?string
    {
        return self::variants($row)->pluck($field)->filter(fn ($v) => is_string($v) && $v !== '')
            ->reduce(fn (?string $min, string $v) => $min === null || Decimal::compare($v, $min) < 0 ? $v : $min);
    }
}
