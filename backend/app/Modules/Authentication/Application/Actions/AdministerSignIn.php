<?php

namespace App\Modules\Authentication\Application\Actions;

use App\Modules\Authentication\Application\Services\AccountLockout;
use App\Modules\Authentication\Infrastructure\Notifications\TwoFactorChangedNotification;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Users\Application\Services\PrivilegeEscalationGuard;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * G1a: an administrator's (users.manage) help with another user's sign-in — unlock a locked
 * account, reset two-factor sign-in after a lost phone. The target is bound inside the tenant
 * (other organizations' users are 404); platform administrators are never touched from an
 * organization.
 */
class AdministerSignIn
{
    public function __construct(
        private readonly AccountLockout $lockout,
        private readonly PrivilegeEscalationGuard $guard,
        private readonly AuditTrail $audit,
    ) {}

    public function unlock(User $user, User $actor): User
    {
        $this->assertManageable($user, $actor);

        $lockedUntil = $user->locked_until;
        $failed = (int) $user->failed_login_count;
        $this->lockout->clear($user);
        $this->audit->record('user.unlocked', $user, context: [
            'locked_until' => $lockedUntil?->toIso8601String(),
            'failed_login_count' => $failed,
        ]);

        return $user;
    }

    public function resetTwoFactor(User $user, User $actor): User
    {
        if ($user->is($actor)) {
            throw new BusinessRuleViolation('CANNOT_RESET_OWN_TWO_FACTOR', 'You cannot reset your own two-factor sign-in. Turn it off from your profile instead.');
        }
        $this->assertManageable($user, $actor);
        // Taking over a more powerful account by resetting its second factor is refused.
        $this->guard->assertCanManageUser($actor, $user);

        $wasEnabled = $user->hasTwoFactorEnabled();
        DB::transaction(function () use ($user, $wasEnabled) {
            ManageTwoFactor::clear($user);
            $this->audit->record('user.two_factor_reset', $user, context: ['was_enabled' => $wasEnabled]);
        });
        $user->notify(new TwoFactorChangedNotification(TwoFactorChangedNotification::RESET));

        return $user;
    }

    private function assertManageable(User $user, User $actor): void
    {
        if ($user->isPlatformAdmin() && ! $actor->isPlatformAdmin()) {
            throw new NotFoundHttpException;
        }
        if ($user->organization_id === null && $actor->organization_id !== null) {
            throw new NotFoundHttpException;
        }
    }
}
