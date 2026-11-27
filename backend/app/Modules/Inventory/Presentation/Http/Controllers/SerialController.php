<?php

namespace App\Modules\Inventory\Presentation\Http\Controllers;

use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Inventory\Domain\SerialStatus;
use App\Modules\Inventory\Infrastructure\Models\SerialNumber;
use App\Modules\Inventory\Infrastructure\Models\SerialNumberEvent;
use App\Modules\Inventory\Presentation\Http\Support\InventoryPresenter;
use App\Modules\Products\Application\Contracts\ProductDirectory;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Infrastructure\Http\Queries\ListQuery;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Users\Application\Contracts\UserDirectory;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Collection;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * ST2d: the serial-number register (read side). A serial is visible when its store is in one of
 * the user's branches, or when it has no store (it left the business).
 */
class SerialController
{
    public function __construct(
        private readonly InventoryPresenter $presenter,
        private readonly TenantContext $tenant,
        private readonly BranchDirectory $branches,
    ) {}

    /**
     * Serial numbers
     *
     * Filters: `search` (serial or product name / SKU / barcode), `variant_id`, `store_id`, `status`.
     */
    public function index(Request $request, ProductDirectory $products): JsonResponse
    {
        $request->validate([
            'search' => ['sometimes', 'nullable', 'string', 'max:100'],
            'variant_id' => ['sometimes', 'uuid'],
            'store_id' => ['sometimes', 'uuid'],
            'status' => ['sometimes', Rule::enum(SerialStatus::class)],
        ]);
        /** @var TenantUser $user */
        $user = $request->user();

        $query = $this->visible(SerialNumber::query(), $user)
            ->when($request->query('variant_id'), fn (Builder $q, string $id) => $q->where('variant_id', $id))
            ->when($request->query('store_id'), fn (Builder $q, string $id) => $q->where('store_id', $id))
            ->when($request->query('status'), fn (Builder $q, string $status) => $q->where('status', $status))
            ->orderByDesc('updated_at')->orderBy('id');

        $search = trim((string) $request->query('search', ''));
        if ($search !== '') {
            $variantIds = $products->searchVariantIds($this->tenant->requireOrganization(), $search);
            $query->where(fn (Builder $q) => $q->whereRaw('serial ILIKE ?', ['%'.addcslashes($search, '%_\\').'%'])->orWhereIn('variant_id', $variantIds));
        }

        $page = $query->paginate(ListQuery::perPage($request));
        $row = $this->rows(collect($page->items()));

        return ApiResponse::paginated($page, fn (SerialNumber $s) => new JsonResource($row($s)));
    }

    /**
     * Serial number history
     *
     * The serial and its events, newest first.
     */
    public function show(Request $request, string $serial, UserDirectory $users): JsonResponse
    {
        /** @var TenantUser $user */
        $user = $request->user();
        $found = $this->visible(SerialNumber::query(), $user)->whereKey($serial)->first() ?? throw new NotFoundHttpException;

        $events = SerialNumberEvent::query()->where('serial_number_id', $found->id)
            ->orderByDesc('created_at')->orderByDesc('id')->get();
        $stores = $this->presenter->lookups(storeIds: $events->pluck('store_id')->filter()->all())['stores'];
        $userIds = $events->pluck('created_by')->filter()->unique()->values()->all();
        $names = $userIds === [] ? [] : $users->names($this->tenant->requireOrganization(), $userIds);

        return ApiResponse::success($this->rows(collect([$found]))($found) + [
            'events' => $events->map(fn (SerialNumberEvent $e) => [
                'id' => $e->id,
                'type' => $e->type,
                'store' => $e->store_id === null ? null : ($stores[$e->store_id] ?? null),
                'reference_type' => $e->reference_type,
                'reference_id' => $e->reference_id,
                'reference_number' => $e->reference_number,
                'created_by' => $e->created_by === null ? null : ['id' => $e->created_by, 'name' => $names[$e->created_by] ?? null],
                'created_at' => $e->created_at->toIso8601String(),
            ])->values(),
        ]);
    }

    /**
     * Serials in stock at a store
     *
     * For pickers: `variant_id` is required. Rows `{id, serial}`, sorted by serial.
     */
    public function inStock(Request $request, string $store): JsonResponse
    {
        $data = $request->validate(['variant_id' => ['required', 'uuid']]);
        /** @var TenantUser $user */
        $user = $request->user();
        $found = $this->branches->store($store, $this->tenant->requireOrganization());
        if ($found === null || ! $user->canAccessBranch($found['branch_id'])) {
            throw new NotFoundHttpException;
        }

        return ApiResponse::success(SerialNumber::query()
            ->where('store_id', $found['id'])
            ->where('variant_id', $data['variant_id'])
            ->where('status', SerialStatus::InStock)
            ->orderByRaw('lower(serial)')
            ->get(['id', 'serial'])
            ->map(fn (SerialNumber $s) => ['id' => $s->id, 'serial' => $s->serial])
            ->values());
    }

    /**
     * @param  Builder<SerialNumber>  $query
     * @return Builder<SerialNumber>
     */
    private function visible(Builder $query, TenantUser $user): Builder
    {
        $accessible = $user->accessibleBranchIds();
        if ($accessible === null) {
            return $query;
        }
        $storeIds = array_column(array_filter(
            $this->branches->activeStores($this->tenant->requireOrganization()),
            fn (array $s) => in_array($s['branch_id'], $accessible, true),
        ), 'id');

        return $query->where(fn (Builder $q) => $q->whereNull('store_id')->orWhereIn('store_id', $storeIds));
    }

    /**
     * @param  Collection<int, SerialNumber>  $serials
     * @return callable(SerialNumber): array<string, mixed>
     */
    private function rows(Collection $serials): callable
    {
        $lookups = $this->presenter->lookups($serials->pluck('variant_id')->all(), $serials->pluck('store_id')->filter()->all());

        return fn (SerialNumber $s) => [
            'id' => $s->id,
            'serial' => $s->serial,
            'variant' => InventoryPresenter::variant($lookups['variants'][$s->variant_id] ?? null),
            'store' => $s->store_id === null ? null : ($lookups['stores'][$s->store_id] ?? null),
            'status' => $s->status->value,
            'updated_at' => $s->updated_at?->toIso8601String(),
        ];
    }
}
