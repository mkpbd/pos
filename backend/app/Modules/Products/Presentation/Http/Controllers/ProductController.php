<?php

namespace App\Modules\Products\Presentation\Http\Controllers;

use App\Modules\Catalog\Application\Contracts\CatalogDirectory;
use App\Modules\Products\Application\Actions\ArchiveProduct;
use App\Modules\Products\Application\Actions\FindSellableVariant;
use App\Modules\Products\Application\Actions\ManageProductImages;
use App\Modules\Products\Application\Actions\SaveOptionImages;
use App\Modules\Products\Application\Actions\SaveProduct;
use App\Modules\Products\Application\Actions\SaveVariantGrid;
use App\Modules\Products\Application\Contracts\VariantStock;
use App\Modules\Products\Application\Contracts\VariantWebData;
use App\Modules\Products\Application\DTOs\ProductData;
use App\Modules\Products\Domain\ProductType;
use App\Modules\Products\Infrastructure\Models\Product;
use App\Modules\Products\Infrastructure\Models\ProductImage;
use App\Modules\Products\Presentation\Http\Exports\ProductsExport;
use App\Modules\Products\Presentation\Http\Requests\SaveOptionImagesRequest;
use App\Modules\Products\Presentation\Http\Requests\SaveProductRequest;
use App\Modules\Products\Presentation\Http\Requests\SaveVariantGridRequest;
use App\Modules\Products\Presentation\Http\Resources\ProductResource;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Infrastructure\Http\Exports\ListExporter;
use App\Modules\Shared\Infrastructure\Http\Exports\RowSource;
use App\Modules\Shared\Infrastructure\Http\Queries\ListQuery;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

class ProductController
{
    public function __construct(
        private readonly CatalogDirectory $catalog,
        private readonly TenantContext $tenant,
        private readonly VariantWebData $webData,
        private readonly VariantStock $stock,
    ) {}

    /**
     * List products
     *
     * `search` matches name, SKU and barcode. Filters: `category_id`, `brand_id`, `type`,
     * `is_active`, `archived=1` (archived products only).
     */
    public function index(Request $request, ListExporter $exports): Response
    {
        $request->validate([
            'category_id' => ['sometimes', 'uuid'],
            'brand_id' => ['sometimes', 'uuid'],
            'type' => ['sometimes', Rule::enum(ProductType::class)],
            'is_active' => ['sometimes', 'boolean'],
            'archived' => ['sometimes', 'boolean'],
        ]);

        $search = trim((string) $request->query('search', ''));
        $query = Product::query()
            ->with(['variants.barcodes', 'images'])
            ->when($request->boolean('archived'), fn (Builder $q) => $q->onlyTrashed())
            ->when($request->query('category_id'), fn (Builder $q, string $id) => $q->where('category_id', $id))
            ->when($request->query('brand_id'), fn (Builder $q, string $id) => $q->where('brand_id', $id))
            ->when($request->query('type'), fn (Builder $q, string $type) => $q->where('type', $type))
            ->when($request->has('is_active'), fn (Builder $q) => $q->where('is_active', $request->boolean('is_active')))
            ->when($search !== '', function (Builder $q) use ($search) {
                $like = '%'.addcslashes($search, '%_\\').'%';
                $q->where(fn (Builder $w) => $w
                    ->whereLike('name', $like)
                    ->orWhereHas('variants', fn (Builder $v) => $v
                        ->whereLike('sku', $like)
                        ->orWhereHas('barcodes', fn (Builder $b) => $b->where('barcode', $search))));
            });

        ListQuery::apply($query, $request, sortable: ['name', 'created_at', 'updated_at'], defaultSort: 'name');
        if ($format = ListExporter::requested($request)) {
            return $exports->download($request, $format, ProductsExport::class, RowSource::fromQuery($query, fn (Collection $products) => $products->map($this->presenter($request, $products))));
        }
        $page = $query->paginate(ListQuery::perPage($request));
        $present = $this->presenter($request, collect($page->items()));

        return ApiResponse::paginated($page, $present);
    }

    public function store(SaveProductRequest $request, SaveProduct $save): JsonResponse
    {
        $product = $save(null, ProductData::fromArray($request->validated()));

        return ApiResponse::created($this->present($request, $product));
    }

    public function show(Request $request, Product $product): JsonResponse
    {
        return ApiResponse::success($this->present($request, $product));
    }

    public function update(SaveProductRequest $request, Product $product, SaveProduct $save): JsonResponse
    {
        $product = $save($product, ProductData::fromArray($request->validated()));

        return ApiResponse::success($this->present($request, $product));
    }

