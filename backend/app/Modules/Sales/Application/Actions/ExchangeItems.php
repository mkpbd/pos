<?php

namespace App\Modules\Sales\Application\Actions;

use App\Modules\Inventory\Application\Services\StoreAccess;
use App\Modules\Pos\Application\Contracts\TillApprovals;
use App\Modules\Sales\Application\Services\CustomerCredit;
use App\Modules\Sales\Application\Services\TillCheckout;
use App\Modules\Sales\Domain\ExchangeTender;
use App\Modules\Sales\Infrastructure\Models\Sale;
use App\Modules\Sales\Infrastructure\Models\SaleReturn;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use Closure;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;

/**
 * POS1c: an exchange at the till. In one transaction the customer's items from an earlier
 * invoice of this branch come back (a return, completed at once exactly as `/returns` does:
 * stock to its batches, serials released, loyalty reversed, invoice credit first) and a new
 * sale is made, priced as checkout. The returned value V (the return's refund due) pays the
 * new sale's total T up to A = min(V, T): an `exchange` refund on the return and an `exchange`
 * payment on the sale. The customer pays T − A with the usual tenders, or gets V − A back with
 * the return's usual refund methods. Any failure rolls both documents back.
 *
 * Needs `returns.approve`, or a manager's approval for action `return` bound to the original
 * invoice (consumed by the new sale).
 */
class ExchangeItems
{
    public function __construct(
        private readonly StoreAccess $storeAccess,
        private readonly TillCheckout $tillCheckout,
        private readonly RequestSaleReturn $requestReturn,
        private readonly CompleteSaleReturn $completeReturn,
        private readonly CompleteSale $completeSale,
        private readonly AuditTrail $audit,
        private readonly CustomerCredit $credit,
    ) {}

    /**
     * @param  array<string, mixed>  $data  validated ExchangeRequest data: `return` {sale_id, return_reason_id?, notes?, lines},
     *                                      `approval_id`?, `refunds`?, and the checkout fields of the new sale
     * @return array{sale: Sale, return: SaleReturn}
     *
     * @throws ValidationException|BusinessRuleViolation
     */
    public function __invoke(TenantUser $actor, array $data): array
    {
        $store = $this->storeAccess->require($actor, $data['store_id']);
        $original = Sale::query()->find($data['return']['sale_id']);
        if ($original === null || ! $actor->canAccessBranch($original->branch_id)) {
            throw ValidationException::withMessages(['return.sale_id' => ['The selected invoice does not exist.']]);
        }
        if ($original->branch_id !== $store['branch_id']) {
            throw new BusinessRuleViolation('EXCHANGE_OTHER_BRANCH', "{$original->number} was sold at another branch; only invoices of this branch can be exchanged here.", [
                'sale_id' => $original->id,
                'sale_number' => $original->number,
            ]);
        }
        $approvalId = $this->approval($actor, $original, $store['id'], $data['approval_id'] ?? null);

        $cart = $data;
        unset($cart['return'], $cart['approval_id'], $cart['refunds'], $cart['held_sale_id']);
        // Absent: the new sale is for the invoice's customer (null = a walk-in sale).
        if (! array_key_exists('customer_id', $cart)) {
            $cart['customer_id'] = $original->customer_id;
        }

        return DB::transaction(function () use ($actor, $data, $store, $cart, $approvalId, $original) {
            // Lock order: the original sale, the return (RequestSaleReturn), then the new sale's.
            $return = $this->returnErrors(fn () => $this->requestReturn->open($actor, $data['return']));

            // T: priced exactly as checkout prices it (again inside CompleteSale, under the same locks).
            [$priced] = $this->tillCheckout->price($actor, $store, $cart);
            // The new sale's number is taken now (after the customer, as checkout does) so the
            // return's `exchange` refund can name it.
            if ($original->customer_id !== null) {
                $this->credit->lock($original->customer_id);
            }
            $saleNumber = $this->completeSale->invoiceNumber($store);
            $return = ($this->completeReturn)($actor, $return, array_values($data['refunds'] ?? []), ['total' => $priced['total'], 'sale_number' => $saleNumber]);
            $value = $return->refunded_total;
            $applied = CompleteSaleReturn::exchangeApplied($value, $priced['total'], $return->currency);

            $sale = ($this->completeSale)($actor, $cart, new ExchangeTender($applied, $return->id, $return->number, $saleNumber));
            if ($approvalId !== null) {
                app(TillApprovals::class)->consume($approvalId, $sale->id);
            }
            $return->update(['exchange_sale_id' => $sale->id]);

            $this->audit->record('sale.exchanged', $sale, new: [
                'sale' => $sale->number,
                'return' => $return->number,
                'original_sale' => $original->number,
                'value' => $value,
                'applied' => $applied,
            ]);

            return ['sale' => $sale, 'return' => $return];
        });
    }

    /**
     * The manager approval to use, or null when the actor may approve returns themselves.
     *
     * @throws BusinessRuleViolation APPROVAL_REQUIRED, APPROVAL_INVALID
     */
    private function approval(TenantUser $actor, Sale $original, string $storeId, ?string $approvalId): ?string
    {
        if (Gate::forUser($actor)->allows('returns.approve')) {
            return null;
        }
        if (blank($approvalId)) {
            throw new BusinessRuleViolation('APPROVAL_REQUIRED', 'A manager must approve this exchange.', [
                'action' => TillApprovals::RETURN,
                'sale_id' => $original->id,
            ]);
        }

        return app(TillApprovals::class)->check($approvalId, (string) $actor->getAuthIdentifier(), TillApprovals::RETURN, [
            'sale_id' => $original->id,
            'store_id' => $storeId,
        ])['id'];
    }

    /**
     * Errors of the return half are reported under `return.` (as the request body nests them).
     *
     * @template T
     *
     * @param  Closure(): T  $open
     * @return T
     */
    private function returnErrors(Closure $open): mixed
    {
        try {
            return $open();
        } catch (ValidationException $e) {
            $errors = [];
            foreach ($e->errors() as $key => $messages) {
                $errors["return.{$key}"] = $messages;
            }

            throw ValidationException::withMessages($errors);
        }
    }
}
