<?php

namespace App\Modules\Purchasing\Application\Actions;

use App\Modules\Payments\Application\Contracts\PaymentLedger;
use App\Modules\Payments\Domain\LedgerEntry;
use App\Modules\Payments\Domain\PaymentDirection;
use App\Modules\Payments\Domain\PaymentMethod as LedgerMethod;
use App\Modules\Payments\Domain\PaymentSource;
use App\Modules\Purchasing\Application\Services\PurchasingContext;
use App\Modules\Purchasing\Application\Services\SupplierMoneyBranch;
use App\Modules\Purchasing\Infrastructure\Models\SupplierPayment;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\SequenceGenerator;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Domain\ValueObjects\Money;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Records money paid to a supplier. ST1: the payment goes through the payments ledger in
 * the same transaction, exactly like an expense — cash comes out of the recorder's open
 * register session drawer (CASH_SESSION_REQUIRED without one, INSUFFICIENT_CASH when the
 * drawer holds less), other methods are recorded without a drawer. Payments are immutable;
 * a mistake is voided (VoidSupplierPayment).
 */
class RecordSupplierPayment
{
    public function __construct(
        private readonly PurchasingContext $context,
        private readonly SupplierMoneyBranch $branches,
        private readonly PaymentLedger $payments,
        private readonly SequenceGenerator $sequences,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  array{supplier_id: string, amount: string, method: string, reference?: ?string, paid_on: string, notes?: ?string, branch_id?: ?string}  $data
     */
    public function __invoke(TenantUser $actor, array $data): SupplierPayment
    {
        $organizationId = $this->context->organizationId();
        $supplier = $this->context->requireActiveSupplier($data['supplier_id']);
        $method = LedgerMethod::from($data['method']);
        $currency = $this->context->currency();
        $amount = Money::of((string) $data['amount'], $currency);
        if (! $amount->isPositive()) {
            throw ValidationException::withMessages(['amount' => ['The amount must be greater than zero.']]);
        }
        $branchId = $this->branches->resolve($actor, $data['branch_id'] ?? null, $method);
        $clean = fn (string $key) => filled($data[$key] ?? null) ? trim((string) $data[$key]) : null;

        return DB::transaction(function () use ($actor, $organizationId, $supplier, $data, $branchId, $currency, $amount, $method, $clean) {
            $payment = SupplierPayment::query()->create([
                'organization_id' => $organizationId,
                'number' => $this->sequences->next($organizationId, 'supplier_payment', 'SPAY-'),
                'supplier_id' => $data['supplier_id'],
                'branch_id' => $branchId,
                'currency' => $currency,
                'amount' => $amount->amount(),
                'method' => $method->value,
                'reference' => $clean('reference'),
                'paid_on' => $data['paid_on'],
                'notes' => $clean('notes'),
                'created_by' => $actor->getAuthIdentifier(),
            ]);

            $this->payments->record($actor, $branchId, [
                new LedgerEntry(PaymentDirection::Out, $method, $payment->amount, reference: $payment->reference, description: 'Supplier payment: '.$supplier['name']),
            ], new PaymentSource(PaymentSource::SUPPLIER_PAYMENT, $payment->id, $payment->number));

            $this->audit->record('supplier_payment.recorded', $payment, new: [
                'number' => $payment->number,
                'supplier_id' => $payment->supplier_id,
                'branch_id' => $branchId,
                'amount' => $payment->amount,
                'method' => $payment->method->value,
            ]);

            return $payment;
        });
    }
}
