<?php

namespace App\Modules\Purchasing\Presentation\Http\Controllers;

use App\Modules\Purchasing\Application\Actions\PostLandedCostVoucher;
use App\Modules\Purchasing\Application\Actions\SaveLandedCostVoucher;
use App\Modules\Purchasing\Application\Services\PurchasingContext;
use App\Modules\Purchasing\Domain\LandedCost\LandedCostVoucherStatus;
use App\Modules\Purchasing\Infrastructure\Models\LandedCostVoucher;
use App\Modules\Purchasing\Presentation\Http\Exports\LandedCostVouchersExport;
use App\Modules\Purchasing\Presentation\Http\Requests\SaveLandedCostVoucherRequest;
use App\Modules\Purchasing\Presentation\Http\Support\LandedCostPresenter;
use App\Modules\Purchasing\Presentation\Http\Support\PurchasingPresenter;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Infrastructure\Http\Exports\ListExporter;
use App\Modules\Shared\Infrastructure\Http\Exports\RowSource;
use App\Modules\Shared\Infrastructure\Http\Queries\ListQuery;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Collection;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\Response;

/**
 * Landed cost vouchers (SC3): freight, duty and similar bills that arrive after the goods,
 * applied to posted goods receipts of one branch.
 */
class LandedCostVoucherController
{
    public function __construct(
        private readonly LandedCostPresenter $presenter,
        private readonly PurchasingPresenter $purchasing,
    ) {}

    /**
     * List landed cost vouchers
     *
     * Filters: `status` (draft|posted), `branch_id`, `charge_supplier_id`, `goods_receipt_id`,
     * `from`/`to` (voucher date); `search` matches number and reference. Sort: `created_at`
     * (default, newest first), `voucher_date`, `number`, `total`.
     */
    public function index(Request $request, ListExporter $exports): Response
    {
        $request->validate([
            'status' => ['sometimes', Rule::enum(LandedCostVoucherStatus::class)],
            'branch_id' => ['sometimes', 'uuid'],
            'charge_supplier_id' => ['sometimes', 'uuid'],
            'goods_receipt_id' => ['sometimes', 'uuid'],
            'from' => ['sometimes', 'date_format:Y-m-d'],
            'to' => ['sometimes', 'date_format:Y-m-d', 'after_or_equal:from'],
        ]);
        $query = LandedCostVoucher::query()
            ->when($request->query('status'), fn (Builder $q, string $v) => $q->where('status', $v))
            ->when($request->query('branch_id'), fn (Builder $q, string $v) => $q->where('branch_id', $v))
            ->when($request->query('charge_supplier_id'), fn (Builder $q, string $v) => $q->where('charge_supplier_id', $v))
            ->when($request->query('goods_receipt_id'), fn (Builder $q, string $v) => $q->whereHas('receipts', fn (Builder $r) => $r->where('goods_receipt_id', $v)))
            ->when($request->query('from'), fn (Builder $q, string $v) => $q->where('voucher_date', '>=', $v))
            ->when($request->query('to'), fn (Builder $q, string $v) => $q->where('voucher_date', '<=', $v));
        $this->purchasing->scopeBranches($query, $this->user($request));

        ListQuery::apply($query, $request, sortable: ['created_at', 'voucher_date', 'number', 'total'], searchable: ['number', 'reference']);
        if ($format = ListExporter::requested($request)) {
            return $exports->download($request, $format, LandedCostVouchersExport::class, RowSource::fromQuery($query, fn (Collection $rows) => $rows->map($this->presenter->headers($rows))));
        }
        $page = $query->paginate(ListQuery::perPage($request));
        $header = $this->presenter->headers(collect($page->items()));

        return ApiResponse::paginated($page, fn (LandedCostVoucher $v) => new JsonResource($header($v)));
    }

    /**
     * Show a landed cost voucher
     *
     * Includes the allocation table: the stored rows once posted (`allocation_source: posted`),
     * a live preview against the stock on hand now while it is a draft (`preview`).
     */
    public function show(Request $request, LandedCostVoucher $landedCostVoucher): JsonResponse
    {
        $this->purchasing->assertVisible($this->user($request), $landedCostVoucher->branch_id);

        return ApiResponse::success($this->presenter->document($landedCostVoucher));
    }

    /**
     * Preview a landed cost voucher
     *
     * The draft body (as for create) → the allocation per receipt line, split between stock on
     * hand and stock already consumed, with the new average costs. Nothing is saved.
     */
    public function preview(SaveLandedCostVoucherRequest $request, SaveLandedCostVoucher $save, PurchasingContext $context): JsonResponse
    {
        $draft = $save->validated($this->user($request), $request->validated());
        $currency = $context->currency();

        return ApiResponse::success($this->presenter->preview($draft + SaveLandedCostVoucher::totals($draft['charges'], $currency), $currency));
    }

    public function store(SaveLandedCostVoucherRequest $request, SaveLandedCostVoucher $save): JsonResponse
    {
        return ApiResponse::created($this->presenter->document($save->save($this->user($request), null, $request->validated())));
    }

    public function update(SaveLandedCostVoucherRequest $request, LandedCostVoucher $landedCostVoucher, SaveLandedCostVoucher $save): JsonResponse
    {
        return ApiResponse::success($this->presenter->document($save->save($this->user($request), $landedCostVoucher, $request->validated())));
    }

    public function destroy(Request $request, LandedCostVoucher $landedCostVoucher, SaveLandedCostVoucher $save): JsonResponse
    {
        $save->delete($this->user($request), $landedCostVoucher);

        return ApiResponse::noContent();
    }

    /**
     * Post a landed cost voucher
     *
     * Requires an `Idempotency-Key`. Posts once: value on hand into stock (weighted average
     * cost), the rest as an expense, the total payable to the charge supplier.
     */
    public function post(Request $request, LandedCostVoucher $landedCostVoucher, PostLandedCostVoucher $post): JsonResponse
    {
        return ApiResponse::success($this->presenter->document($post($this->user($request), $landedCostVoucher)));
    }

    private function user(Request $request): TenantUser
    {
        /** @var TenantUser */
        return $request->user();
    }
}
