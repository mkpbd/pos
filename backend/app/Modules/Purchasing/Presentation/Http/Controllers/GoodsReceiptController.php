<?php

namespace App\Modules\Purchasing\Presentation\Http\Controllers;

use App\Modules\Purchasing\Application\Actions\PostGoodsReceipt;
use App\Modules\Purchasing\Application\Actions\PostPurchaseReturn;
use App\Modules\Purchasing\Infrastructure\Models\GoodsReceipt;
use App\Modules\Purchasing\Infrastructure\Models\PurchaseReturn;
use App\Modules\Purchasing\Presentation\Http\Requests\PostGoodsReceiptRequest;
use App\Modules\Purchasing\Presentation\Http\Requests\PostPurchaseReturnRequest;
use App\Modules\Purchasing\Presentation\Http\Support\PurchasingPresenter;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Infrastructure\Http\Queries\ListQuery;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Goods receipts (purchases) and the returns booked against them.
 */
class GoodsReceiptController
{
    public function __construct(private readonly PurchasingPresenter $presenter) {}

    /**
     * Purchase history
     *
     * Filters: `supplier_id`, `purchase_order_id`, `from`/`to` (invoice date); `search` matches
     * our number or the supplier's invoice number.
     */
    public function index(Request $request): JsonResponse
    {
        $request->validate([
            'supplier_id' => ['sometimes', 'uuid'],
            'purchase_order_id' => ['sometimes', 'uuid'],
            'from' => ['sometimes', 'date'],
            'to' => ['sometimes', 'date', 'after_or_equal:from'],
        ]);
        $query = GoodsReceipt::query()
            ->when($request->query('supplier_id'), fn (Builder $q, string $v) => $q->where('supplier_id', $v))
            ->when($request->query('purchase_order_id'), fn (Builder $q, string $v) => $q->where('purchase_order_id', $v))
            ->when($request->query('from'), fn (Builder $q, string $v) => $q->where('invoice_date', '>=', $v))
            ->when($request->query('to'), fn (Builder $q, string $v) => $q->where('invoice_date', '<=', $v));
        $this->presenter->scopeBranches($query, $this->user($request));

        $page = ListQuery::paginate($query, $request, sortable: ['created_at', 'invoice_date', 'number', 'total'], searchable: ['number', 'supplier_invoice_number']);
        $header = $this->presenter->headers(collect($page->items()));

        return ApiResponse::paginated($page, fn (GoodsReceipt $r) => new JsonResource($header($r)));
    }

    public function store(PostGoodsReceiptRequest $request, PostGoodsReceipt $post): JsonResponse
    {
        return ApiResponse::created($this->presenter->document($post($this->user($request), $request->validated())));
    }

    public function show(Request $request, GoodsReceipt $receipt): JsonResponse
    {
        $this->presenter->assertVisible($this->user($request), $receipt->branch_id);

        return ApiResponse::success($this->presenter->document($receipt));
    }

    public function returns(Request $request): JsonResponse
    {
        $request->validate(['supplier_id' => ['sometimes', 'uuid'], 'goods_receipt_id' => ['sometimes', 'uuid']]);
        $query = PurchaseReturn::query()
            ->when($request->query('supplier_id'), fn (Builder $q, string $v) => $q->where('supplier_id', $v))
            ->when($request->query('goods_receipt_id'), fn (Builder $q, string $v) => $q->where('goods_receipt_id', $v));
        $this->presenter->scopeBranches($query, $this->user($request));

        $page = ListQuery::paginate($query, $request, sortable: ['created_at', 'number', 'total'], searchable: ['number']);
        $header = $this->presenter->headers(collect($page->items()));

        return ApiResponse::paginated($page, fn (PurchaseReturn $r) => new JsonResource($header($r)));
    }

    public function storeReturn(PostPurchaseReturnRequest $request, GoodsReceipt $receipt, PostPurchaseReturn $post): JsonResponse
    {
        return ApiResponse::created($this->presenter->document($post($this->user($request), $receipt, $request->validated())));
    }

    public function showReturn(Request $request, PurchaseReturn $purchaseReturn): JsonResponse
    {
        $this->presenter->assertVisible($this->user($request), $purchaseReturn->branch_id);

        return ApiResponse::success($this->presenter->document($purchaseReturn));
    }

    private function user(Request $request): TenantUser
    {
        /** @var TenantUser */
        return $request->user();
    }
}