    /**
     * Archive a product
     */
    public function destroy(Product $product, ArchiveProduct $archive): JsonResponse
    {
        $archive->archive($product);

        return ApiResponse::noContent();
    }

    public function restore(Request $request, string $productId, ArchiveProduct $archive): JsonResponse
    {
        $product = Product::onlyTrashed()->findOrFail($productId);

        return ApiResponse::success($this->present($request, $archive->restore($product)));
    }

    /**
     * Look up a code
     *
     * Exact barcode, or SKU (case-insensitive). 422 `PRODUCT_NOT_SELLABLE` for archived/inactive items.
     */
    public function lookup(Request $request, FindSellableVariant $find): JsonResponse
    {
        $data = $request->validate(['code' => ['required', 'string', 'max:128']]);
        $variant = $find($data['code']);
        $product = $variant->product->setRelation('variants', collect([$variant->load('barcodes')]));

        return ApiResponse::success($this->present($request, $product, loadVariants: false));
    }

    public function addImage(Request $request, Product $product, ManageProductImages $images): JsonResponse
    {
        $request->validate([
            // Raster formats only: SVG can carry scripts.
            'image' => ['required', 'file', 'image', 'mimes:jpeg,png,webp', 'max:2048', 'dimensions:max_width=4000,max_height=4000'],
        ]);
        $images->add($product, $request->file('image'));

        return ApiResponse::created($this->present($request, $product));
    }

    public function removeImage(Request $request, Product $product, string $imageId, ManageProductImages $images): JsonResponse
    {
        $image = ProductImage::query()->where('product_id', $product->id)->whereKey($imageId)->first()
            ?? throw new NotFoundHttpException;
        $images->remove($product, $image);

        return ApiResponse::success($this->present($request, $product));
    }

    /**
     * Save the variant grid
     *
     * P1a: options and every variant row in one transaction. Rows without an id are matched to
     * existing variants by option values; `opening_stock` of new variants needs
     * `inventory.adjust` and `stock_store_id` (posted as opening stock, note "Variant grid");
     * `compare_at_price` is saved only for users with `online_catalog.manage`.
     */
    public function saveVariants(SaveVariantGridRequest $request, Product $product, SaveVariantGrid $save): JsonResponse
    {
        /** @var TenantUser $user */
        $user = $request->user();
        $product = $save($product, $request->gridData(), $user, (bool) $request->user()?->can('online_catalog.manage'));

        return ApiResponse::success($this->present($request, $product->refresh()));
    }

    /**
     * Save photos by colour
     *
     * P1a: the photo option, its values' ordered product image ids and the options' swatch
     * styles (`color`, `image`, `button`; null removes a style). Values not sent lose their photos.
     */
    public function saveOptionImages(SaveOptionImagesRequest $request, Product $product, SaveOptionImages $save): JsonResponse
    {
        $product = $save($product, $request->optionData());

        return ApiResponse::success($this->present($request, $product->refresh()));
    }

    private function present(Request $request, Product $product, bool $loadVariants = true): ProductResource
    {
        if (! $loadVariants) {
            $product->loadMissing('images');

            return ($this->presenter($request, collect([$product])))($product);
        }

        $product->load(['variants.barcodes', 'images', 'optionImages']);
        $ids = $product->variants->pluck('id')->all();
        /** @var TenantUser $user */
        $user = $request->user();
        $extras = [
            'compare_at' => $this->webData->compareAtPrices($ids),
            'back_in_stock' => $this->webData->openBackInStockRequests($ids),
            'stock' => $this->stock->levels($user, $ids),
        ];

        return ($this->presenter($request, collect([$product]), $extras))($product);
    }

    /**
     * Builds a ProductResource factory with catalog labels fetched once for the whole page.
     *
     * @param  Collection<int, Product>  $products
     * @return callable(Product): ProductResource
     */
    private function presenter(Request $request, Collection $products, ?array $extras = null): callable
    {
        $catalog = $this->catalog->describe($this->tenant->requireOrganization(), [
            'categories' => $products->pluck('category_id')->filter()->all(),
            'brands' => $products->pluck('brand_id')->filter()->all(),
            'units' => $products->pluck('unit_id')->filter()->all(),
            'tax_rates' => $products->pluck('tax_rate_id')->filter()->all(),
        ]);
        $withCost = (bool) $request->user()?->can('products.view_cost');

        return fn (Product $product) => new ProductResource($product, $catalog, $withCost, $extras);
    }
}
