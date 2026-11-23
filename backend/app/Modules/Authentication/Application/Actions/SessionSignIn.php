<?php

namespace App\Modules\Authentication\Application\Actions;

use App\Modules\Authentication\Application\Services\AccountLockout;
use App\Modules\Authentication\Application\Services\LoginAttempts;
use App\Modules\Authentication\Application\Services\TwoFactorAuthenticator;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Contracts\Session\Session;
use Illuminate\Http\Request;

/**
 * Web app sign-in (cookie session). G1a: a user with two-factor sign-in is not logged in by the
 * password alone — a pending challenge (user, remember, 5-minute expiry, attempt count) is kept
 * in the session and completed by challenge() with an authenticator or recovery code.
 */
class SessionSignIn
{
    public const CHALLENGE_KEY = 'auth.two_factor';

    public const CHALLENGE_MINUTES = 5;

    public const MAX_CHALLENGE_ATTEMPTS = 5;

    public function __construct(
        private readonly Request $request,
        private readonly VerifyCredentials $verify,
        private readonly StartSession $startSession,
        private readonly TwoFactorAuthenticator $twoFactor,
        private readonly AccountLockout $lockout,
        private readonly LoginAttempts $attempts,
    ) {}

    /**
     * @return User|null the signed-in user, or null when a two-factor challenge is now pending
     */
    public function attempt(string $email, string $password, bool $remember): ?User
    {
        $user = ($this->verify)($email, $password, 'session');

        if (! $user->hasTwoFactorEnabled()) {
            ($this->startSession)($user, $remember);
            $this->verify->succeeded($user, 'session');

            return $user;
        }

        $session = $this->session();
        $session->put(self::CHALLENGE_KEY, [
            'user_id' => $user->id,
            'remember' => $remember,
            'expires_at' => now()->addMinutes(self::CHALLENGE_MINUTES)->getTimestamp(),
            'attempts' => 0,
        ]);
        $session->migrate(true);

        return null;
    }

    /**
     * Completes a pending challenge with exactly one of an authenticator code or a recovery code.
     */
    public function challenge(?string $code, ?string $recoveryCode): User
    {
        $session = $this->session();
        $pending = $session->get(self::CHALLENGE_KEY);

        if (! is_array($pending) || (int) ($pending['expires_at'] ?? 0) < now()->getTimestamp()) {
            $session->forget(self::CHALLENGE_KEY);

            throw $this->expired();
        }

        $user = User::query()->withoutGlobalScope('organization')->find($pending['user_id'] ?? null);
        if ($user === null || ! $user->hasTwoFactorEnabled()) {
            $session->forget(self::CHALLENGE_KEY);

            throw $this->expired();
        }

        if ($user->isLocked()) {
            $session->forget(self::CHALLENGE_KEY);
            $this->attempts->record($user->email, 'session', $user, 'account_locked');

            throw $this->lockout->lockedError($user);
        }

        $this->verify->assertCanSignIn($user, 'session');

        $method = $this->twoFactor->verify($user, $code, $recoveryCode);
        if ($method === null) {
            $pending['attempts'] = (int) ($pending['attempts'] ?? 0) + 1;
            $locked = $this->lockout->recordFailure($user);
            $this->attempts->record($user->email, 'session', $user, 'invalid_two_factor');

            if ($locked || $pending['attempts'] >= self::MAX_CHALLENGE_ATTEMPTS) {
                $session->forget(self::CHALLENGE_KEY);
            } else {
                $session->put(self::CHALLENGE_KEY, $pending);
            }

            throw self::invalidCode();
        }

        $session->forget(self::CHALLENGE_KEY);
        ($this->startSession)($user, (bool) ($pending['remember'] ?? false), $method);
        $this->verify->succeeded($user, 'session');

        return $user;
    }

    public static function invalidCode(): BusinessRuleViolation
    {
        return new BusinessRuleViolation('INVALID_TWO_FACTOR_CODE', 'That code is not valid. Check your authenticator app and try again.');
    }

    private function expired(): BusinessRuleViolation
    {
        return new BusinessRuleViolation('TWO_FACTOR_CHALLENGE_EXPIRED', 'Sign in again.');
    }

    private function session(): Session
    {
        if (! $this->request->hasSession()) {
            throw new BusinessRuleViolation(
                'SESSION_UNAVAILABLE',
                'Session login is only available to the web app. Devices must request a token from /auth/tokens.',
            );
        }

        return $this->request->session();
    }
}
