<?php

namespace App\Modules\Purchasing\Application\Services;

use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Payments\Application\Contracts\PaymentLedger;
use App\Modules\Payments\Domain\PaymentMethod;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use Illuminate\Validation\ValidationException;

/**
 * ST1: the branch a supplier payment or refund is booked to in the payments ledger.
 *
 *  1. the `branch_id` the user gave (an active branch they may access);
 *  2. otherwise the branch of the user's open register session (the drawer cash goes through);
 *  3. otherwise, for non-cash methods only, the one active branch the user can access.
 *
 * Cash without an open session is refused like an expense (CASH_SESSION_REQUIRED); the ledger
 * itself then checks the session is in the booked branch and holds enough cash.
 */
class SupplierMoneyBranch
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly BranchDirectory $branches,
        private readonly PaymentLedger $payments,
    ) {}

    public function resolve(TenantUser $actor, ?string $branchId, PaymentMethod $method): string
    {
        $organizationId = $this->tenant->requireOrganization();
        if ($branchId !== null) {
            if (! $this->branches->isActiveBranchOf($branchId, $organizationId) || ! $actor->canAccessBranch($branchId)) {
                throw ValidationException::withMessages(['branch_id' => ['The selected branch does not exist.']]);
            }

            return $branchId;
        }

        $session = $this->payments->openSession($actor);
        if ($session !== null && $actor->canAccessBranch($session['branch_id'])) {
            return $session['branch_id'];
        }
        if ($method->isCash()) {
            throw new BusinessRuleViolation('CASH_SESSION_REQUIRED', 'Cash comes out of (or goes into) your cash drawer: open a register session (shift) first.', [
                'branch_id' => null,
                'open_session_id' => null,
            ]);
        }

        $active = array_values(array_filter(
            $this->branches->summaries($organizationId, $actor->accessibleBranchIds()),
            fn (array $b) => $b['is_active'],
        ));
        if (count($active) === 1) {
            return $active[0]['id'];
        }

        throw ValidationException::withMessages(['branch_id' => ['Choose the branch this money is booked to.']]);
    }
}
