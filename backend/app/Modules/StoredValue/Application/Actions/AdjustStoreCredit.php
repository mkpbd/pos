<?php

namespace App\Modules\StoredValue\Application\Actions;

use App\Modules\Customers\Application\Contracts\CustomerDirectory;
use App\Modules\Sales\Application\Services\SalesContext;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\ValueObjects\Money;
use App\Modules\StoredValue\Application\Services\StoreCreditLedger;
use App\Modules\StoredValue\Infrastructure\Models\StoreCreditEntry;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * A manager corrects a customer's store credit (signed amount, with a reason). No money
 * moves; the balance never goes below zero (INSUFFICIENT_STORE_CREDIT).
 */
class AdjustStoreCredit
{
    public function __construct(
        private readonly SalesContext $context,
        private readonly CustomerDirectory $customers,
        private readonly StoreCreditLedger $ledger,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  array{amount: string|int|float, reason: string}  $data
     * @return array{entry: StoreCreditEntry, balance: string}
     *
     * @throws BusinessRuleViolation INSUFFICIENT_STORE_CREDIT
     */
    public function __invoke(TenantUser $actor, string $customerId, array $data): array
    {
        $customer = $this->customers->find($customerId, $this->context->organizationId()) ?? throw new NotFoundHttpException;
        $currency = $this->context->currency();
        $amount = Money::of((string) $data['amount'], $currency);
        if ($amount->isZero()) {
            throw ValidationException::withMessages(['amount' => ['The amount must not be zero.']]);
        }
        $reason = trim($data['reason']);

        return DB::transaction(function () use ($actor, $customer, $currency, $amount, $reason) {
            $entry = $this->ledger->post($customer['id'], $amount->amount(), [
                'type' => 'adjustment',
                'currency' => $currency,
                'note' => $reason,
                'created_by' => (string) $actor->getAuthIdentifier(),
            ]);

            $this->audit->record('store_credit.adjusted', $entry, new: [
                'customer' => $customer['code'],
                'amount' => $entry->amount,
                'balance_after' => $entry->balance_after,
                'reason' => $reason,
            ]);

            return ['entry' => $entry, 'balance' => $entry->balance_after];
        });
    }
}
