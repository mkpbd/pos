<?php

namespace App\Modules\Authentication\Application\Actions;

use App\Modules\Authentication\Application\Services\AccountLockout;
use App\Modules\Authentication\Application\Services\LoginAttempts;
use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Support\Facades\Hash;

/**
 * Checks e-mail/password and account state, recording every failed attempt in login_activities.
 * Unknown e-mail and wrong password produce the same error to prevent account enumeration.
 *
 * G1a: a locked account is refused before its password is looked at (no password oracle while
 * locked; the same hashing time is spent). A wrong password of an existing account counts toward
 * the lockout. The successful outcome is recorded by succeeded() once every factor has passed.
 */
class VerifyCredentials
{
    /** bcrypt of a throwaway string; only used to spend comparable time on unknown e-mails. */
    private const DUMMY_HASH = '$2y$12$nEMAsT1z.Uzq4hsFslcwU.Cn6F.UHYDeJSi3pFxfCmCCgwggzpH/m';

    public function __construct(
        private readonly OrganizationDirectory $organizations,
        private readonly AccountLockout $lockout,
        private readonly LoginAttempts $attempts,
    ) {}

    /**
     * @param  'session'|'token'  $channel
     */
    public function __invoke(string $email, string $password, string $channel): User
    {
        $email = mb_strtolower(trim($email));
        $user = User::query()->withoutGlobalScope('organization')->where('email', $email)->first();

        if ($user !== null && $user->isLocked()) {
            Hash::check($password, self::DUMMY_HASH);
            $this->attempts->record($email, $channel, $user, 'account_locked');

            throw $this->lockout->lockedError($user);
        }

        if ($user === null || ! Hash::check($password, $user->password)) {
            if ($user === null) {
                // Equalise timing between unknown e-mail and wrong password.
                Hash::check($password, self::DUMMY_HASH);
            } else {
                $this->lockout->recordFailure($user);
            }
            $this->attempts->record($email, $channel, $user, 'invalid_credentials');

            throw new BusinessRuleViolation('INVALID_CREDENTIALS', 'These credentials do not match our records.');
        }

        $this->assertCanSignIn($user, $channel);

        if (Hash::needsRehash($user->password)) {
            $user->forceFill(['password' => $password])->save();
        }

        return $user;
    }

    /**
     * The account and its organization are active (also re-checked at the two-factor step and,
     * POS1a, at a PIN sign-in).
     *
     * @param  'session'|'token'|'pin'  $channel
     */
    public function assertCanSignIn(User $user, string $channel): void
    {
        if (! $user->isActive()) {
            $this->attempts->record($user->email, $channel, $user, 'account_inactive');

            throw new BusinessRuleViolation('ACCOUNT_INACTIVE', 'Your account has been deactivated. Contact your administrator.');
        }

        if ($user->organization_id !== null && ! $this->organizations->isActive($user->organization_id)) {
            $this->attempts->record($user->email, $channel, $user, 'organization_suspended');

            throw new BusinessRuleViolation('ORGANIZATION_SUSPENDED', 'Your organization is suspended. Contact support.');
        }
    }

    /**
     * Every factor passed: reset the lockout count, stamp last_login_at, record the success.
     *
     * @param  'session'|'token'  $channel
     */
    public function succeeded(User $user, string $channel): void
    {
        $this->lockout->reset($user);
        $user->forceFill(['last_login_at' => now()])->saveQuietly();
        $this->attempts->record($user->email, $channel, $user, null);
    }
}
