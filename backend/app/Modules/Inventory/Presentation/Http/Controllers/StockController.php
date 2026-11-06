<?php

namespace App\Modules\Inventory\Presentation\Http\Controllers;

use App\Modules\Inventory\Domain\MovementType;
use App\Modules\Inventory\Infrastructure\Models\StockMovement;
use App\Modules\Inventory\Presentation\Http\Exports\BatchesExport;
use App\Modules\Inventory\Presentation\Http\Exports\StockLevelsExport;
use App\Modules\Inventory\Presentation\Http\Exports\StockMovementsExport;
use App\Modules\Inventory\Presentation\Http\Exports\ValuationExport;
use App\Modules\Inventory\Presentation\Http\Support\InventoryPresenter;
use App\Modules\Products\Application\Contracts\ProductDirectory;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Shared\Infrastructure\Http\Exports\ListExporter;
use App\Modules\Shared\Infrastructure\Http\Exports\RowSource;
use App\Modules\Shared\Infrastructure\Http\Queries\ListQuery;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Query\Builder as QueryBuilder;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\Response;

/**
 * Read side of inventory. The stock list joins product_variants read-only for the
 * reorder level (a reporting read model; the Products module still owns all writes).
 */
class StockController
{
    public function __construct(
        private readonly InventoryPresenter $presenter,
        private readonly TenantContext $tenant,
        private readonly ProductDirectory $products,
    ) {}

