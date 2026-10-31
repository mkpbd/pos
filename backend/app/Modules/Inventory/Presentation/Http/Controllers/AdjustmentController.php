<?php

namespace App\Modules\Inventory\Presentation\Http\Controllers;

use App\Modules\Inventory\Application\Actions\PostStockAdjustment;
use App\Modules\Inventory\Domain\AdjustmentReason;
use App\Modules\Inventory\Infrastructure\Models\StockAdjustment;
use App\Modules\Inventory\Infrastructure\Models\StockAdjustmentLine;
use App\Modules\Inventory\Presentation\Http\Requests\PostAdjustmentRequest;
use App\Modules\Inventory\Presentation\Http\Support\InventoryPresenter;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Infrastructure\Http\Queries\ListQuery;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

class AdjustmentController
{
    public function __construct(private readonly InventoryPresenter $presenter) {}

    public function index(Request $request): JsonResponse
    {
        $request->validate(['branch_id' => ['sometimes', 'uuid'], 'reason' => ['sometimes', Rule::enum(AdjustmentReason::class)]]);
        /** @var TenantUser $user */
        $user = $request->user();

        $query = StockAdjustment::query()->withCount('lines')
            ->when($request->query('reason'), fn (Builder $q, string $reason) => $q->where('reason', $reason));
        $this->presenter->scopeBranches($query, $user, $request->query('branch_id'));

        $page = ListQuery::paginate($query, $request, sortable: ['created_at', 'number'], searchable: ['number']);
        $stores = $this->presenter->lookups(storeIds: collect($page->items())->pluck('store_id')->all())['stores'];

        return ApiResponse::paginated($page, fn (StockAdjustment $a) => new JsonResource([
            'id' => $a->id,
            'number' => $a->number,
            'reason' => $a->reason,
            'store' => $stores[$a->store_id] ?? null,
            'lines_count' => $a->lines_count,
            'note' => $a->note,
            'created_by' => $a->created_by,
            'created_at' => $a->created_at?->toIso8601String(),
        ]));
    }

    public function show(Request $request, StockAdjustment $adjustment): JsonResponse
    {
        /** @var TenantUser $user */
        $user = $request->user();
        if (! $user->canAccessBranch($adjustment->branch_id)) {
            throw new NotFoundHttpException;
        }

        return ApiResponse::success($this->present($adjustment, $user->can('products.view_cost')));
    }

    public function store(PostAdjustmentRequest $request, PostStockAdjustment $post): JsonResponse
    {
        /** @var TenantUser $user */
        $user = $request->user();

        return ApiResponse::created($this->present($post($user, $request->validated()), $request->user()->can('products.view_cost')));
    }

    /**
     * @return array<string, mixed>
     */
    private function present(StockAdjustment $adjustment, bool $withCost): array
    {
        $lines = $adjustment->lines()->get();
        $lookups = $this->presenter->lookups($lines->pluck('variant_id')->all(), [$adjustment->store_id], $lines->pluck('batch_id')->all());

        return [
            'id' => $adjustment->id,
            'number' => $adjustment->number,
            'reason' => $adjustment->reason,
            'note' => $adjustment->note,
            'store' => $lookups['stores'][$adjustment->store_id] ?? null,
            'created_by' => $adjustment->created_by,
            'created_at' => $adjustment->created_at?->toIso8601String(),
            'lines' => $lines->map(fn (StockAdjustmentLine $l) => [
                'id' => $l->id,
                'variant' => InventoryPresenter::variant($lookups['variants'][$l->variant_id] ?? null),
                'batch' => $l->batch_id ? ($lookups['batches'][$l->batch_id] ?? null) : null,
                'quantity' => $l->quantity,
                'unit_cost' => $withCost ? $l->unit_cost : null,
            ])->values(),
        ];
    }
}
