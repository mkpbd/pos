<?php

namespace App\Modules\Purchasing\Presentation\Http\Controllers;

use App\Modules\Products\Application\Contracts\ProductDirectory;
use App\Modules\Purchasing\Application\Actions\ManageSupplierCatalog;
use App\Modules\Purchasing\Infrastructure\Models\SupplierProduct;
use App\Modules\Purchasing\Presentation\Http\Exports\SupplierCatalogExport;
use App\Modules\Purchasing\Presentation\Http\Requests\SaveSupplierProductRequest;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Infrastructure\Http\Exports\ListExporter;
use App\Modules\Shared\Infrastructure\Http\Exports\RowSource;
use App\Modules\Shared\Infrastructure\Http\Queries\ListQuery;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Suppliers\Application\Contracts\SupplierDirectory;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Collection;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\Response;

/**
 * The supplier catalog (SC1). Organization-wide, like suppliers. The list is ordered by
 * product name through a read-only join on the Products tables (a presenting read model).
 */
class SupplierProductController
{
    private const SORTS = [
        'product' => 'p.name',
        'unit_cost' => 'supplier_products.unit_cost',
        'lead_time_days' => 'supplier_products.lead_time_days',
        'created_at' => 'supplier_products.created_at',
        'updated_at' => 'supplier_products.updated_at',
    ];

    public function __construct(
        private readonly TenantContext $tenant,
        private readonly SupplierDirectory $suppliers,
        private readonly ProductDirectory $products,
    ) {}

    /**
     * List the supplier catalog
     *
     * Filters: `supplier_id`, `variant_id`, `is_active`, `is_preferred`; `search` matches the
     * supplier SKU or the product name, SKU or barcode. `sort`: `product` (default),
     * `unit_cost`, `lead_time_days`, `created_at`, `updated_at` (prefix `-` for descending).
     */
    public function index(Request $request, ListExporter $exports): Response
    {
        $request->validate([
            'supplier_id' => ['sometimes', 'uuid'],
            'variant_id' => ['sometimes', 'uuid'],
            'is_active' => ['sometimes', 'boolean'],
            'is_preferred' => ['sometimes', 'boolean'],
            'search' => ['sometimes', 'string', 'max:100'],
            'sort' => ['sometimes', Rule::in(array_merge(array_keys(self::SORTS), array_map(fn ($s) => '-'.$s, array_keys(self::SORTS))))],
        ]);
        $sort = (string) $request->query('sort', 'product');

        $query = SupplierProduct::query()
            ->select('supplier_products.*')
            ->join('product_variants as pv', 'pv.id', '=', 'supplier_products.variant_id')
            ->join('products as p', 'p.id', '=', 'pv.product_id')
            ->when($request->query('supplier_id'), fn (Builder $q, string $id) => $q->where('supplier_products.supplier_id', $id))
            ->when($request->query('variant_id'), fn (Builder $q, string $id) => $q->where('supplier_products.variant_id', $id))
            ->when($request->has('is_active'), fn (Builder $q) => $q->where('supplier_products.is_active', $request->boolean('is_active')))
            ->when($request->has('is_preferred'), fn (Builder $q) => $q->where('supplier_products.is_preferred', $request->boolean('is_preferred')))
            ->orderBy(self::SORTS[ltrim($sort, '-')], str_starts_with($sort, '-') ? 'desc' : 'asc')
            ->orderBy('p.name')->orderBy('pv.sort_order')->orderBy('supplier_products.id');

        $search = trim((string) $request->query('search', ''));
        if ($search !== '') {
            $variantIds = $this->products->searchVariantIds($this->tenant->requireOrganization(), $search);
            $query->where(fn (Builder $q) => $q
                ->whereLike('supplier_products.supplier_sku', '%'.addcslashes($search, '%_\\').'%')
                ->orWhereIn('supplier_products.variant_id', $variantIds));
        }

        if ($format = ListExporter::requested($request)) {
            return $exports->download($request, $format, SupplierCatalogExport::class, RowSource::fromQuery($query, fn (Collection $rows) => $rows->map($this->presenter($rows))));
        }
        $page = $query->paginate(ListQuery::perPage($request));
        $present = $this->presenter(collect($page->items()));

        return ApiResponse::paginated($page, fn (SupplierProduct $row) => new JsonResource($present($row)));
    }

