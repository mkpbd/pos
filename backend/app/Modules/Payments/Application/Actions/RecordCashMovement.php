<?php

namespace App\Modules\Payments\Application\Actions;

use App\Modules\Payments\Application\Contracts\PaymentLedger;
use App\Modules\Payments\Domain\LedgerEntry;
use App\Modules\Payments\Domain\PaymentDirection;
use App\Modules\Payments\Domain\PaymentMethod;
use App\Modules\Payments\Domain\PaymentSource;
use App\Modules\Payments\Domain\SessionStatus;
use App\Modules\Payments\Infrastructure\Models\RegisterSession;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\ValueObjects\Money;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Cash put into (change, top-up) or taken out of (bank drop, safe) the cashier's own drawer
 * without a sale. Not income or expense: it only moves cash in or out of the till.
 */
class RecordCashMovement
{
    public function __construct(
        private readonly PaymentLedger $ledger,
        private readonly AuditTrail $audit,
    ) {}

    public function __invoke(TenantUser $actor, RegisterSession $session, PaymentDirection $direction, string $amount, string $reason): RegisterSession
    {
        if ($session->opened_by !== $actor->getAuthIdentifier()) {
            throw new NotFoundHttpException;
        }
        $money = Money::of($amount, $session->currency);
        if (! $money->isPositive()) {
            throw ValidationException::withMessages(['amount' => ['The amount must be greater than zero.']]);
        }

        return DB::transaction(function () use ($actor, $session, $direction, $money, $reason) {
            if (RegisterSession::query()->whereKey($session->id)->value('status') !== SessionStatus::Open) {
                throw new BusinessRuleViolation('SESSION_CLOSED', "Session {$session->number} is closed.");
            }

            $type = $direction === PaymentDirection::In ? 'cash_in' : 'cash_out';
            $this->ledger->record($actor, $session->branch_id, [
                new LedgerEntry($direction, PaymentMethod::Cash, $money->amount(), description: $reason),
            ], new PaymentSource($type, $session->id, $session->number));

            $this->audit->record("register_session.{$type}", $session, new: ['amount' => $money->amount(), 'reason' => $reason]);

            return $session;
        });
    }
}
