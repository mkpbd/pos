<?php

namespace App\Modules\Authentication\Application\Actions;

use App\Modules\Authentication\Application\Services\AccountLockout;
use App\Modules\Authentication\Application\Services\LoginAttempts;
use App\Modules\Authentication\Application\Services\TwoFactorAuthenticator;
use App\Modules\Authentication\Application\Services\TwoFactorPolicy;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use Laravel\Sanctum\NewAccessToken;

/**
 * Device / integration sign-in (personal access token). G1a: a user with two-factor sign-in
 * sends `code` or `recovery_code` with the password; a user the organization requires it from
 * who has not set it up gets no token until they do (in the web app).
 */
class DeviceSignIn
{
    public function __construct(
        private readonly VerifyCredentials $verify,
        private readonly IssueDeviceToken $issue,
        private readonly TwoFactorAuthenticator $twoFactor,
        private readonly TwoFactorPolicy $policy,
        private readonly AccountLockout $lockout,
        private readonly LoginAttempts $attempts,
    ) {}

    public function __invoke(string $email, string $password, string $deviceName, ?string $code, ?string $recoveryCode): NewAccessToken
    {
        $user = ($this->verify)($email, $password, 'token');
        $method = null;

        if ($user->hasTwoFactorEnabled()) {
            if (($code ?? '') === '' && ($recoveryCode ?? '') === '') {
                throw new BusinessRuleViolation('TWO_FACTOR_REQUIRED', 'Enter the code from your authenticator app.', [
                    'code' => ['Enter the 6-digit code from your authenticator app, or a recovery code.'],
                ]);
            }

            $method = $this->twoFactor->verify($user, $code, $recoveryCode);
            if ($method === null) {
                $this->lockout->recordFailure($user);
                $this->attempts->record($user->email, 'token', $user, 'invalid_two_factor');

                throw SessionSignIn::invalidCode();
            }
        } elseif ($this->policy->requiredFor($user)) {
            throw new BusinessRuleViolation('TWO_FACTOR_SETUP_REQUIRED', 'Set up two-factor sign-in in the web app first.', status: 403);
        }

        $this->verify->succeeded($user, 'token');

        return ($this->issue)($user, $deviceName, $method);
    }
}
