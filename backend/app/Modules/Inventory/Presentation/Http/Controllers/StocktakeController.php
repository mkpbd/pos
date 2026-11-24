<?php

namespace App\Modules\Inventory\Presentation\Http\Controllers;

use App\Modules\Inventory\Application\Actions\CancelStocktake;
use App\Modules\Inventory\Application\Actions\CountStocktake;
use App\Modules\Inventory\Application\Actions\CreateStocktake;
use App\Modules\Inventory\Application\Actions\PostStocktake;
use App\Modules\Inventory\Application\Actions\StartStocktake;
use App\Modules\Inventory\Application\Services\StocktakeAccess;
use App\Modules\Inventory\Domain\StocktakeStatus;
use App\Modules\Inventory\Domain\UncountedPolicy;
use App\Modules\Inventory\Infrastructure\Models\Stocktake;
use App\Modules\Inventory\Infrastructure\Models\StocktakeLine;
use App\Modules\Inventory\Presentation\Http\Exports\StocktakeLinesExport;
use App\Modules\Inventory\Presentation\Http\Requests\CountStocktakeLinesRequest;
use App\Modules\Inventory\Presentation\Http\Requests\CreateStocktakeRequest;
use App\Modules\Inventory\Presentation\Http\Requests\PostStocktakeRequest;
use App\Modules\Inventory\Presentation\Http\Requests\ScanStocktakeRequest;
use App\Modules\Inventory\Presentation\Http\Support\InventoryPresenter;
use App\Modules\Inventory\Presentation\Http\Support\StocktakePresenter;
use App\Modules\Products\Application\Contracts\ProductDirectory;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Infrastructure\Http\Exports\ListExporter;
use App\Modules\Shared\Infrastructure\Http\Exports\RowSource;
use App\Modules\Shared\Infrastructure\Http\Queries\ListQuery;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;

/**
 * ST1: stocktake sessions — create, start, count (set / scan / clear), post as one stock
 * adjustment, cancel. Reading needs `inventory.view` or `inventory.stocktake`.
 */
