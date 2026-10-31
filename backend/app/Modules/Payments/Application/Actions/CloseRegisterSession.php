<?php

namespace App\Modules\Payments\Application\Actions;

use App\Modules\Payments\Application\Services\DrawerCash;
use App\Modules\Payments\Domain\SessionStatus;
use App\Modules\Payments\Infrastructure\Models\RegisterSession;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Shared\Domain\ValueObjects\Money;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Critical workflow #11: cash register closing. Compares the counted cash with what the
 * ledger says should be in the drawer and freezes the session with the variance.
 * The cashier closes their own session; `cash_registers.manage` can close anyone's.
 */
class CloseRegisterSession
{
    public function __construct(
        private readonly DrawerCash $drawer,
        private readonly AuditTrail $audit,
    ) {}

    public function __invoke(TenantUser $actor, RegisterSession $session, string $countedCash, ?string $notes): RegisterSession
    {
        $own = $session->opened_by === $actor->getAuthIdentifier();
        if (! $actor->canAccessBranch($session->branch_id) || (! $own && ! Gate::forUser($actor)->allows('cash_registers.manage'))) {
            throw new NotFoundHttpException;
        }
        $counted = Money::of($countedCash, $session->currency);

        return DB::transaction(function () use ($actor, $session, $counted, $notes) {
            /** @var RegisterSession $locked */
            $locked = RegisterSession::query()->whereKey($session->id)->lockForUpdate()->firstOrFail();
            if ($locked->status !== SessionStatus::Open) {
                throw new BusinessRuleViolation('SESSION_CLOSED', "Session {$locked->number} is already closed.");
            }

            $expected = $this->drawer->expected($locked);
            $locked->update([
                'status' => SessionStatus::Closed,
                'expected_cash' => $expected,
                'counted_cash' => $counted->amount(),
                'variance' => Decimal::sub($counted->amount(), $expected, 2),
                'closing_notes' => $notes,
                'closed_by' => $actor->getAuthIdentifier(),
                'closed_at' => now(),
            ]);

            $this->audit->record('register_session.closed', $locked, old: ['status' => SessionStatus::Open->value], new: [
                'status' => SessionStatus::Closed->value,
                'expected_cash' => $locked->expected_cash,
                'counted_cash' => $locked->counted_cash,
                'variance' => $locked->variance,
            ]);

            return $locked;
        });
    }
}