    /**
     * Catalog terms for a purchase order
     *
     * Active catalog rows of one supplier for the given variants (`variant_ids[]`, up to 500):
     * cost, pack size, minimum order and lead time, to prefill purchase order lines.
     */
    public function lookup(Request $request): JsonResponse
    {
        $request->validate([
            'supplier_id' => ['required', 'uuid'],
            'variant_ids' => ['required', 'array', 'min:1', 'max:500'],
            'variant_ids.*' => ['required', 'uuid'],
        ]);

        $rows = SupplierProduct::query()
            ->where('supplier_id', $request->query('supplier_id'))
            ->whereIn('variant_id', array_values((array) $request->query('variant_ids')))
            ->where('is_active', true)
            ->get();

        return ApiResponse::success($rows->map(fn (SupplierProduct $row) => [
            'supplier_product_id' => $row->id,
            'variant_id' => $row->variant_id,
            'supplier_sku' => $row->supplier_sku,
            'unit_cost' => $row->unit_cost,
            'pack_size' => $row->pack_size,
            'min_order_qty' => $row->min_order_qty,
            'lead_time_days' => $row->lead_time_days,
            'is_preferred' => $row->is_preferred,
            'last_purchase_cost' => $row->last_purchase_cost,
        ])->values()->all());
    }

    public function store(SaveSupplierProductRequest $request, ManageSupplierCatalog $catalog): JsonResponse
    {
        $row = $catalog->create($request->validated());

        return ApiResponse::created(($this->presenter(collect([$row])))($row));
    }

    public function update(SaveSupplierProductRequest $request, SupplierProduct $supplierProduct, ManageSupplierCatalog $catalog): JsonResponse
    {
        $row = $catalog->update($supplierProduct, $request->validated());

        return ApiResponse::success(($this->presenter(collect([$row])))($row));
    }

    public function prefer(SupplierProduct $supplierProduct, ManageSupplierCatalog $catalog): JsonResponse
    {
        $row = $catalog->prefer($supplierProduct);

        return ApiResponse::success(($this->presenter(collect([$row])))($row));
    }

    public function destroy(SupplierProduct $supplierProduct, ManageSupplierCatalog $catalog): JsonResponse
    {
        $catalog->delete($supplierProduct);

        return ApiResponse::noContent();
    }

    /**
     * @param  Collection<int, SupplierProduct>  $rows
     * @return callable(SupplierProduct): array<string, mixed>
     */
    private function presenter(Collection $rows): callable
    {
        $org = $this->tenant->requireOrganization();
        $suppliers = $this->suppliers->summaries($org, $rows->pluck('supplier_id')->unique()->values()->all());
        $variants = $this->products->variants($org, $rows->pluck('variant_id')->unique()->values()->all());

        return function (SupplierProduct $row) use ($suppliers, $variants) {
            $variant = $variants[$row->variant_id] ?? null;

            return [
                'id' => $row->id,
                'supplier' => $suppliers[$row->supplier_id] ?? null,
                'variant' => $variant === null ? null : [
                    'id' => $variant['variant_id'],
                    'product_id' => $variant['product_id'],
                    'sku' => $variant['sku'],
                    'product_name' => $variant['product_name'],
                    'variant_name' => $variant['variant_name'],
                    'unit' => $variant['unit_code'],
                    'allow_decimal' => $variant['allow_decimal'],
                ],
                'supplier_sku' => $row->supplier_sku,
                'unit_cost' => $row->unit_cost,
                'pack_size' => $row->pack_size,
                'min_order_qty' => $row->min_order_qty,
                'lead_time_days' => $row->lead_time_days,
                'is_preferred' => $row->is_preferred,
                'last_purchase_cost' => $row->last_purchase_cost,
                'last_purchased_at' => $row->last_purchased_at?->toIso8601String(),
                'is_active' => $row->is_active,
                'created_at' => $row->created_at?->toIso8601String(),
                'updated_at' => $row->updated_at?->toIso8601String(),
            ];
        };
    }
}
