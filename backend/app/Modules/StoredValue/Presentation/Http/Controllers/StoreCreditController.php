<?php

namespace App\Modules\StoredValue\Presentation\Http\Controllers;

use App\Modules\Customers\Application\Contracts\CustomerDirectory;
use App\Modules\Sales\Application\Services\SalesContext;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Infrastructure\Http\Queries\ListQuery;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\StoredValue\Application\Actions\AdjustStoreCredit;
use App\Modules\StoredValue\Application\Actions\MoveStoreCreditMoney;
use App\Modules\StoredValue\Application\Services\StoreCreditLedger;
use App\Modules\StoredValue\Infrastructure\Models\StoreCreditEntry;
use App\Modules\Users\Application\Contracts\UserDirectory;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * POS1b: a customer's store credit — balance, entries, advances taken at the till,
 * pay-outs and manual adjustments.
 */
class StoreCreditController
{
    public function __construct(
        private readonly SalesContext $context,
        private readonly CustomerDirectory $customers,
        private readonly StoreCreditLedger $ledger,
        private readonly UserDirectory $users,
    ) {}

    /**
     * Store credit balance
     *
     * `{balance, currency, last_activity_at}`.
     */
    public function show(string $customerId): JsonResponse
    {
        $this->requireCustomer($customerId);
        $balance = $this->ledger->balances([$customerId])[$customerId];

        return ApiResponse::success([
            'balance' => $balance['balance'],
            'currency' => $this->context->currency(),
            'last_activity_at' => $balance['last_activity_at'],
        ]);
    }

    /**
     * Store credit entries
     *
     * Newest first, paginated.
     */
    public function entries(Request $request, string $customerId): JsonResponse
    {
        $this->requireCustomer($customerId);
        $page = StoreCreditEntry::query()
            ->where('customer_id', $customerId)
            ->orderByDesc('created_at')->orderByDesc('id')
            ->paginate(ListQuery::perPage($request));
        $names = $this->users->names($this->context->organizationId(), collect($page->items())->pluck('created_by')->filter()->unique()->values()->all());

        return ApiResponse::paginated($page, fn (StoreCreditEntry $e) => new JsonResource($this->entry($e, $names)));
    }

    /**
     * Take an advance
     *
     * `{store_id, amount, method: cash|card|mobile_banking, reference?, note?}` → `{entry, balance, receipt_number}`.
     * Cash goes into the caller's open register session in the store's branch (`CASH_SESSION_REQUIRED`).
     * Requires an `Idempotency-Key`.
     */
    public function topUp(Request $request, string $customerId, MoveStoreCreditMoney $move): JsonResponse
    {
        $result = $move->topUp($this->user($request), $customerId, $request->validate($this->moneyRules()));

        return $this->created($result);
    }

    /**
     * Pay out store credit
     *
     * Same body as an advance. More than the balance → `INSUFFICIENT_STORE_CREDIT`; cash comes
     * out of the caller's drawer (`INSUFFICIENT_CASH`). Requires an `Idempotency-Key`.
     */
    public function withdraw(Request $request, string $customerId, MoveStoreCreditMoney $move): JsonResponse
    {
        $result = $move->withdraw($this->user($request), $customerId, $request->validate($this->moneyRules()));

        return $this->created($result);
    }

    /**
     * Adjust store credit
     *
     * `{amount (signed, ≠ 0), reason}`; never below zero (`INSUFFICIENT_STORE_CREDIT`). Requires an `Idempotency-Key`.
     */
    public function adjust(Request $request, string $customerId, AdjustStoreCredit $adjust): JsonResponse
    {
        $data = $request->validate([
            'amount' => ['required', 'decimal:0,2', 'not_in:0', 'min:-10000000', 'max:10000000'],
            'reason' => ['required', 'string', 'max:200'],
        ]);

        return $this->created($adjust($this->user($request), $customerId, $data));
    }

    /**
     * @return array<string, mixed>
     */
    private function moneyRules(): array
    {
        return [
            'store_id' => ['required', 'uuid'],
            'amount' => ['required', 'decimal:0,2', 'gt:0', 'max:10000000'],
            'method' => ['required', 'string', 'in:cash,card,mobile_banking'],
            'reference' => ['sometimes', 'nullable', 'string', 'max:100'],
            'note' => ['sometimes', 'nullable', 'string', 'max:200'],
        ];
    }

    /**
     * @param  array{entry: StoreCreditEntry, balance: string}  $result
     */
    private function created(array $result): JsonResponse
    {
        $entry = $result['entry'];
        $names = $this->users->names($this->context->organizationId(), array_values(array_filter([$entry->created_by])));

        return ApiResponse::created([
            'entry' => $this->entry($entry, $names),
            'balance' => $result['balance'],
            'receipt_number' => $entry->receipt_number,
        ]);
    }

    /**
     * @param  array<string, string>  $names
     * @return array<string, mixed>
     */
    private function entry(StoreCreditEntry $e, array $names): array
    {
        return [
            'id' => $e->id,
            'type' => $e->type,
            'amount' => $e->amount,
            'balance_after' => $e->balance_after,
            'currency' => $e->currency,
            'method' => $e->method,
            'reference' => $e->reference,
            'reference_type' => $e->reference_type,
            'reference_id' => $e->reference_id,
            'reference_number' => $e->reference_number,
            'receipt_number' => $e->receipt_number,
            'note' => $e->note,
            'created_by' => $e->created_by === null ? null : ['id' => $e->created_by, 'name' => $names[$e->created_by] ?? null],
            'created_at' => $e->created_at->toIso8601String(),
        ];
    }

    private function requireCustomer(string $customerId): void
    {
        if ($this->customers->find($customerId, $this->context->organizationId()) === null) {
            throw new NotFoundHttpException;
        }
    }

    private function user(Request $request): TenantUser
    {
        /** @var TenantUser */
        return $request->user();
    }
}
