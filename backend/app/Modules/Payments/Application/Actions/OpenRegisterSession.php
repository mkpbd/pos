<?php

namespace App\Modules\Payments\Application\Actions;

use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Payments\Domain\SessionStatus;
use App\Modules\Payments\Infrastructure\Models\CashRegister;
use App\Modules\Payments\Infrastructure\Models\RegisterSession;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\SequenceGenerator;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\ValueObjects\Money;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * Starts a shift: the cashier takes over a register with a counted cash float. A register
 * runs one session at a time and a cashier works one register at a time.
 */
class OpenRegisterSession
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly OrganizationDirectory $organizations,
        private readonly BranchDirectory $branches,
        private readonly SequenceGenerator $sequences,
        private readonly AuditTrail $audit,
    ) {}

    public function __invoke(TenantUser $actor, CashRegister $register, string $openingFloat): RegisterSession
    {
        if (! $actor->canAccessBranch($register->branch_id)) {
            throw new NotFoundHttpException;
        }
        $organizationId = $this->tenant->requireOrganization();
        $currency = $this->organizations->summary($organizationId)['base_currency'] ?? config('pos.default_currency');
        $float = Money::of($openingFloat, $currency);

        return DB::transaction(function () use ($actor, $register, $organizationId, $currency, $float) {
            /** @var CashRegister $locked */
            $locked = CashRegister::query()->whereKey($register->id)->lockForUpdate()->firstOrFail();
            if (! $locked->is_active || ! $this->branches->isActiveBranchOf($locked->branch_id, $organizationId)) {
                throw new BusinessRuleViolation('REGISTER_INACTIVE', "{$locked->name} is not active.");
            }

            $mine = RegisterSession::query()->where('opened_by', $actor->getAuthIdentifier())->where('status', SessionStatus::Open)->first();
            if ($mine !== null) {
                throw new BusinessRuleViolation('SESSION_ALREADY_OPEN', "You already have session {$mine->number} open; close it first.", ['session_id' => $mine->id]);
            }
            $running = RegisterSession::query()->where('cash_register_id', $locked->id)->where('status', SessionStatus::Open)->first();
            if ($running !== null) {
                throw new BusinessRuleViolation('REGISTER_IN_USE', "{$locked->name} is in use (session {$running->number}).", ['session_id' => $running->id]);
            }

            $branchCode = $this->branches->profile($locked->branch_id, $organizationId)['code'] ?? 'REG';
            $session = RegisterSession::query()->create([
                'organization_id' => $organizationId,
                'branch_id' => $locked->branch_id,
                'cash_register_id' => $locked->id,
                'number' => $this->sequences->next($organizationId, "register_session:{$locked->branch_id}", "SES-{$branchCode}-"),
                'status' => SessionStatus::Open,
                'currency' => $currency,
                'opening_float' => $float->amount(),
                'opened_by' => $actor->getAuthIdentifier(),
                'opened_at' => now(),
            ]);

            $this->audit->record('register_session.opened', $session, new: [
                'number' => $session->number,
                'register' => $locked->code,
                'opening_float' => $session->opening_float,
            ]);

            return $session;
        });
    }
}
