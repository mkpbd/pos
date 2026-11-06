<?php

namespace App\Modules\Inventory\Presentation\Http\Controllers;

use App\Modules\Inventory\Application\Actions\ManageReorderRules;
use App\Modules\Inventory\Infrastructure\Models\StockReorderRule;
use App\Modules\Inventory\Presentation\Http\Requests\SaveReorderRulesRequest;
use App\Modules\Inventory\Presentation\Http\Support\InventoryPresenter;
use App\Modules\Products\Application\Contracts\ProductDirectory;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Infrastructure\Http\Queries\ListQuery;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Collection;

/**
 * Per-store reorder rules (SC1). The list is ordered by product name through a read-only
 * join on the Products tables (a presenting read model, like the stock list).
 */
class ReorderRuleController
{
    public function __construct(
        private readonly InventoryPresenter $presenter,
        private readonly TenantContext $tenant,
        private readonly ProductDirectory $products,
    ) {}

    /**
     * List reorder rules
     *
     * Rules of the user's branches. Filters: `store_id`, `variant_id`, `is_active`, `search`
     * (product name, SKU or barcode); `per_page` up to 100.
     */
    public function index(Request $request): JsonResponse
    {
        $request->validate([
            'store_id' => ['sometimes', 'uuid'],
            'variant_id' => ['sometimes', 'uuid'],
            'is_active' => ['sometimes', 'boolean'],
            'search' => ['sometimes', 'string', 'max:100'],
        ]);
        $user = $this->user($request);

        $query = StockReorderRule::query()
            ->select('stock_reorder_rules.*')
            ->join('product_variants as pv', 'pv.id', '=', 'stock_reorder_rules.variant_id')
            ->join('products as p', 'p.id', '=', 'pv.product_id')
            ->when($request->query('store_id'), fn (Builder $q, string $id) => $q->where('stock_reorder_rules.store_id', $id))
            ->when($request->query('variant_id'), fn (Builder $q, string $id) => $q->where('stock_reorder_rules.variant_id', $id))
            ->when($request->has('is_active'), fn (Builder $q) => $q->where('stock_reorder_rules.is_active', $request->boolean('is_active')))
            ->orderBy('p.name')->orderBy('pv.sort_order')->orderBy('stock_reorder_rules.id');
        $this->presenter->scopeBranches($query, $user, null, 'stock_reorder_rules.branch_id');

        $search = trim((string) $request->query('search', ''));
        if ($search !== '') {
            $query->whereIn('stock_reorder_rules.variant_id', $this->products->searchVariantIds($this->tenant->requireOrganization(), $search));
        }

        $page = $query->paginate(ListQuery::perPage($request));
        $present = $this->presentAll(collect($page->items()));

        return ApiResponse::paginated($page, fn (StockReorderRule $r) => new JsonResource($present($r)));
    }

    /**
     * Save reorder rules
     *
     * Bulk upsert (up to 500 rows) of one store's rules by variant; returns the saved rules.
     */
    public function upsert(SaveReorderRulesRequest $request, ManageReorderRules $rules): JsonResponse
    {
        $saved = $rules->upsert($this->user($request), $request->validated('store_id'), $request->validated('rules'));
        $present = $this->presentAll($saved);

        return ApiResponse::success($saved->map(fn (StockReorderRule $r) => $present($r))->values()->all());
    }

    public function destroy(Request $request, StockReorderRule $reorderRule, ManageReorderRules $rules): JsonResponse
    {
        $rules->delete($this->user($request), $reorderRule);

        return ApiResponse::noContent();
    }

    /**
     * @param  Collection<int, StockReorderRule>  $rules
     * @return callable(StockReorderRule): array<string, mixed>
     */
    private function presentAll(Collection $rules): callable
    {
        $lookups = $this->presenter->lookups($rules->pluck('variant_id')->all(), $rules->pluck('store_id')->all());

        return fn (StockReorderRule $r) => [
            'id' => $r->id,
            'store' => $lookups['stores'][$r->store_id] ?? null,
            'variant' => InventoryPresenter::variant($lookups['variants'][$r->variant_id] ?? null),
            'min_qty' => $r->min_qty,
            'max_qty' => $r->max_qty,
            'is_active' => $r->is_active,
            'updated_at' => $r->updated_at?->toIso8601String(),
        ];
    }

    private function user(Request $request): TenantUser
    {
        /** @var TenantUser */
        return $request->user();
    }
}
