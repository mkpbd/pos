<?php

namespace App\Modules\Sales\Presentation\Http\Controllers;

use App\Modules\Sales\Application\Actions\SendSaleReceipt;
use App\Modules\Sales\Application\Services\ReceiptLinks;
use App\Modules\Sales\Infrastructure\Models\Sale;
use App\Modules\Sales\Presentation\Http\Support\PublicReceiptPresenter;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * POS1d: digital receipts of a sale — the public link and sending it by SMS or e-mail.
 */
class SaleReceiptController
{
    /**
     * Receipt link
     *
     * `{url, token}` — the public receipt page (made on first need, then the same). `url` is
     * null when the organization has no open online store with a domain.
     */
    public function link(Request $request, Sale $sale, ReceiptLinks $links): JsonResponse
    {
        $this->assertBranch($request, $sale);
        $link = $links->forSale($sale);

        return ApiResponse::success(['url' => $links->url($link), 'token' => $link->token]);
    }

    /**
     * Send the receipt
     *
     * `{channel: sms|email, to?}` — `to` defaults to the sale customer's mobile number / e-mail
     * address. → 201 `{channel, recipient_masked, status: queued|skipped|failed}`. Errors:
     * `SMS_NOT_READY`, `SMS_TEMPLATE_OFF`, `RECEIPT_SEND_LIMIT` (5 per sale; all 422),
     * validation on `to`. 10 sends a minute per user.
     */
    public function send(Request $request, Sale $sale, SendSaleReceipt $send, PublicReceiptPresenter $receipts): JsonResponse
    {
        $data = $request->validate([
            'channel' => ['required', Rule::in(['sms', 'email'])],
            'to' => ['sometimes', 'nullable', 'string', 'max:254'],
        ]);
        $this->assertBranch($request, $sale);

        /** @var TenantUser $user */
        $user = $request->user();

        return ApiResponse::created($send($user, $sale, $data['channel'], $data['to'] ?? null, fn () => $receipts->present($sale)));
    }

    private function assertBranch(Request $request, Sale $sale): void
    {
        /** @var TenantUser $user */
        $user = $request->user();
        if (! $user->canAccessBranch($sale->branch_id)) {
            abort(404);
        }
    }
}