class StocktakeController
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly StocktakeAccess $access,
        private readonly StocktakePresenter $presenter,
        private readonly InventoryPresenter $inventory,
    ) {}

    /**
     * Stocktakes
     *
     * Filters: `store_id`, `branch_id`, `status` (draft|counting|posted|cancelled); `search`
     * matches the number. Each row carries `lines_count` and `counted_count`.
     */
    public function index(Request $request): JsonResponse
    {
        $user = $this->reader($request);
        $request->validate(['store_id' => ['sometimes', 'uuid'], 'branch_id' => ['sometimes', 'uuid'], 'status' => ['sometimes', Rule::enum(StocktakeStatus::class)]]);

        $query = Stocktake::query()
            ->withCount(['lines', 'lines as counted_count' => fn (Builder $q) => $q->whereNotNull('counted_quantity')])
            ->when($request->query('store_id'), fn (Builder $q, string $v) => $q->where('store_id', $v))
            ->when($request->query('status'), fn (Builder $q, string $v) => $q->where('status', $v));
        $this->inventory->scopeBranches($query, $user, $request->query('branch_id'));
        ListQuery::apply($query, $request, sortable: ['created_at', 'number'], searchable: ['number']);
        $page = $query->paginate(ListQuery::perPage($request));
        $row = $this->presenter->rows(collect($page->items()));

        return ApiResponse::paginated($page, fn (Stocktake $s) => new JsonResource($row($s)));
    }

    /**
     * Stocktake
     *
     * The stocktake with `summary {lines, counted, uncounted, with_variance, variance_quantity_in,
     * variance_quantity_out, variance_value}`; variance figures are null on a blind stocktake for
     * users without `inventory.adjust`, the value without `products.view_cost`.
     */
    public function show(Request $request, Stocktake $stocktake): JsonResponse
    {
        $user = $this->reader($request);
        $this->access->assertVisible($user, $stocktake);

        return ApiResponse::success($this->presenter->detail($stocktake, $user));
    }

    /**
     * Stocktake lines
     *
     * `filter` all|uncounted|counted|variance, `search` (product name, SKU, barcode), paginated in
     * count-sheet order; `?export=xlsx|csv|pdf`. `variance` is refused (403) to users who may
     * not see the system quantity of a blind stocktake.
     */
    public function lines(Request $request, Stocktake $stocktake, ProductDirectory $products, ListExporter $exports, StocktakeLinesExport $export): Response
    {
        $user = $this->reader($request);
        $this->access->assertVisible($user, $stocktake);
        $request->validate(['filter' => ['sometimes', Rule::in(['all', 'uncounted', 'counted', 'variance'])], 'search' => ['sometimes', 'nullable', 'string', 'max:100']]);
        $filter = (string) $request->query('filter', 'all');
        if ($filter === 'variance' && ! StocktakePresenter::seesSystem($user, $stocktake)) {
            throw new AccessDeniedHttpException('This stocktake is blind: differences are shown to stock managers only.');
        }
        $search = trim((string) $request->query('search', ''));

        $query = StocktakeLine::query()->where('stocktake_id', $stocktake->id)
            ->when($filter === 'uncounted', fn (Builder $q) => $q->whereNull('counted_quantity'))
            ->when($filter === 'counted', fn (Builder $q) => $q->whereNotNull('counted_quantity'))
            ->when($filter === 'variance', fn (Builder $q) => $q->whereNotNull('counted_quantity')->whereColumn('counted_quantity', '<>', 'system_quantity'))
            ->when($search !== '', fn (Builder $q) => $q->whereIn('variant_id', $products->searchVariantIds($this->tenant->requireOrganization(), $search, 2000)))
            ->orderBy('position')->orderBy('id');

        if ($format = ListExporter::requested($request)) {
            return $exports->download($request, $format, $export->forStocktake($stocktake->number), RowSource::fromQuery($query, fn (Collection $lines) => collect($this->presenter->lines($stocktake, $lines, $user))));
        }
        $page = $query->paginate(ListQuery::perPage($request));
        $rows = $this->presenter->lines($stocktake, collect($page->items()), $user);
        $byId = collect($rows)->keyBy('id');

        return ApiResponse::paginated($page, fn (StocktakeLine $l) => new JsonResource($byId[$l->id]));
    }

    /**
     * New stocktake
     *
     * `{store_id, scope: all|categories|products, scope_ids?, blind?, notes?}` → draft. Another
     * open stocktake of the store → 409 STOCKTAKE_OPEN (`details.stocktake_id`, `details.number`).
     */
    public function store(CreateStocktakeRequest $request, CreateStocktake $create): JsonResponse
    {
        $user = $this->user($request);
        $stocktake = $create($user, $request->validated());

        return ApiResponse::created($this->presenter->detail($stocktake, $user));
    }

    /**
     * Start counting
     *
     * Creates the count lines (stock-tracked active products in scope with a stock row in the
     * store; batch-tracked: one per batch with stock). Only from draft (409 INVALID_STATUS_CHANGE).
     */
    public function start(Request $request, Stocktake $stocktake, StartStocktake $start): JsonResponse
    {
        $user = $this->user($request);

        return ApiResponse::success($this->presenter->detail($start($user, $stocktake), $user));
    }

    /**
     * Set counts
     *
     * `{lines: [{variant_id, batch_id?, counted_quantity, note?}]}` (≤ 500). Snapshots each line's
     * system quantity now; products not in the stocktake become extra lines. Returns the lines.
     */
    public function count(CountStocktakeLinesRequest $request, Stocktake $stocktake, CountStocktake $count): JsonResponse
    {
        $user = $this->user($request);
        $lines = $count->set($user, $stocktake, $request->validated('lines'));

        return ApiResponse::success(['lines' => $this->presenter->lines($stocktake, collect($lines), $user)]);
    }

    /**
     * Scan
     *
     * `{barcode, quantity? = 1, batch_id?}` adds to the matching line (barcode, else SKU).
     * 422 UNKNOWN_BARCODE; 422 BATCH_REQUIRED with `details.variant` and `details.batches` for a
     * batch-tracked product scanned without `batch_id`; 422 NOT_STOCK_TRACKED.
     */
    public function scan(ScanStocktakeRequest $request, Stocktake $stocktake, CountStocktake $count): JsonResponse
    {
        $user = $this->user($request);
        $data = $request->validated();
        $line = $count->scan($user, $stocktake, $data['barcode'], (string) ($data['quantity'] ?? '1'), $data['batch_id'] ?? null);

        return ApiResponse::success([
            'line' => $this->presenter->lines($stocktake, collect([$line]), $user)[0],
            'progress' => [
                'lines' => StocktakeLine::query()->where('stocktake_id', $stocktake->id)->count(),
                'counted' => StocktakeLine::query()->where('stocktake_id', $stocktake->id)->whereNotNull('counted_quantity')->count(),
            ],
        ]);
    }

    /**
     * Clear a count
     *
     * The line goes back to uncounted; an extra line (found outside the scope) is removed.
     */
    public function clear(Request $request, Stocktake $stocktake, string $lineId, CountStocktake $count): JsonResponse
    {
        $user = $this->user($request);
        $line = $count->clear($user, $stocktake, $lineId);

        return ApiResponse::success([
            'id' => $lineId,
            'removed' => $line === null,
            'line' => $line === null ? null : $this->presenter->lines($stocktake, collect([$line]), $user)[0],
        ]);
    }

    /**
     * Post a stocktake
     *
     * `{uncounted_policy: ignore|zero}`. One stock adjustment (reason `count`) of
     * `counted − system snapshot` per counted line with a difference; `zero` counts the uncounted
     * lines as zero (snapshot now). No difference → posted without an adjustment. Needs
     * `inventory.adjust`; only while counting (409 INVALID_STATUS_CHANGE).
     */
    public function post(PostStocktakeRequest $request, Stocktake $stocktake, PostStocktake $post): JsonResponse
    {
        $user = $this->user($request);
        $posted = $post($user, $stocktake, UncountedPolicy::from($request->validated('uncounted_policy')));

        return ApiResponse::success($this->presenter->detail($posted, $user));
    }

    /**
     * Cancel a stocktake
     *
     * Draft or counting only (409 INVALID_STATUS_CHANGE); stock is not touched.
     */
    public function cancel(Request $request, Stocktake $stocktake, CancelStocktake $cancel): JsonResponse
    {
        $user = $this->user($request);

        return ApiResponse::success($this->presenter->detail($cancel($user, $stocktake), $user));
    }

    private function reader(Request $request): TenantUser
    {
        $user = $this->user($request);
        if (! Gate::forUser($user)->any(['inventory.view', 'inventory.stocktake'])) {
            throw new AccessDeniedHttpException;
        }

        return $user;
    }

    private function user(Request $request): TenantUser
    {
        /** @var TenantUser $user */
        $user = $request->user();

        return $user;
    }
}
