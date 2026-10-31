<?php

namespace App\Modules\Sales\Application\Actions;

use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Customers\Application\Contracts\CustomerDirectory;
use App\Modules\Payments\Application\Contracts\PaymentLedger;
use App\Modules\Payments\Domain\LedgerEntry;
use App\Modules\Payments\Domain\PaymentDirection;
use App\Modules\Payments\Domain\PaymentMethod;
use App\Modules\Payments\Domain\PaymentSource;
use App\Modules\Sales\Application\Services\CustomerCredit;
use App\Modules\Sales\Application\Services\SalesContext;
use App\Modules\Sales\Infrastructure\Models\CustomerPayment;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\SequenceGenerator;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\ValueObjects\Money;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * A customer pays (part of) what they owe from credit sales. The payment cannot exceed the
 * outstanding balance (no advances), goes into the payments ledger (cash into the
 * receiver's drawer) and is immutable.
 */
class ReceiveCustomerPayment
{
    public function __construct(
        private readonly SalesContext $context,
        private readonly CustomerDirectory $customers,
        private readonly BranchDirectory $branches,
        private readonly CustomerCredit $credit,
        private readonly PaymentLedger $payments,
        private readonly SequenceGenerator $sequences,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  array{customer_id: string, branch_id: string, amount: string, method: string, reference?: ?string, notes?: ?string}  $data
     */
    public function __invoke(TenantUser $actor, array $data): CustomerPayment
    {
        $organizationId = $this->context->organizationId();
        $customer = $this->customers->find($data['customer_id'], $organizationId)
            ?? throw ValidationException::withMessages(['customer_id' => ['The selected customer does not exist.']]);
        if (! $this->branches->isActiveBranchOf($data['branch_id'], $organizationId) || ! $actor->canAccessBranch($data['branch_id'])) {
            throw ValidationException::withMessages(['branch_id' => ['The selected branch does not exist.']]);
        }
        $currency = $this->context->currency();
        $amount = Money::of((string) $data['amount'], $currency);
        if (! $amount->isPositive()) {
            throw ValidationException::withMessages(['amount' => ['The amount must be greater than zero.']]);
        }
        $method = PaymentMethod::from($data['method']);

        return DB::transaction(function () use ($actor, $organizationId, $customer, $data, $currency, $amount, $method) {
            $this->credit->lock($customer['id']);
            $outstanding = Money::of($this->credit->outstanding($customer), $currency);
            if ($amount->greaterThan($outstanding)) {
                throw new BusinessRuleViolation('PAYMENT_EXCEEDS_BALANCE', "{$customer['name']} owes {$outstanding->amount()}; a payment cannot be larger.", [
                    'outstanding' => $outstanding->amount(),
                    'amount' => $amount->amount(),
                ]);
            }

            $payment = CustomerPayment::query()->create([
                'organization_id' => $organizationId,
                'branch_id' => $data['branch_id'],
                'customer_id' => $customer['id'],
                'number' => $this->sequences->next($organizationId, 'customer_payment', 'RCP-'),
                'currency' => $currency,
                'amount' => $amount->amount(),
                'method' => $method->value,
                'reference' => filled($data['reference'] ?? null) ? trim($data['reference']) : null,
                'notes' => filled($data['notes'] ?? null) ? trim($data['notes']) : null,
                'created_by' => $actor->getAuthIdentifier(),
                'created_at' => now(),
            ]);

            $this->payments->record($actor, $data['branch_id'], [
                new LedgerEntry(PaymentDirection::In, $method, $amount->amount(), $customer['id'], $payment->reference, "Payment from {$customer['name']}"),
            ], new PaymentSource('customer_payment', $payment->id, $payment->number));

            $this->audit->record('customer_payment.received', $payment, new: [
                'number' => $payment->number,
                'customer' => $customer['code'],
                'amount' => $payment->amount,
                'method' => $payment->method,
            ]);

            return $payment;
        });
    }
}