    /**
     * Stock on hand
     *
     * One row per store and variant (batches summed). Filters: `branch_id`, `store_id`,
     * `variant_id`, `search` (name/SKU/barcode), `low_stock=1` (at or below reorder level).
     */
    public function index(Request $request, ListExporter $exports): Response
    {
        $request->validate([
            'branch_id' => ['sometimes', 'uuid'],
            'store_id' => ['sometimes', 'uuid'],
            'variant_id' => ['sometimes', 'uuid'],
            'low_stock' => ['sometimes', 'boolean'],
            'search' => ['sometimes', 'string', 'max:100'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:100'],
        ]);
        /** @var TenantUser $user */
        $user = $request->user();
        $organizationId = $this->tenant->requireOrganization();

        $query = DB::table('stock_levels as sl')
            ->join('product_variants as pv', 'pv.id', '=', 'sl.variant_id')
            ->where('sl.organization_id', $organizationId)
            ->groupBy('sl.store_id', 'sl.branch_id', 'sl.variant_id', 'pv.reorder_level')
            ->select([
                'sl.store_id', 'sl.branch_id', 'sl.variant_id', 'pv.reorder_level',
                DB::raw('SUM(sl.quantity) as quantity'),
                DB::raw('SUM(sl.quantity * sl.average_cost) as value'),
                DB::raw('MAX(sl.updated_at) as updated_at'),
            ])
            ->orderBy('sl.variant_id')
            ->orderBy('sl.store_id');

        $this->presenter->scopeBranches($query, $user, $request->query('branch_id'), 'sl.branch_id');
        $query->when($request->query('store_id'), fn (QueryBuilder $q, string $id) => $q->where('sl.store_id', $id))
            ->when($request->query('variant_id'), fn (QueryBuilder $q, string $id) => $q->where('sl.variant_id', $id))
            ->when($request->boolean('low_stock'), fn (QueryBuilder $q) => $q->where('pv.reorder_level', '>', 0)->havingRaw('SUM(sl.quantity) <= pv.reorder_level'));

        $search = trim((string) $request->query('search', ''));
        if ($search !== '') {
            $query->whereIn('sl.variant_id', $this->products->searchVariantIds($organizationId, $search));
        }

        $withCost = (bool) $request->user()->can('products.view_cost');
        if ($format = ListExporter::requested($request)) {
            return $exports->download($request, $format, StockLevelsExport::class, RowSource::fromQuery($query, fn (Collection $rows) => $this->stockRows($rows, $withCost)));
        }
        $page = $query->paginate(max(1, min(100, (int) $request->query('per_page', 25))));

        return ApiResponse::success($this->stockRows(collect($page->items()), $withCost), meta: ['pagination' => [
            'current_page' => $page->currentPage(),
            'per_page' => $page->perPage(),
            'total' => $page->total(),
            'last_page' => $page->lastPage(),
        ]]);
    }

    /**
     * Stock by batch
     *
     * Batches with stock on hand, soonest expiry first. `expiring_within_days` limits to
     * batches expiring in that many days (expired ones included).
     */
    public function batches(Request $request, ListExporter $exports): Response
    {
        $request->validate([
            'branch_id' => ['sometimes', 'uuid'],
            'store_id' => ['sometimes', 'uuid'],
            'variant_id' => ['sometimes', 'uuid'],
            'expiring_within_days' => ['sometimes', 'integer', 'min:0', 'max:3650'],
        ]);
        /** @var TenantUser $user */
        $user = $request->user();

        $query = DB::table('stock_levels as sl')
            ->join('batches as b', 'b.id', '=', 'sl.batch_id')
            ->where('sl.organization_id', $this->tenant->requireOrganization())
            ->where('sl.quantity', '>', 0)
            ->select(['sl.store_id', 'sl.variant_id', 'sl.batch_id', 'sl.quantity', 'b.batch_number', 'b.expires_on'])
            ->orderByRaw('b.expires_on is null')
            ->orderBy('b.expires_on');

        $this->presenter->scopeBranches($query, $user, $request->query('branch_id'), 'sl.branch_id');
        $query->when($request->query('store_id'), fn (QueryBuilder $q, string $id) => $q->where('sl.store_id', $id))
            ->when($request->query('variant_id'), fn (QueryBuilder $q, string $id) => $q->where('sl.variant_id', $id))
            ->when($request->has('expiring_within_days'), fn (QueryBuilder $q) => $q->whereNotNull('b.expires_on')
                ->where('b.expires_on', '<=', now()->addDays((int) $request->query('expiring_within_days'))->toDateString()));

        if ($format = ListExporter::requested($request)) {
            // Exports are not capped at the screen's 500 rows; the export limits apply instead.
            return $exports->download($request, $format, BatchesExport::class, RowSource::fromQuery($query->orderBy('sl.id'), fn (Collection $rows) => $this->batchRows($rows)));
        }

        return ApiResponse::success($this->batchRows($query->limit(500)->get()));
    }

    /**
     * Stock movements (ledger)
     *
     * Filters: `branch_id`, `store_id`, `variant_id`, `type`, `from`, `to`.
     */
    public function movements(Request $request, ListExporter $exports): Response
    {
        $request->validate([
            'branch_id' => ['sometimes', 'uuid'],
            'store_id' => ['sometimes', 'uuid'],
            'variant_id' => ['sometimes', 'uuid'],
            'type' => ['sometimes', Rule::enum(MovementType::class)],
            'from' => ['sometimes', 'date'],
            'to' => ['sometimes', 'date', 'after_or_equal:from'],
        ]);
        /** @var TenantUser $user */
        $user = $request->user();

        $query = StockMovement::query()
            ->when($request->query('store_id'), fn (Builder $q, string $id) => $q->where('store_id', $id))
            ->when($request->query('variant_id'), fn (Builder $q, string $id) => $q->where('variant_id', $id))
            ->when($request->query('type'), fn (Builder $q, string $type) => $q->where('type', $type))
            ->when($request->query('from'), fn (Builder $q, string $v) => $q->where('created_at', '>=', $v))
            ->when($request->query('to'), fn (Builder $q, string $v) => $q->where('created_at', '<', now()->parse($v)->addDay()->startOfDay()));
        $this->presenter->scopeBranches($query, $user, $request->query('branch_id'));

        ListQuery::apply($query, $request, sortable: ['created_at']);
        $withCost = $user->can('products.view_cost');
        if ($format = ListExporter::requested($request)) {
            return $exports->download($request, $format, StockMovementsExport::class, RowSource::fromQuery($query, fn (Collection $items) => $this->movementRows($items, $withCost)));
        }
        $page = $query->paginate(ListQuery::perPage($request));

        return ApiResponse::success($this->movementRows(collect($page->items()), $withCost), meta: ['pagination' => [
            'current_page' => $page->currentPage(),
            'per_page' => $page->perPage(),
            'total' => $page->total(),
            'last_page' => $page->lastPage(),
        ]]);
    }

    /**
     * Inventory valuation
     *
     * Quantity and value (weighted average cost) of positive stock per store.
     */
    public function valuation(Request $request, ListExporter $exports): Response
    {
        $request->validate(['branch_id' => ['sometimes', 'uuid']]);
        /** @var TenantUser $user */
        $user = $request->user();

        $query = DB::table('stock_levels')
            ->where('organization_id', $this->tenant->requireOrganization())
            ->where('quantity', '>', 0)
            ->groupBy('store_id')
            ->select(['store_id', DB::raw('COUNT(DISTINCT variant_id) as products'), DB::raw('SUM(quantity * average_cost) as value')]);
        $this->presenter->scopeBranches($query, $user, $request->query('branch_id'));

        $rows = $query->get();
        $stores = $this->presenter->lookups(storeIds: $rows->pluck('store_id')->all())['stores'];
        $total = $rows->reduce(fn (string $sum, $row) => Decimal::add($sum, (string) $row->value, 2), '0.00');
        $valuation = $rows->map(fn ($row) => [
            'store' => $stores[$row->store_id] ?? null,
            'products' => (int) $row->products,
            'value' => Decimal::round((string) $row->value, 2),
        ])->values();
        if ($format = ListExporter::requested($request)) {
            return $exports->download($request, $format, ValuationExport::class, RowSource::fromRows([
                ...$valuation->all(),
                ['store' => ['name' => 'Total'], 'products' => null, 'value' => $total],
            ]));
        }

        return ApiResponse::success([
            'stores' => $valuation,
            'total' => $total,
        ]);
    }

    /**
     * @param  Collection<int, object>  $rows  grouped stock_levels rows
     * @return Collection<int, array<string, mixed>>
     */
    private function stockRows(Collection $rows, bool $withCost): Collection
    {
        $lookups = $this->presenter->lookups($rows->pluck('variant_id')->all(), $rows->pluck('store_id')->all());

        return $rows->map(fn ($row) => [
            'store' => $lookups['stores'][$row->store_id] ?? null,
            'variant' => InventoryPresenter::variant($lookups['variants'][$row->variant_id] ?? null),
            'quantity' => Decimal::round((string) $row->quantity, 3),
            'reorder_level' => Decimal::round((string) $row->reorder_level, 3),
            'is_low' => Decimal::compare((string) $row->reorder_level, '0') > 0 && Decimal::compare((string) $row->quantity, (string) $row->reorder_level) <= 0,
            'value' => $withCost ? Decimal::round((string) $row->value, 2) : null,
            'updated_at' => $row->updated_at,
        ])->values();
    }

    /**
     * @param  Collection<int, object>  $rows  stock_levels rows joined with batches
     * @return Collection<int, array<string, mixed>>
     */
    private function batchRows(Collection $rows): Collection
    {
        $lookups = $this->presenter->lookups($rows->pluck('variant_id')->all(), $rows->pluck('store_id')->all());
        $today = now()->toDateString();

        return $rows->map(fn ($row) => [
            'store' => $lookups['stores'][$row->store_id] ?? null,
            'variant' => InventoryPresenter::variant($lookups['variants'][$row->variant_id] ?? null),
            'batch' => ['id' => $row->batch_id, 'batch_number' => $row->batch_number, 'expires_on' => $row->expires_on ? substr((string) $row->expires_on, 0, 10) : null],
            'quantity' => Decimal::round((string) $row->quantity, 3),
            'is_expired' => $row->expires_on !== null && substr((string) $row->expires_on, 0, 10) < $today,
        ])->values();
    }

    /**
     * @param  Collection<int, StockMovement>  $items
     * @return Collection<int, array<string, mixed>>
     */
    private function movementRows(Collection $items, bool $withCost): Collection
    {
        $lookups = $this->presenter->lookups($items->pluck('variant_id')->all(), $items->pluck('store_id')->all(), $items->pluck('batch_id')->all());

        return $items->map(fn (StockMovement $m) => [
            'id' => $m->id,
            'type' => $m->type->value,
            'store' => $lookups['stores'][$m->store_id] ?? null,
            'variant' => InventoryPresenter::variant($lookups['variants'][$m->variant_id] ?? null),
            'batch' => $m->batch_id ? ($lookups['batches'][$m->batch_id] ?? null) : null,
            'quantity' => $m->quantity,
            'unit_cost' => $withCost ? $m->unit_cost : null,
            // SC3: value added by a value-only movement (landed_cost); null otherwise.
            'value' => $withCost ? $m->value : null,
            'balance_after' => $m->balance_after,
            'reference' => ['type' => $m->reference_type, 'id' => $m->reference_id, 'number' => $m->reference_number],
            'created_by' => $m->created_by,
            'created_at' => $m->created_at->toIso8601String(),
        ])->values();
    }
}
