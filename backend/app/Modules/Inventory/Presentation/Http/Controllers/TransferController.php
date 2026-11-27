<?php

namespace App\Modules\Inventory\Presentation\Http\Controllers;

use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Inventory\Application\Actions\TransferStock;
use App\Modules\Inventory\Domain\TransferStatus;
use App\Modules\Inventory\Infrastructure\Documents\TransferChallanDocument;
use App\Modules\Inventory\Infrastructure\Models\StockTransfer;
use App\Modules\Inventory\Infrastructure\Models\StockTransferLine;
use App\Modules\Inventory\Presentation\Http\Exports\TransfersExport;
use App\Modules\Inventory\Presentation\Http\Requests\DispatchTransferRequest;
use App\Modules\Inventory\Presentation\Http\Support\InventoryPresenter;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Shared\Infrastructure\Http\Exports\ListExporter;
use App\Modules\Shared\Infrastructure\Http\Exports\RowSource;
use App\Modules\Shared\Infrastructure\Http\Queries\ListQuery;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Users\Application\Contracts\UserDirectory;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Collection;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

class TransferController
{
    private const QUANTITY = '/^\d{1,15}(\.\d{1,3})?$/';

    public function __construct(
        private readonly InventoryPresenter $presenter,
        private readonly UserDirectory $users,
        private readonly TenantContext $tenant,
        private readonly BranchDirectory $branches,
    ) {}

    /**
     * List transfers
     *
     * Transfers from or to the user's branches. Filters: `status`, `direction` (`incoming`/`outgoing`).
     */
    public function index(Request $request, ListExporter $exports): Response
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
            ->withExists(['lines as has_discrepancy' => fn (Builder $q) => $q->whereColumn('received_quantity', '<', 'quantity')])
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

        ListQuery::apply($query, $request, sortable: ['created_at', 'number'], searchable: ['number']);
        if ($format = ListExporter::requested($request)) {
            return $exports->download($request, $format, TransfersExport::class, RowSource::fromQuery($query, function (Collection $items) use ($user) {
                $stores = $this->presenter->lookups(storeIds: $items->flatMap(fn (StockTransfer $t) => [$t->from_store_id, $t->to_store_id])->all())['stores'];

                $names = $this->userNames($items);

                return $items->map(fn (StockTransfer $t) => $this->summary($t, $stores, $user, $names));
            }));
        }
        $page = $query->paginate(ListQuery::perPage($request));
        $items = collect($page->items());
        $stores = $this->presenter->lookups(storeIds: $items->flatMap(fn (StockTransfer $t) => [$t->from_store_id, $t->to_store_id])->all())['stores'];

        $names = $this->userNames($items);

