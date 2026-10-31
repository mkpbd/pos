<?php

namespace App\Modules\Pos\Presentation\Http\Controllers;

use App\Modules\Catalog\Application\Contracts\CatalogDirectory;
use App\Modules\Inventory\Application\Contracts\StockLevels;
use App\Modules\Inventory\Application\Services\StoreAccess;
use App\Modules\Pos\Application\Actions\Checkout;
use App\Modules\Pos\Presentation\Http\Requests\CartRequest;
use App\Modules\Pos\Presentation\Http\Requests\CheckoutRequest;
use App\Modules\Products\Application\Actions\FindSellableVariant;
use App\Modules\Products\Application\Contracts\ProductDirectory;
use App\Modules\Sales\Application\Services\CartPricer;
use App\Modules\Sales\Presentation\Http\Support\SalePresenter;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The POS terminal: product grid, scanning, live cart pricing and checkout.
 */
class PosController
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly StoreAccess $storeAccess,
        private readonly ProductDirectory $products,
        private readonly StockLevels $stock,
    ) {}

    /**
     * Product grid
     *
     * Sellable variants with price, tax rate and quantity on hand in `store_id`.
     * `category_id` includes its sub-categories; `search` matches name, SKU or an exact barcode.
     */
    public function catalog(Request $request, CatalogDirectory $catalog): JsonResponse
    {
        $data = $request->validate([
            'store_id' => ['required', 'uuid'],
            'category_id' => ['sometimes', 'uuid'],
            'search' => ['sometimes', 'nullable', 'string', 'max:100'],
            'page' => ['sometimes', 'integer', 'min:1'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:100'],
        ]);
        $store = $this->storeAccess->require($this->user($request), $data['store_id']);
        $organizationId = $this->tenant->requireOrganization();
        $categoryIds = isset($data['category_id']) ? $catalog->categoryWithDescendants($organizationId, $data['category_id']) : null;
        $page = (int) ($data['page'] ?? 1);
        $perPage = (int) ($data['per_page'] ?? 48);

        $result = $this->products->sellablePage($organizationId, ['search' => $data['search'] ?? null, 'category_ids' => $categoryIds], $page, $perPage);
        $onHand = $this->stock->onHand($store['id'], array_column($result['items'], 'variant_id'));

        return ApiResponse::success(
            array_map(fn (array $v) => $this->item($v, $onHand), $result['items']),
            meta: ['pagination' => [
                'current_page' => $page,
                'per_page' => $perPage,
                'total' => $result['total'],
                'last_page' => max(1, (int) ceil($result['total'] / $perPage)),
            ]],
        );
    }

    /**
     * Scan or type a code
     *
     * Exact barcode, then SKU. `404` when unknown, `PRODUCT_NOT_SELLABLE` when archived/inactive.
     */
    public function lookup(Request $request, FindSellableVariant $find): JsonResponse
    {
        $data = $request->validate(['code' => ['required', 'string', 'max:100'], 'store_id' => ['required', 'uuid']]);
        $store = $this->storeAccess->require($this->user($request), $data['store_id']);
        $variantId = $find($data['code'])->id;
        $variant = $this->products->variants($this->tenant->requireOrganization(), [$variantId])[$variantId];

        return ApiResponse::success($this->item($variant + ['image_url' => null], $this->stock->onHand($store['id'], [$variantId])));
    }

    /**
     * Price a cart
     *
     * The live preview: server prices, discounts (rules enforced), tax and totals, plus the
     * customer's credit position and informational stock availability. Nothing is saved.
     */
    public function price(CartRequest $request, CartPricer $pricer): JsonResponse
    {
        $user = $this->user($request);
        $store = $this->storeAccess->require($user, $request->validated('store_id'));

        return ApiResponse::success($pricer->price($user, $store, $request->validated()));
    }

    /**
     * Checkout
     *
     * Requires an `Idempotency-Key` header (reuse it when retrying). Prices the cart again,
     * takes the payments and posts the sale and its stock deduction in one transaction.
     * Returns the invoice (`201`).
     */
    public function checkout(CheckoutRequest $request, Checkout $checkout, SalePresenter $presenter): JsonResponse
    {
        $sale = $checkout($this->user($request), $request->validated());

        return ApiResponse::created($presenter->document($sale, $request->user()->can('products.view_cost')));
    }

    /**
     * @param  array<string, mixed>  $v
     * @param  array<string, string>  $onHand
     * @return array<string, mixed>
     */
    private function item(array $v, array $onHand): array
    {
        return [
            'variant_id' => $v['variant_id'],
            'product_id' => $v['product_id'],
            'product_name' => $v['product_name'],
            'variant_name' => $v['variant_name'],
            'sku' => $v['sku'],
            'unit_code' => $v['unit_code'],
            'allow_decimal' => $v['allow_decimal'],
            'price' => Decimal::round($v['selling_price'], 2),
            'tax_rate' => $v['tax_rate'] === null ? '0.0000' : Decimal::round($v['tax_rate'], 4),
            'max_discount_percent' => $v['max_discount_percent'],
            'track_stock' => $v['track_stock'],
            'track_batches' => $v['track_batches'],
            'track_serials' => $v['track_serials'],
            'category_id' => $v['category_id'],
            'image_url' => $v['image_url'] ?? null,
            'on_hand' => $v['track_stock'] ? ($onHand[$v['variant_id']] ?? '0.000') : null,
            'sellable' => $v['sellable'],
        ];
    }

    private function user(Request $request): TenantUser
    {
        /** @var TenantUser */
        return $request->user();
    }
}
