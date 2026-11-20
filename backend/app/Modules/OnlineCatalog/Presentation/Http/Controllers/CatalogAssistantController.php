<?php

namespace App\Modules\OnlineCatalog\Presentation\Http\Controllers;

use App\Modules\OnlineCatalog\Application\Assistants\AddBundlePicks;
use App\Modules\OnlineCatalog\Application\Assistants\DescribeBundle;
use App\Modules\OnlineCatalog\Application\Assistants\SuggestCategories;
use App\Modules\OnlineCatalog\Application\Queries\BundleIdeas;
use App\Modules\OnlineCatalog\Application\Queries\ListingEditor;
use App\Modules\OnlineCatalog\Infrastructure\Models\RelatedProduct;
use App\Modules\Products\Application\Contracts\ProductCategoryAssignment;
use App\Modules\Shared\Application\Support\StaffActor;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * AI2a: the online store's AI help for staff — category suggestions and bundle ideas.
 */
class CatalogAssistantController
{
    public function __construct(private readonly TenantContext $tenant) {}

    /**
     * Suggest categories with AI
     *
     * `{product_ids?: uuid[] ≤ 20}` (default: up to 20 active products without a category,
     * newest first) → `{suggestions: [{product: {id, name}, category: {id, path}|null, confidence:
     * high|medium|low, reason}], categories_considered}`. One model call; the model sees product
     * names, brands, options and the active category tree (≤ 400). Nothing is saved. 422
     * PRODUCT_NOT_FOUND (`details.product_ids`), NO_CATEGORIES, TOO_MANY_CATEGORIES
     * (`details.limit`, `details.count`), AI_UNAVAILABLE (`details.reason`: disabled |
     * budget_exceeded | unavailable | refused | empty | invalid). Counts against the AI budget.
     */
    public function suggestCategories(Request $request, SuggestCategories $suggest): JsonResponse
    {
        $data = $request->validate([
            'product_ids' => ['sometimes', 'array', 'min:1', 'max:'.SuggestCategories::MAX_PRODUCTS],
            'product_ids.*' => ['required', 'uuid', 'distinct'],
        ]);

        return ApiResponse::success($suggest(
            $this->tenant->requireOrganization(),
            isset($data['product_ids']) ? array_values($data['product_ids']) : null,
            StaffActor::id(),
        ));
    }

    /**
     * Apply category suggestions
     *
     * `{items: [{product_id, category_id}] ≤ 20}` → `{applied: [product_id], skipped:
     * [{product_id, reason: product_not_found|category_not_found|unchanged}]}`. Needs
     * `products.manage` too (it edits the products). One transaction; each product audited.
     */
    public function applyCategories(Request $request, ProductCategoryAssignment $assign): JsonResponse
    {
        $data = $request->validate([
            'items' => ['required', 'array', 'min:1', 'max:'.SuggestCategories::MAX_PRODUCTS],
            'items.*' => ['required', 'array:product_id,category_id'],
            'items.*.product_id' => ['required', 'uuid', 'distinct'],
            'items.*.category_id' => ['required', 'uuid'],
        ]);
        $items = array_map(fn (array $i) => ['product_id' => strtolower($i['product_id']), 'category_id' => strtolower($i['category_id'])], array_values($data['items']));

        return ApiResponse::success($assign->assign($this->tenant->requireOrganization(), $items, ['source' => 'ai_category_suggestions']));
    }

    /**
     * Bundle ideas
     *
     * Live products with their top 3 co-purchased live products (from the nightly
     * "frequently bought together" scores), leaving out products already hand-picked, 20 per
     * page: `[{anchor: {id, name, image_url}, frequently_bought_count, products: [{id, name,
     * image_url, score, orders_together}]}]`; `meta.last_run` (null before the first nightly run)
     * and `meta.computed_at`. `search` matches the main product's name.
     */
    public function bundleIdeas(Request $request, BundleIdeas $ideas): JsonResponse
    {
        $data = $request->validate([
            'search' => ['sometimes', 'nullable', 'string', 'max:100'],
            'page' => ['sometimes', 'integer', 'min:1', 'max:10000'],
        ]);
        $result = $ideas($data['search'] ?? null, (int) ($data['page'] ?? 1));

        return ApiResponse::success($result['items'], meta: [
            'pagination' => [
                'current_page' => $result['page'],
                'per_page' => $result['per_page'],
                'total' => $result['total'],
                'last_page' => max(1, (int) ceil($result['total'] / $result['per_page'])),
            ],
            'last_run' => $result['last_run'],
            'computed_at' => $result['computed_at'],
        ]);
    }

    /**
     * Describe a bundle with AI
     *
     * `{anchor_id, product_ids: uuid[] 1–3}` → `{title ≤ 60, pitch ≤ 160, translations: {bn:
     * {title, pitch}}}` (Bangla only when the store offers it). From product names and categories
     * only; nothing is saved. 404 for an unknown anchor, 422 PRODUCT_NOT_FOUND, AI_UNAVAILABLE
     * (`details.reason`). Counts against the AI budget.
     */
    public function describeBundle(Request $request, DescribeBundle $describe): JsonResponse
    {
        $data = $request->validate([
            'anchor_id' => ['required', 'uuid'],
            'product_ids' => ['required', 'array', 'min:1', 'max:'.DescribeBundle::MAX_PRODUCTS],
            'product_ids.*' => ['required', 'uuid', 'distinct', 'different:anchor_id'],
        ]);
        $result = $describe($this->tenant->requireOrganization(), $data['anchor_id'], array_values($data['product_ids']), StaffActor::id());

        return ApiResponse::success(['title' => $result['title'], 'pitch' => $result['pitch'], 'translations' => (object) $result['translations']]);
    }

    /**
     * Add a bundle to "frequently bought together"
     *
     * `{anchor_id, product_ids: uuid[] 1–12}` → `{anchor_id, added: [id], frequently_bought:
     * [{id, name, image_url, sku}]}`. Keeps the existing picks; products already picked are
     * skipped. 404 for an unknown anchor, 422 TOO_MANY_PICKS (`details.limit`, `details.room`),
     * PRODUCT_NOT_FOUND (`details.product_ids`).
     */
    public function applyBundle(Request $request, AddBundlePicks $add, ListingEditor $editor): JsonResponse
    {
        $max = RelatedProduct::MAX_PER_KIND;
        $data = $request->validate([
            'anchor_id' => ['required', 'uuid'],
            'product_ids' => ['required', 'array', 'min:1', "max:{$max}"],
            'product_ids.*' => ['required', 'uuid', 'distinct', 'different:anchor_id'],
        ]);
        $anchorId = strtolower($data['anchor_id']);
        $added = $add($this->tenant->requireOrganization(), $anchorId, array_values($data['product_ids']));

        return ApiResponse::success([
            'anchor_id' => $anchorId,
            'added' => $added,
            'frequently_bought' => $editor->product($anchorId)['related']['frequently_bought'],
        ]);
    }
}
