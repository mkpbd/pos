<?php

namespace App\Modules\Pos\Presentation\Http\Controllers;

use App\Modules\Pos\Presentation\Http\Requests\ExchangeRequest;
use App\Modules\Sales\Application\Actions\ExchangeItems;
use App\Modules\Sales\Presentation\Http\Support\ReturnPresenter;
use App\Modules\Sales\Presentation\Http\Support\SalePresenter;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Http\JsonResponse;

/**
 * POS1c: exchanges at the till.
 */
class ExchangeController
{
    /**
     * Exchange items
     *
     * `{return: {sale_id, return_reason_id?, notes?, lines: [{sale_line_id, quantity, restock?, serials?}]},
     * approval_id?, store_id, customer_id?, lines, …checkout fields, payments: [], refunds?: []}`.
     * Returns the earlier invoice's items and sells the new ones in one transaction; the returned
     * value pays the new sale (`exchange`), the customer pays the difference (`payments`) or gets
     * it back (`refunds`, adding up to the rest: `REFUND_MISMATCH`). Errors: `EXCHANGE_OTHER_BRANCH`,
     * `APPROVAL_REQUIRED` (`details.action: return`), `APPROVAL_INVALID`, `SALE_CANCELLED`, the
     * checkout and return errors (return lines under `return.lines.*`). Requires an
     * `Idempotency-Key`. `201` `{sale, return, credit_note}` (the credit note's code is shown once).
     */
    public function store(ExchangeRequest $request, ExchangeItems $exchange, SalePresenter $sales, ReturnPresenter $returns): JsonResponse
    {
        /** @var TenantUser $user */
        $user = $request->user();
        ['sale' => $sale, 'return' => $return] = $exchange($user, $request->validated());
        $returnDocument = $returns->document($return->refresh());

        return ApiResponse::created([
            'sale' => $sales->document($sale->refresh(), $request->user()->can('products.view_cost')),
            'return' => $returnDocument,
            'credit_note' => $returnDocument['credit_note'] ?? null,
        ]);
    }
}
