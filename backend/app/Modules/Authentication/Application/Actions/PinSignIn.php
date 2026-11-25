<?php

namespace App\Modules\Authentication\Application\Actions;

use App\Modules\Authentication\Application\Contracts\TillDevices;
use App\Modules\Authentication\Application\Services\AccountLockout;
use App\Modules\Authentication\Application\Services\LoginAttempts;
use App\Modules\Authentication\Application\Services\PinCredentials;
use App\Modules\Authentication\Application\Services\TwoFactorPolicy;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

/**
 * POS1a: sign-in with a till PIN on a device set up as a till. The user must be one of the till's
 * users (its organization, `pos.sell`, the store's branch, a PIN). Once the PIN is right the user
 * is signed in exactly like a password sign-in (StartSession: login, regenerated session,
 * `auth.login` audit, login activity — channel `pin` with the till). Signing in while another
 * user is signed in on the device replaces that session (quick switch).
 *
 * Refusals: no till → TERMINAL_NOT_FOUND (404); another organization's user or a user who may
 * not sell at this till → 403; locked / inactive account or suspended organization → as the
 * password sign-in; two-factor sign-in on or required → PIN_NOT_ALLOWED; PIN_NOT_SET,
 * PIN_LOCKED, PIN_INVALID from the PIN check.
 */
class PinSignIn
{
    public function __construct(
        private readonly Request $request,
        private readonly TillDevices $devices,
        private readonly PinCredentials $pins,
        private readonly VerifyCredentials $verify,
        private readonly StartSession $startSession,
        private readonly AccountLockout $lockout,
        private readonly LoginAttempts $attempts,
        private readonly TwoFactorPolicy $twoFactor,
    ) {}

    public function __invoke(string $userId, string $pin): User
    {
        $terminal = $this->devices->fromRequest($this->request);
        if ($terminal === null) {
            throw self::terminalNotFound();
        }

        $user = User::query()->withoutGlobalScope('organization')
            ->where('organization_id', $terminal['organization_id'])
            ->find($userId);
        if ($user === null) {
            throw new AuthorizationException;
        }

        if ($user->isLocked()) {
            $this->record($user, $terminal, 'account_locked');

            throw $this->lockout->lockedError($user);
        }

        // Records account_inactive / organization_suspended like the password sign-in.
        $this->verify->assertCanSignIn($user, 'pin');

        if (! $user->hasPermission(TillDevices::SIGN_IN_PERMISSION) || ! $user->canAccessBranch($terminal['branch_id'])) {
            throw new AuthorizationException;
        }

        if ($user->hasTwoFactorEnabled() || $this->twoFactor->requiredFor($user)) {
            throw new BusinessRuleViolation('PIN_NOT_ALLOWED', 'Sign in with your password and code.');
        }

        try {
            $this->pins->check($user, $pin);
        } catch (BusinessRuleViolation $e) {
            if ($e->errorCode !== 'PIN_NOT_SET') {
                $this->record($user, $terminal, $e->errorCode === 'PIN_INVALID' ? 'invalid_pin' : 'pin_locked');
            }

            throw $e;
        }

        $this->replaceOtherSession($user);
        ($this->startSession)($user, false, null, ['channel' => 'pin', 'pos_terminal_id' => $terminal['id']]);
        $user->forceFill(['last_login_at' => now()])->saveQuietly();
        $this->record($user, $terminal, null);

        return $user;
    }

    public static function terminalNotFound(): BusinessRuleViolation
    {
        return new BusinessRuleViolation('TERMINAL_NOT_FOUND', 'This device is not set up as a till.', status: 404);
    }

    /**
     * Quick switch: another user's session data (and its CSRF token) is dropped before signing in.
     */
    private function replaceOtherSession(User $user): void
    {
        $current = Auth::guard('web')->id();
        if ($current === null || $current === $user->id || ! $this->request->hasSession()) {
            return;
        }

        $session = $this->request->session();
        $session->invalidate();
        $session->regenerateToken();
    }

    /**
     * @param  array{id: string}  $terminal
     */
    private function record(User $user, array $terminal, ?string $failureReason): void
    {
        $this->attempts->record($user->email, 'pin', $user, $failureReason, $terminal['id']);
    }
}
