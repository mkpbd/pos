<?php

namespace App\Modules\Inventory\Presentation\Http\Controllers;

use App\Modules\Inventory\Application\Actions\TransferStock;
use App\Modules\Inventory\Domain\TransferStatus;
use App\Modules\Inventory\Infrastructure\Models\StockTransfer;
use App\Modules\Inventory\Infrastructure\Models\StockTransferLine;
use App\Modules\Inventory\Presentation\Http\Requests\DispatchTransferRequest;
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

class TransferController
{
    public function __construct(private readonly InventoryPresenter $presenter) {}

    /**
     * List transfers
     *
     * Transfers from or to the user's branches. Filters: `status`, `direction` (`incoming`/`outgoing`).
     */
    public function index(Request $request): JsonResponse
    {
        $request->validate([
            'status' => ['sometimes', Rule::enum(TransferStatus::class)],
            'direction' => ['sometimes', Rule::in(['incoming', 'outgoing'])],
        ]);
        /** @var TenantUser $user */
        $user = $request->user();
        $accessible = $user->accessibleBranchIds();
        $direction = $request->query('direction');

        $query = StockTransfer::query()->withCount('lines')
            ->when($request->query('status'), fn (Builder $q, string $status) => $q->where('status', $status))
            ->when($accessible !== null, function (Builder $q) use ($accessible, $direction) {
                $q->where(function (Builder $w) use ($accessible, $direction) {
                    if ($direction !== 'incoming') {
                        $w->orWhereIn('from_branch_id', $accessible);
                    }
                    if ($direction !== 'outgoing') {
                        $w->orWhereIn('to_branch_id', $accessible);
                    }
                });
            });

        $page = ListQuery::paginate($query, $request, sortable: ['created_at', 'number'], searchable: ['number']);
        $items = collect($page->items());
        $stores = $this->presenter->lookups(storeIds: $items->flatMap(fn (StockTransfer $t) => [$t->from_store_id, $t->to_store_id])->all())['stores'];

        return ApiResponse::paginated($page, fn (StockTransfer $t) => new JsonResource($this->summary($t, $stores, $user)));
    }

    public function show(Request $request, StockTransfer $transfer): JsonResponse
    {
        /** @var TenantUser $user */
        $user = $request->user();
        $this->assertVisible($user, $transfer);

        return ApiResponse::success($this->present($transfer, $user));
    }

    public function store(DispatchTransferRequest $request, TransferStock $transfers): JsonResponse
    {
        /** @var TenantUser $user */
        $user = $request->user();

        return ApiResponse::created($this->present($transfers->dispatch($user, $request->validated()), $user));
    }

    public function receive(Request $request, StockTransfer $transfer, TransferStock $transfers): JsonResponse
    {
        /** @var TenantUser $user */
        $user = $request->user();
        $this->assertVisible($user, $transfer);

        return ApiResponse::success($this->present($transfers->receive($user, $transfer), $user));
    }

    public function cancel(Request $request, StockTransfer $transfer, TransferStock $transfers): JsonResponse
    {
        /** @var TenantUser $user */
        $user = $request->user();
        $this->assertVisible($user, $transfer);

        return ApiResponse::success($this->present($transfers->cancel($user, $transfer), $user));
    }

    private function assertVisible(TenantUser $user, StockTransfer $transfer): void
    {
        if (! $user->canAccessBranch($transfer->from_branch_id) && ! $user->canAccessBranch($transfer->to_branch_id)) {
            throw new NotFoundHttpException;
        }
    }

    /**
     * @param  array<string, array<string, mixed>>  $stores
     * @return array<string, mixed>
     */
    private function summary(StockTransfer $t, array $stores, TenantUser $user): array
    {
        return [
            'id' => $t->id,
            'number' => $t->number,
            'status' => $t->status->value,
            'from_store' => $stores[$t->from_store_id] ?? null,
            'to_store' => $stores[$t->to_store_id] ?? null,
            'note' => $t->note,
            'lines_count' => $t->lines_count ?? null,
            'can_receive' => $t->status === TransferStatus::InTransit && $user->canAccessBranch($t->to_branch_id),
            'can_cancel' => $t->status === TransferStatus::InTransit && $user->canAccessBranch($t->from_branch_id),
            'dispatched_by' => $t->dispatched_by,
            'dispatched_at' => $t->dispatched_at->toIso8601String(),
            'completed_by' => $t->completed_by,
            'completed_at' => $t->completed_at?->toIso8601String(),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function present(StockTransfer $transfer, TenantUser $user): array
    {
        $lines = $transfer->lines()->get();
        $lookups = $this->presenter->lookups($lines->pluck('variant_id')->all(), [$transfer->from_store_id, $transfer->to_store_id], $lines->pluck('batch_id')->all());
        $withCost = $user->can('products.view_cost');

        return $this->summary($transfer, $lookups['stores'], $user) + [
            'lines' => $lines->map(fn (StockTransferLine $l) => [
                'id' => $l->id,
                'variant' => InventoryPresenter::variant($lookups['variants'][$l->variant_id] ?? null),
                'batch' => $l->batch_id ? ($lookups['batches'][$l->batch_id] ?? null) : null,
                'quantity' => $l->quantity,
                'unit_cost' => $withCost ? $l->unit_cost : null,
            ])->values(),
        ];
    }
}
