<?php

namespace App\Modules\StoredValue\Presentation\Http\Controllers;

use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Infrastructure\Http\Queries\ListQuery;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\StoredValue\Application\Actions\IssueVoucher;
use App\Modules\StoredValue\Application\Actions\SellGiftCard;
use App\Modules\StoredValue\Application\Actions\VoidGiftCard;
use App\Modules\StoredValue\Application\Queries\GiftCardQueries;
use App\Modules\StoredValue\Domain\GiftCardCode;
use App\Modules\StoredValue\Domain\GiftCardKind;
use Closure;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * POS1b: gift cards (sold at the till), vouchers and credit notes. Full codes appear only in
 * the response that issues a card; everything else shows the last 4 characters.
 */
class GiftCardController
{
    public function __construct(private readonly GiftCardQueries $queries) {}

    /**
     * Gift cards, vouchers and credit notes
     *
     * Newest first. Filters: `search` (last 4 characters or customer name / code / phone),
     * `status` (`active` = spendable, `expired`, `void`), `kind` (`gift_card|voucher|credit_note`).
     */
    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'search' => ['sometimes', 'nullable', 'string', 'max:100'],
            'status' => ['sometimes', 'nullable', Rule::in(GiftCardQueries::STATUSES)],
            'kind' => ['sometimes', 'nullable', Rule::enum(GiftCardKind::class)],
        ]);
        $page = $this->queries->query($filters)->paginate(ListQuery::perPage($request));

        return ApiResponse::success($this->queries->present($page->items()), meta: ['pagination' => [
            'current_page' => $page->currentPage(),
            'per_page' => $page->perPage(),
            'total' => $page->total(),
            'last_page' => $page->lastPage(),
        ]]);
    }

    /**
     * One gift card with its history
     */
    public function show(string $giftCard): JsonResponse
    {
        return ApiResponse::success($this->queries->detail($giftCard));
    }

    /**
     * Sell a gift card at the till
     *
     * `amount` 10 – 1 000 000, paid by `payments` that add up to it (cash goes into the seller's
     * open drawer in the store's branch: `CASH_SESSION_REQUIRED`). Optional pre-printed `code`
     * (8–20 letters/digits), `customer_id`, `expires_at` (default 12 months; `never_expires: true`
     * for none). The response holds the full code — the only time it is shown.
     */
    public function sell(Request $request, SellGiftCard $sell): JsonResponse
    {
        $data = $request->validate([
            'store_id' => ['required', 'uuid'],
            'amount' => ['required', 'decimal:0,2', 'min:10', 'max:1000000'],
            'payments' => ['required', 'array', 'min:1', 'max:5'],
            'payments.*.method' => ['required', Rule::in(['cash', 'card', 'mobile_banking'])],
            'payments.*.amount' => ['required', 'decimal:0,2', 'min:0.01', 'max:1000000'],
            'payments.*.reference' => ['sometimes', 'nullable', 'string', 'max:100'],
            'customer_id' => ['sometimes', 'nullable', 'uuid'],
            'code' => ['sometimes', 'nullable', 'string', 'max:40', $this->prePrintedCode()],
            ...$this->expiryRules(),
        ]);
        ['card' => $card, 'code' => $code] = $sell($this->user($request), $data);

        return ApiResponse::created([
            'gift_card' => $this->queries->issued($card, $code),
            'receipt_number' => $card->sale_receipt_number,
        ]);
    }

    /**
     * Issue a voucher
     *
     * Free value given by a manager (`amount` 10 – 1 000 000, `reason` required; `expires_at` a
     * date — the end of that day in the organization's timezone — default 12 months, or
     * `never_expires: true`). No money moves. The response holds the
     * full code — the only time it is shown.
     */
    public function issueVoucher(Request $request, IssueVoucher $issue): JsonResponse
    {
        $data = $request->validate([
            'amount' => ['required', 'decimal:0,2', 'min:10', 'max:1000000'],
            'reason' => ['required', 'string', 'max:200'],
            'customer_id' => ['sometimes', 'nullable', 'uuid'],
            ...$this->expiryRules(),
        ]);
        ['card' => $card, 'code' => $code] = $issue($this->user($request), $data);

        return ApiResponse::created([
            'gift_card' => $this->queries->issued($card, $code),
            'receipt_number' => null,
        ]);
    }

    /**
     * Gift card balance by code
     *
     * For the till: an unknown code answers 200 with `usable: false, reason: not_found`.
     * `reason`: `not_found|void|expired`. Throttled (20 a minute per user).
     */
    public function lookup(Request $request): JsonResponse
    {
        $data = $request->validate(['code' => ['required', 'string', 'max:40']]);

        return ApiResponse::success($this->queries->lookup($data['code']));
    }

    /**
     * Void a gift card
     *
     * The remaining balance is written off. Already void → `GIFT_CARD_INVALID` (`reason: void`).
     */
    public function void(Request $request, string $giftCard, VoidGiftCard $void): JsonResponse
    {
        $data = $request->validate(['reason' => ['required', 'string', 'max:200']]);
        $void($this->user($request), $giftCard, $data['reason']);

        return ApiResponse::success($this->queries->detail($giftCard));
    }

    /**
     * @return array<string, list<mixed>>
     */
    private function expiryRules(): array
    {
        return [
            'expires_at' => ['sometimes', 'nullable', 'date', 'prohibited_if_accepted:never_expires'],
            'never_expires' => ['sometimes', 'boolean'],
        ];
    }

    private function prePrintedCode(): Closure
    {
        return function (string $attribute, mixed $value, Closure $fail) {
            if (is_string($value) && ! GiftCardCode::isValidPrePrinted($value)) {
                $fail('A card number is 8–20 letters and digits.');
            }
        };
    }

    private function user(Request $request): TenantUser
    {
        /** @var TenantUser */
        return $request->user();
    }
}
