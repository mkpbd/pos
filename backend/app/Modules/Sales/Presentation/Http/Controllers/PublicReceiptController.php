<?php

namespace App\Modules\Sales\Presentation\Http\Controllers;

use App\Modules\Sales\Application\Services\ReceiptLinks;
use App\Modules\Sales\Presentation\Http\Support\PublicReceiptPresenter;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Http\JsonResponse;

/**
 * POS1d: the public digital receipt on the store (no sign-in; the organization comes from the
 * host like every `/store/*` endpoint).
 */
class PublicReceiptController
{
    /**
     * Digital receipt
     *
     * The receipt of the link's token: header and footer, lines, totals, tax, payments, change,
     * exchange, customer name and cashier first name (`status: cancelled` for a cancelled sale).
     * Unknown token → 404 `RECEIPT_NOT_FOUND`. 30 a minute per IP.
     */
    public function show(string $token, ReceiptLinks $links, PublicReceiptPresenter $receipts): JsonResponse
    {
        $sale = $links->saleFor($token);
        if ($sale === null) {
            return ApiResponse::error('RECEIPT_NOT_FOUND', 'This receipt does not exist.', 404)->header('Cache-Control', 'no-store');
        }

        return ApiResponse::success($receipts->present($sale))->header('Cache-Control', 'no-store')->header('X-Robots-Tag', 'noindex');
    }
}
