<?php

namespace App\Modules\Expenses\Application\Actions;

use App\Modules\Expenses\Infrastructure\Models\Expense;
use App\Modules\Payments\Application\Contracts\PaymentLedger;
use App\Modules\Payments\Domain\LedgerEntry;
use App\Modules\Payments\Domain\PaymentDirection;
use App\Modules\Payments\Domain\PaymentSource;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Cancels an entry recorded by mistake: the entry stays (marked void) and an opposite
 * payment is booked, so the ledger and the drawer show both.
 */
class VoidExpense
{
    public function __construct(
        private readonly PaymentLedger $payments,
        private readonly AuditTrail $audit,
    ) {}

    public function __invoke(TenantUser $actor, Expense $expense, string $reason): Expense
    {
        if (! $actor->canAccessBranch($expense->branch_id)) {
            throw new NotFoundHttpException;
        }

        return DB::transaction(function () use ($actor, $expense, $reason) {
            /** @var Expense $locked */
            $locked = Expense::query()->whereKey($expense->id)->lockForUpdate()->firstOrFail();
            if ($locked->voided_at !== null) {
                throw new BusinessRuleViolation('ALREADY_VOIDED', "{$locked->number} is already void.");
            }
            if ($locked->on_account) {
                // SC3: owed to a supplier and booked by its document (a landed cost voucher).
                throw new BusinessRuleViolation('EXPENSE_ON_ACCOUNT', "{$locked->number} was booked on a supplier's account by {$locked->reference} and cannot be voided on its own.");
            }

            $reverse = $locked->type->direction() === PaymentDirection::Out ? PaymentDirection::In : PaymentDirection::Out;
            $this->payments->record($actor, $locked->branch_id, [
                new LedgerEntry($reverse, $locked->method, $locked->amount, reference: $locked->reference, description: "Void: {$reason}"),
            ], new PaymentSource("{$locked->type->value}_void", $locked->id, $locked->number));

            $locked->update(['voided_at' => now(), 'voided_by' => $actor->getAuthIdentifier(), 'void_reason' => $reason]);
            $this->audit->record("{$locked->type->value}.voided", $locked, old: ['voided_at' => null], new: ['number' => $locked->number, 'reason' => $reason]);

            return $locked;
        });
    }
}
