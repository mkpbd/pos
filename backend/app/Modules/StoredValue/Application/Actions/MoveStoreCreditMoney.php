<?php

namespace App\Modules\StoredValue\Application\Actions;

use App\Modules\Customers\Application\Contracts\CustomerDirectory;
use App\Modules\Inventory\Application\Services\StoreAccess;
use App\Modules\Payments\Application\Contracts\PaymentLedger;
use App\Modules\Payments\Domain\LedgerEntry;
use App\Modules\Payments\Domain\PaymentDirection;
use App\Modules\Payments\Domain\PaymentMethod;
use App\Modules\Payments\Domain\PaymentSource;
use App\Modules\Sales\Application\Services\SalesContext;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\SequenceGenerator;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\ValueObjects\Money;
use App\Modules\StoredValue\Application\Services\StoreCreditLedger;
use App\Modules\StoredValue\Infrastructure\Models\StoreCreditEntry;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Money that moves a customer's store credit at the till: an advance (top-up: money in,
 * receipt ADV-…) or a pay-out (withdrawal: money out, receipt ADW-…). The money goes through
 * the payments ledger — cash into / out of the actor's open drawer in the store's branch
 * (CASH_SESSION_REQUIRED, INSUFFICIENT_CASH) — and the credit and the money commit together.
 */
class MoveStoreCreditMoney
{
    public function __construct(
        private readonly SalesContext $context,
        private readonly CustomerDirectory $customers,
        private readonly StoreAccess $stores,
        private readonly StoreCreditLedger $ledger,
        private readonly PaymentLedger $payments,
        private readonly SequenceGenerator $sequences,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  array{store_id: string, amount: string|int|float, method: string, reference?: ?string, note?: ?string}  $data
     * @return array{entry: StoreCreditEntry, balance: string}
     *
     * @throws ValidationException|BusinessRuleViolation
     */
    public function topUp(TenantUser $actor, string $customerId, array $data): array
    {
        return $this->move($actor, $customerId, $data, true);
    }

    /**
     * @param  array{store_id: string, amount: string|int|float, method: string, reference?: ?string, note?: ?string}  $data
     * @return array{entry: StoreCreditEntry, balance: string}
     *
     * @throws ValidationException|BusinessRuleViolation INSUFFICIENT_STORE_CREDIT, INSUFFICIENT_CASH, CASH_SESSION_REQUIRED
     */
    public function withdraw(TenantUser $actor, string $customerId, array $data): array
    {
        return $this->move($actor, $customerId, $data, false);
    }

    /**
     * @param  array<string, mixed>  $data
     * @return array{entry: StoreCreditEntry, balance: string}
     */
    private function move(TenantUser $actor, string $customerId, array $data, bool $in): array
    {
        $organizationId = $this->context->organizationId();
        $customer = $this->customers->find($customerId, $organizationId) ?? throw new NotFoundHttpException;
        if ($in && ($customer['archived'] || ! $customer['is_active'])) {
            throw ValidationException::withMessages(['customer' => ["{$customer['name']} is archived or inactive; an advance cannot be taken."]]);
        }
        $store = $this->stores->require($actor, (string) $data['store_id']);
        $currency = $this->context->currency();
        $amount = Money::of((string) $data['amount'], $currency);
        if (! $amount->isPositive()) {
            throw ValidationException::withMessages(['amount' => ['The amount must be greater than zero.']]);
        }
        $method = PaymentMethod::from((string) $data['method']);
        $reference = filled($data['reference'] ?? null) ? trim((string) $data['reference']) : null;
        $note = filled($data['note'] ?? null) ? trim((string) $data['note']) : null;

        if (! $in && $amount->greaterThan(Money::of($balance = $this->ledger->balance($customer['id']), $currency))) {
            // Friendly early answer; the authoritative check runs again under the lock.
            throw new BusinessRuleViolation('INSUFFICIENT_STORE_CREDIT', "{$customer['name']} has {$balance} in store credit.", [
                'balance' => $balance,
                'required' => $amount->amount(),
            ]);
        }

        return DB::transaction(function () use ($actor, $organizationId, $customer, $store, $currency, $amount, $method, $reference, $note, $in) {
            $receipt = $in
                ? $this->sequences->next($organizationId, 'store_credit_top_up', 'ADV-')
                : $this->sequences->next($organizationId, 'store_credit_withdrawal', 'ADW-');
            $entryId = (string) Str::uuid7();

            // The drawer first (same lock order as checkout: register session, then the customer's credit).
            $this->payments->record($actor, $store['branch_id'], [
                new LedgerEntry(
                    $in ? PaymentDirection::In : PaymentDirection::Out,
                    $method,
                    $amount->amount(),
                    $customer['id'],
                    $reference,
                    $in ? "Advance from {$customer['name']}" : "Store credit paid out to {$customer['name']}",
                ),
            ], new PaymentSource($in ? PaymentSource::STORE_CREDIT_TOP_UP : PaymentSource::STORE_CREDIT_WITHDRAWAL, $entryId, $receipt));

            $entry = $this->ledger->post($customer['id'], $in ? $amount->amount() : $amount->negate()->amount(), [
                'id' => $entryId,
                'type' => $in ? 'top_up' : 'withdrawal',
                'currency' => $currency,
                'method' => $method->value,
                'reference' => $reference,
                'receipt_number' => $receipt,
                'note' => $note,
                'store_id' => $store['id'],
                'created_by' => (string) $actor->getAuthIdentifier(),
            ]);

            $this->audit->record($in ? 'store_credit.top_up' : 'store_credit.withdrawal', $entry, new: [
                'customer' => $customer['code'],
                'receipt_number' => $receipt,
                'amount' => $entry->amount,
                'method' => $method->value,
                'balance_after' => $entry->balance_after,
            ]);

            return ['entry' => $entry, 'balance' => $entry->balance_after];
        });
    }
}
