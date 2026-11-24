<?php

namespace App\Modules\Purchasing\Application\Actions;

use App\Modules\Payments\Application\Contracts\PaymentLedger;
use App\Modules\Payments\Domain\LedgerEntry;
use App\Modules\Payments\Domain\PaymentDirection;
use App\Modules\Payments\Domain\PaymentMethod as LedgerMethod;
use App\Modules\Payments\Domain\PaymentSource;
use App\Modules\Purchasing\Infrastructure\Models\SupplierPayment;
use App\Modules\Purchasing\Infrastructure\Models\SupplierRefund;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * ST1: cancels a supplier payment or refund recorded by mistake, the way VoidExpense does:
 * the row stays (marked void) and the opposite ledger entry is booked through the voiding
 * user's drawer in the document's branch — a voided cash payment puts the cash back into
 * the drawer, a voided cash refund takes it out again (INSUFFICIENT_CASH if the drawer is short).
 * Payments recorded before ST1 never reached the ledger, so their void books nothing there.
 * The supplier statement keeps the document and adds the void as its own line.
 */
class VoidSupplierMoney
{
    public function __construct(
        private readonly PaymentLedger $payments,
        private readonly AuditTrail $audit,
    ) {}

    public function payment(TenantUser $actor, SupplierPayment $payment, string $reason): SupplierPayment
    {
        $this->assertAccess($actor, $payment->branch_id);

        return DB::transaction(function () use ($actor, $payment, $reason) {
            /** @var SupplierPayment $locked */
            $locked = SupplierPayment::query()->whereKey($payment->id)->lockForUpdate()->firstOrFail();
            $this->reverse($actor, $locked, PaymentSource::SUPPLIER_PAYMENT, PaymentSource::SUPPLIER_PAYMENT_VOID, PaymentDirection::In, $reason);
            $this->audit->record('supplier_payment.voided', $locked, old: ['voided_at' => null], new: ['number' => $locked->number, 'amount' => $locked->amount, 'reason' => $reason]);

            return $locked;
        });
    }

    public function refund(TenantUser $actor, SupplierRefund $refund, string $reason): SupplierRefund
    {
        $this->assertAccess($actor, $refund->branch_id);

        return DB::transaction(function () use ($actor, $refund, $reason) {
            /** @var SupplierRefund $locked */
            $locked = SupplierRefund::query()->whereKey($refund->id)->lockForUpdate()->firstOrFail();
            $this->reverse($actor, $locked, PaymentSource::SUPPLIER_REFUND, PaymentSource::SUPPLIER_REFUND_VOID, PaymentDirection::Out, $reason);
            $this->audit->record('supplier_refund.voided', $locked, old: ['voided_at' => null], new: ['number' => $locked->number, 'amount' => $locked->amount, 'reason' => $reason]);

            return $locked;
        });
    }

    private function reverse(TenantUser $actor, SupplierPayment|SupplierRefund $document, string $sourceType, string $voidType, PaymentDirection $direction, string $reason): void
    {
        if ($document->voided_at !== null) {
            throw new BusinessRuleViolation('ALREADY_VOIDED', "{$document->number} is already void.");
        }

        if ($document->branch_id !== null && $this->payments->entriesOf($sourceType, $document->id) !== []) {
            $this->payments->record($actor, $document->branch_id, [
                new LedgerEntry($direction, LedgerMethod::from($document->method->value), $document->amount, reference: $document->reference, description: "Void: {$reason}"),
            ], new PaymentSource($voidType, $document->id, $document->number));
        }

        $document->update(['voided_at' => now(), 'voided_by' => $actor->getAuthIdentifier(), 'void_reason' => $reason]);
    }

    private function assertAccess(TenantUser $actor, ?string $branchId): void
    {
        // A payment from before ST1 may have no branch: it belongs to the whole organization.
        if ($branchId === null ? $actor->accessibleBranchIds() !== null : ! $actor->canAccessBranch($branchId)) {
            throw new NotFoundHttpException;
        }
    }
}
