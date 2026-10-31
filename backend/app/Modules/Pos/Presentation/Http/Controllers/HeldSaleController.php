<?php

namespace App\Modules\Pos\Presentation\Http\Controllers;

use App\Modules\Customers\Application\Contracts\CustomerDirectory;
use App\Modules\Inventory\Application\Services\StoreAccess;
use App\Modules\Pos\Infrastructure\Models\HeldSale;
use App\Modules\Pos\Presentation\Http\Requests\HoldCartRequest;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Users\Application\Contracts\UserDirectory;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Held (parked) carts of the user's branches.
 */
class HeldSaleController
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly CustomerDirectory $customers,
        private readonly UserDirectory $users,
    ) {}

    /**
     * Held carts, newest first. Optional `store_id`.
     */
    public function index(Request $request): JsonResponse
    {
        $request->validate(['store_id' => ['sometimes', 'uuid']]);
        $accessible = $this->user($request)->accessibleBranchIds();

        $held = HeldSale::query()
            ->when($accessible !== null, fn (Builder $q) => $q->whereIn('branch_id', $accessible))
            ->when($request->query('store_id'), fn (Builder $q, string $v) => $q->where('store_id', $v))
            ->latest()
            ->limit(100)
            ->get();

        return ApiResponse::success($this->present($held));
    }

    /**
     * Hold a cart
     */
    public function store(HoldCartRequest $request, StoreAccess $storeAccess): JsonResponse
    {
        $user = $this->user($request);
        $data = $request->validated();
        $store = $storeAccess->require($user, $data['store_id']);

        $held = HeldSale::query()->create([
            'organization_id' => $this->tenant->requireOrganization(),
            'branch_id' => $store['branch_id'],
            'store_id' => $store['id'],
            'label' => filled($data['label'] ?? null) ? trim($data['label']) : null,
            'customer_id' => $data['customer_id'] ?? null,
            'cart' => array_intersect_key($data, array_flip(['customer_id', 'lines', 'invoice_discount', 'notes'])),
            'lines_count' => count($data['lines']),
            'created_by' => $user->getAuthIdentifier(),
        ]);

        return ApiResponse::created($this->present(new Collection([$held]))[0]);
    }

    /**
     * Resume: the stored cart (re-price it with `POST /pos/price`).
     */
    public function show(Request $request, HeldSale $heldSale): JsonResponse
    {
        $this->assertVisible($request, $heldSale);

        return ApiResponse::success($this->present(new Collection([$heldSale]))[0] + ['cart' => $heldSale->cart]);
    }

    /**
     * Discard a held cart
     */
    public function destroy(Request $request, HeldSale $heldSale): JsonResponse
    {
        $this->assertVisible($request, $heldSale);
        $heldSale->delete();

        return ApiResponse::noContent();
    }

    private function assertVisible(Request $request, HeldSale $heldSale): void
    {
        if (! $this->user($request)->canAccessBranch($heldSale->branch_id)) {
            throw new NotFoundHttpException;
        }
    }

    /**
     * @param  Collection<int, HeldSale>  $held
     * @return list<array<string, mixed>>
     */
    private function present(Collection $held): array
    {
        $org = $this->tenant->requireOrganization();
        $customers = $this->customers->summaries($org, $held->pluck('customer_id')->filter()->unique()->values()->all());
        $users = $this->users->names($org, $held->pluck('created_by')->filter()->unique()->values()->all());

        return $held->map(fn (HeldSale $h) => [
            'id' => $h->id,
            'label' => $h->label,
            'store_id' => $h->store_id,
            'customer' => $h->customer_id === null ? null : ($customers[$h->customer_id] ?? null),
            'lines_count' => $h->lines_count,
            'created_by' => $h->created_by === null ? null : ($users[$h->created_by] ?? null),
            'created_at' => $h->created_at->toIso8601String(),
        ])->values()->all();
    }

    private function user(Request $request): TenantUser
    {
        /** @var TenantUser */
        return $request->user();
    }
}