        return ApiResponse::paginated($page, fn (StockTransfer $t) => new JsonResource($this->summary($t, $stores, $user, $names)));
    }

    public function show(Request $request, StockTransfer $transfer): JsonResponse
    {
        /** @var TenantUser $user */
        $user = $request->user();
        $this->assertVisible($user, $transfer);

        return ApiResponse::success($this->present($transfer, $user));
    }

    /**
     * The transfer's delivery challan as PDF (ST2b)
     */
    public function challan(Request $request, StockTransfer $transfer, TransferChallanDocument $document): Response
    {
        /** @var TenantUser $user */
        $user = $request->user();
        $this->assertVisible($user, $transfer);

        return response($document->render($transfer), 200, [
            'Content-Type' => 'application/pdf',
            'Content-Disposition' => 'inline; filename="'.TransferChallanDocument::filename($transfer).'"',
            'Cache-Control' => 'no-store, private',
        ]);
    }

    public function store(DispatchTransferRequest $request, TransferStock $transfers): JsonResponse
    {
        /** @var TenantUser $user */
        $user = $request->user();

        return ApiResponse::created($this->present($transfers->dispatch($user, $request->validated()), $user));
    }

    /**
     * Receive a transfer
     *
     * Without a body every line is received in full. ST2b: `lines` records what arrived per line
     * (`received_quantity`, `damaged_quantity`, `note`); lines not listed are received in full.
     */
    public function receive(Request $request, StockTransfer $transfer, TransferStock $transfers): JsonResponse
    {
        $data = $request->validate([
            'lines' => ['sometimes', 'array', 'max:500'],
            'lines.*.line_id' => ['required', 'uuid', 'distinct'],
            'lines.*.received_quantity' => ['required', 'regex:'.self::QUANTITY],
            'lines.*.damaged_quantity' => ['nullable', 'regex:'.self::QUANTITY],
            'lines.*.note' => ['nullable', 'string', 'max:200'],
        ], ['regex' => 'Enter a quantity of zero or more with up to 3 decimals.']);
        /** @var TenantUser $user */
        $user = $request->user();
        $this->assertVisible($user, $transfer);

        return ApiResponse::success($this->present($transfers->receive($user, $transfer, $data['lines'] ?? []), $user));
    }

    /**
     * Request stock (ST2b)
     *
     * The destination branch asks another store for stock; nothing moves until the source dispatches it.
     */
    public function request(DispatchTransferRequest $request, TransferStock $transfers): JsonResponse
    {
        /** @var TenantUser $user */
        $user = $request->user();

        return ApiResponse::created($this->present($transfers->request($user, $request->validated()), $user));
    }

    /**
     * Dispatch a requested transfer (ST2b)
     *
     * Optional `lines` (`line_id`, `quantity` up to the requested quantity, 0 drops the line,
     * `batch_id`); lines not listed go in full, batches first-expiry-first-out when none is chosen.
     */
    public function dispatch(Request $request, StockTransfer $transfer, TransferStock $transfers): JsonResponse
    {
        $data = $request->validate([
            'lines' => ['sometimes', 'array', 'max:500'],
            'lines.*.line_id' => ['required', 'uuid', 'distinct'],
            'lines.*.quantity' => ['required', 'regex:'.self::QUANTITY],
            'lines.*.batch_id' => ['nullable', 'uuid'],
            // ST2d: serials of serial-numbered lines (such lines must be listed).
            'lines.*.serials' => ['nullable', 'array', 'max:10000'],
            'lines.*.serials.*' => ['string', 'max:100'],
        ], ['regex' => 'Enter a quantity of zero or more with up to 3 decimals.']);
        /** @var TenantUser $user */
        $user = $request->user();
        $this->assertVisible($user, $transfer);

        return ApiResponse::success($this->present($transfers->dispatchRequest($user, $transfer, $data['lines'] ?? []), $user));
    }

    /**
     * Reject a requested transfer (ST2b)
     */
    public function reject(Request $request, StockTransfer $transfer, TransferStock $transfers): JsonResponse
    {
        $data = $request->validate(['reason' => ['required', 'string', 'max:200']]);
        /** @var TenantUser $user */
        $user = $request->user();
        $this->assertVisible($user, $transfer);

        return ApiResponse::success($this->present($transfers->reject($user, $transfer, $data['reason']), $user));
    }

    public function cancel(Request $request, StockTransfer $transfer, TransferStock $transfers): JsonResponse
    {
        /** @var TenantUser $user */
        $user = $request->user();
        $this->assertVisible($user, $transfer);

        return ApiResponse::success($this->present($transfers->cancel($user, $transfer), $user));
    }

    /**
     * Stores a transfer can be requested from (ST2b)
     *
     * Every active store of the organization, names only: a branch requests stock from stores it cannot otherwise see.
     */
    public function sourceStores(): JsonResponse
    {
        return ApiResponse::success(array_map(fn (array $s) => [
            'id' => $s['id'],
            'code' => $s['code'],
            'name' => $s['name'],
            'branch' => ['id' => $s['branch_id'], 'name' => $s['branch_name']],
        ], $this->branches->activeStores($this->tenant->requireOrganization())));
    }

    /**
     * @param  Collection<int, StockTransfer>  $transfers
     * @return array<string, string>
     */
    private function userNames(Collection $transfers): array
    {
        $ids = $transfers->flatMap(fn (StockTransfer $t) => [$t->dispatched_by, $t->completed_by, $t->requested_by, $t->rejected_by])->filter()->unique()->values()->all();

        return $ids === [] ? [] : $this->users->names($this->tenant->requireOrganization(), $ids);
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
    private function summary(StockTransfer $t, array $stores, TenantUser $user, array $names): array
    {
        // ST2b: the source branch answers a request.
        $canAnswer = $t->status === TransferStatus::Requested && $user->canAccessBranch($t->from_branch_id) && $user->can('inventory.transfer');

        return [
            'id' => $t->id,
            'number' => $t->number,
            'status' => $t->status->value,
            'from_store' => $stores[$t->from_store_id] ?? null,
            'to_store' => $stores[$t->to_store_id] ?? null,
            'note' => $t->note,
            'lines_count' => $t->lines_count ?? null,
            'can_receive' => $t->status === TransferStatus::InTransit && $user->canAccessBranch($t->to_branch_id),
            // ST2b: a request is withdrawn by the requesting (destination) branch.
            'can_cancel' => ($t->status === TransferStatus::InTransit && $user->canAccessBranch($t->from_branch_id))
                || ($t->status === TransferStatus::Requested && $user->canAccessBranch($t->to_branch_id)),
            'can_dispatch' => $canAnswer,
            'can_reject' => $canAnswer,
            'dispatched_by' => $t->dispatched_by === null ? null : ['id' => $t->dispatched_by, 'name' => $names[$t->dispatched_by] ?? null],
            'dispatched_at' => $t->dispatched_at?->toIso8601String(),
            'completed_by' => $t->completed_by === null ? null : ['id' => $t->completed_by, 'name' => $names[$t->completed_by] ?? null],
            'completed_at' => $t->completed_at?->toIso8601String(),
            // ST2b: requests, rejection and receiving discrepancies.
            'requested_by' => $t->requested_by === null ? null : ['id' => $t->requested_by, 'name' => $names[$t->requested_by] ?? null],
            'requested_at' => $t->requested_at?->toIso8601String(),
            'rejected_by' => $t->rejected_by === null ? null : ['id' => $t->rejected_by, 'name' => $names[$t->rejected_by] ?? null],
            'rejected_at' => $t->rejected_at?->toIso8601String(),
            'rejection_reason' => $t->rejection_reason,
            // Valued at cost, so hidden like unit_cost.
            'loss_total' => $user->can('products.view_cost') ? $t->loss_total : null,
            'has_discrepancy' => (bool) ($t->has_discrepancy ?? false),
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
        $serials = app(TransferStock::class)->dispatchedSerials($transfer);

        $transfer->setAttribute('has_discrepancy', $lines->contains(fn (StockTransferLine $l) => $l->received_quantity !== null && Decimal::compare($l->received_quantity, $l->quantity) < 0));

        return $this->summary($transfer, $lookups['stores'], $user, $this->userNames(collect([$transfer]))) + [
            'lines' => $lines->map(fn (StockTransferLine $l) => [
                'id' => $l->id,
                'variant' => InventoryPresenter::variant($lookups['variants'][$l->variant_id] ?? null),
                'batch' => $l->batch_id ? ($lookups['batches'][$l->batch_id] ?? null) : null,
                'quantity' => $l->quantity,
                'unit_cost' => $withCost ? $l->unit_cost : null,
                // ST2b: requested / received short or damaged.
                'requested_quantity' => $l->requested_quantity,
                'received_quantity' => $l->received_quantity,
                'damaged_quantity' => $l->damaged_quantity,
                'short_quantity' => $l->received_quantity === null ? null : Decimal::sub(Decimal::sub($l->quantity, $l->received_quantity, 3), $l->damaged_quantity, 3),
                'receive_note' => $l->receive_note,
                // ST2d: the serials dispatched for this product (serial-numbered lines).
                'serials' => $serials[$l->variant_id] ?? [],
            ])->values(),
        ];
    }
}
