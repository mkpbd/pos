<?php

namespace App\Modules\Purchasing\Application\Actions;

use App\Modules\Payments\Application\Contracts\PaymentLedger;
use App\Modules\Payments\Domain\LedgerEntry;
use App\Modules\Payments\Domain\PaymentDirection;
use App\Modules\Payments\Domain\PaymentMethod as LedgerMethod;
use App\Modules\Payments\Domain\PaymentSource;
use App\Modules\Purchasing\Application\Services\PurchasingContext;
use App\Modules\Purchasing\Application\Services\SupplierMoneyBranch;
use App\Modules\Purchasing\Infrastructure\Models\SupplierRefund;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\SequenceGenerator;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Domain\ValueObjects\Money;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * ST1: money a supplier gives back (an overpayment, credit for returned goods). It goes
 * through the payments ledger as money in — cash into the recorder's open drawer — and the
 * supplier's statement shows it as raising what we owe (it reverses an earlier payment).
 */
class RecordSupplierRefund
{
    public function __construct(
        private readonly PurchasingContext $context,
        private readonly SupplierMoneyBranch $branches,
        private readonly PaymentLedger $payments,
        private readonly SequenceGenerator $sequences,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  array{supplier_id: string, amount: string, method: string, reference?: ?string, received_on: string, notes?: ?string, branch_id?: ?string}  $data
     */
    public function __invoke(TenantUser $actor, array $data): SupplierRefund
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
            $refund = SupplierRefund::query()->create([
                'organization_id' => $organizationId,
                'number' => $this->sequences->next($organizationId, 'supplier_refund', 'SREF-'),
                'supplier_id' => $data['supplier_id'],
                'branch_id' => $branchId,
                'currency' => $currency,
                'amount' => $amount->amount(),
                'method' => $method->value,
                'reference' => $clean('reference'),
                'received_on' => $data['received_on'],
                'notes' => $clean('notes'),
                'created_by' => $actor->getAuthIdentifier(),
            ]);

            $this->payments->record($actor, $branchId, [
                new LedgerEntry(PaymentDirection::In, $method, $refund->amount, reference: $refund->reference, description: 'Supplier refund: '.$supplier['name']),
            ], new PaymentSource(PaymentSource::SUPPLIER_REFUND, $refund->id, $refund->number));

            $this->audit->record('supplier_refund.recorded', $refund, new: [
                'number' => $refund->number,
                'supplier_id' => $refund->supplier_id,
                'branch_id' => $branchId,
                'amount' => $refund->amount,
                'method' => $refund->method->value,
            ]);

            return $refund;
        });
    }
}
