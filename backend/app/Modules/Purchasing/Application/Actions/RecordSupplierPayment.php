<?php

namespace App\Modules\Purchasing\Application\Actions;

use App\Modules\Purchasing\Application\Services\PurchasingContext;
use App\Modules\Purchasing\Infrastructure\Models\SupplierPayment;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\SequenceGenerator;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Domain\ValueObjects\Money;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Records money paid to a supplier. Payments are immutable; a mistake is corrected by a
 * new entry (refunds from suppliers arrive with the Payments module).
 */
class RecordSupplierPayment
{
    public function __construct(
        private readonly PurchasingContext $context,
        private readonly SequenceGenerator $sequences,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  array{supplier_id: string, amount: string, method: string, reference?: ?string, paid_on: string, notes?: ?string, branch_id?: ?string}  $data
     */
    public function __invoke(TenantUser $actor, array $data): SupplierPayment
    {
        $organizationId = $this->context->organizationId();
        $this->context->requireActiveSupplier($data['supplier_id']);
        $branchId = $data['branch_id'] ?? null;
        if ($branchId !== null && ! $actor->canAccessBranch($branchId)) {
            throw ValidationException::withMessages(['branch_id' => ['The selected branch does not exist.']]);
        }

        $currency = $this->context->currency();
        $amount = Money::of($data['amount'], $currency);
        if (! $amount->isPositive()) {
            throw ValidationException::withMessages(['amount' => ['The amount must be greater than zero.']]);
        }

        return DB::transaction(function () use ($actor, $organizationId, $data, $branchId, $currency, $amount) {
            $payment = SupplierPayment::query()->create([
                'organization_id' => $organizationId,
                'number' => $this->sequences->next($organizationId, 'supplier_payment', 'SPAY-'),
                'supplier_id' => $data['supplier_id'],
                'branch_id' => $branchId,
                'currency' => $currency,
                'amount' => $amount->amount(),
                'method' => $data['method'],
                'reference' => $data['reference'] ?? null,
                'paid_on' => $data['paid_on'],
                'notes' => $data['notes'] ?? null,
                'created_by' => $actor->getAuthIdentifier(),
            ]);

            $this->audit->record('supplier_payment.recorded', $payment, new: [
                'number' => $payment->number,
                'supplier_id' => $payment->supplier_id,
                'amount' => $payment->amount,
                'method' => $payment->method->value,
            ]);

            return $payment;
        });
    }
}
