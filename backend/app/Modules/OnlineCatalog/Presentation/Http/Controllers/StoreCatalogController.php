<?php

namespace App\Modules\OnlineCatalog\Presentation\Http\Controllers;

use App\Modules\OnlineCatalog\Application\Queries\BrowseCatalog;
use App\Modules\OnlineCatalog\Application\Queries\CatalogNavigation;
use App\Modules\OnlineCatalog\Application\Queries\ProductPage;
use App\Modules\OnlineCatalog\Presentation\Http\Requests\BrowseCatalogRequest;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Storefront\Presentation\Http\Middleware\ResolveStorefront;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The public shop API: organization from the host name, no authentication.
 */
class StoreCatalogController
{
    /**
     * Category tree
     *
     * Visible categories; a category under a hidden one is attached to its nearest visible
     * ancestor. `product_count` counts live products in the category and below.
     */
    public function categories(CatalogNavigation $navigation): JsonResponse
    {
        return ApiResponse::success($navigation->categoryTree());
    }

    public function category(string $slug, CatalogNavigation $navigation): JsonResponse
    {
        return ApiResponse::success($navigation->category($slug));
    }

    public function brands(CatalogNavigation $navigation): JsonResponse
    {
        return ApiResponse::success($navigation->brands());
    }

    public function brand(string $slug, CatalogNavigation $navigation): JsonResponse
    {
        return ApiResponse::success($navigation->brand($slug));
    }

    /**
     * Product listing
     *
     * Filters: `q`, `category` (slug, includes subcategories; unknown → 404), `brand[]`, `price_min`,
     * `price_max`, `attr[<slug>][]`, `in_stock=1`, `on_sale=1`. Sorts: featured (default), popularity,
     * latest, price_asc, price_desc, name. `facets` are disjunctive (each ignores its own filter).
     * `slugs=a,b,c` (≤ 12) returns exactly those live products in that order, without facets.
     */
    public function products(BrowseCatalogRequest $request, BrowseCatalog $browse): JsonResponse
    {
        $params = $request->validated();
        $result = isset($params['slugs']) ? $browse->bySlugs($params['slugs']) : $browse->search($params);

        $response = ApiResponse::success($result['data'], meta: $result['meta']);
        $payload = $response->getData(true);
        $payload['facets'] = $result['facets'];
        $payload['context'] = $result['context'];

        return $response->setData($payload);
    }

    /**
     * Product page
     *
     * Live products only. `?preview=1` from signed-in staff of this store holding storefront.view
     * also opens drafts, scheduled and ended listings and adds `preview_state`.
     *
     * P1b: `video` {provider, id, url} | null, custom `badges` [{text, tone}], the store's
     * `delivery` note ({options: [{zone, method, min_days, max_days, fee, free_over}],
     * cod_available} | null), the builder `zones` resolved for this product
     * ({"product.below_price", "product.after", "product.bottom"}: render payload | null — the
     * product's own version, else its category's or an ancestor's, else the all-products one) and
     * `questions_count`. `?preview=draft` (staff, as above) resolves the zones over their drafts.
     */
    public function product(Request $request, string $slug, ProductPage $page): JsonResponse
    {
        $preview = $this->isPreview($request);
        $response = ApiResponse::success($page->show($slug, $preview, $preview && $request->query('preview') === 'draft'));

        return $preview ? $response->header('Cache-Control', 'no-store, private') : $response;
    }

    /**
     * Related products
     *
     * Hand-picked related products, else (P1b) up to 8 other products: in stock first, the same
     * category before the same brand, newest first. Frequently bought together: the hand-picked
     * ones (`frequently_bought_source: manual`), else up to 4 products most often bought with
     * this one in the last 180 days, live and in stock (`automatic`), else none (null).
     */
    public function related(Request $request, string $slug, ProductPage $page): JsonResponse
    {
        return ApiResponse::success($page->related($slug, $this->isPreview($request)));
    }

    /**
     * Search suggestions
     *
     * `q` of at least 2 characters: up to 6 products (names starting with the term first) and 4 categories.
     */
    public function suggest(Request $request, CatalogNavigation $navigation): JsonResponse
    {
        $data = $request->validate(['q' => ['sometimes', 'nullable', 'string', 'max:100']]);

        return ApiResponse::success($navigation->suggest((string) ($data['q'] ?? '')));
    }

    /**
     * `?preview=1`, or (P1b) the builder's `?preview=draft`, from staff of this store.
     */
    private function isPreview(Request $request): bool
    {
        return ($request->boolean('preview') || $request->query('preview') === 'draft') && $this->isStaff($request);
    }

    /**
     * A signed-in, active staff member of this store's organization holding storefront.view.
     */
    private function isStaff(Request $request): bool
    {
        $user = $request->user();

        return $user instanceof TenantUser
            && $user->isActive()
            && $user->organizationId() === $request->attributes->get(ResolveStorefront::ATTRIBUTE)['organization_id']
            && $user->can('storefront.view');
    }
}
