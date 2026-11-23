<?php

namespace App\Modules\Authentication\Application\Actions;

use App\Modules\Authentication\Application\Services\TwoFactorAuthenticator;
use App\Modules\Authentication\Application\Services\TwoFactorPolicy;
use App\Modules\Authentication\Domain\TwoFactor\Totp;
use App\Modules\Authentication\Infrastructure\Notifications\TwoFactorChangedNotification;
use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

/**
 * G1a: a signed-in user's own two-factor sign-in — set up (password → secret + otpauth URI),
 * confirm with a first code (→ recovery codes, shown once), new recovery codes, turn off.
 * The secret and recovery codes appear only in the responses of setup / confirm / regenerate,
 * never in logs or the audit trail.
 */
class ManageTwoFactor
{
    public function __construct(
        private readonly Totp $totp,
        private readonly TwoFactorAuthenticator $twoFactor,
        private readonly TwoFactorPolicy $policy,
        private readonly OrganizationDirectory $organizations,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @return array{enabled: bool, confirmed_at: ?string, required: bool, recovery_codes_left: ?int, pending_setup: bool}
     */
    public function status(User $user): array
    {
        return [
            'enabled' => $user->hasTwoFactorEnabled(),
            'confirmed_at' => $user->hasTwoFactorEnabled() ? $user->two_factor_confirmed_at?->toIso8601String() : null,
            'required' => $this->policy->requiredFor($user),
            'recovery_codes_left' => $this->twoFactor->recoveryCodesLeft($user),
            'pending_setup' => ! $user->hasTwoFactorEnabled() && ($user->getAttributes()['two_factor_secret'] ?? null) !== null,
        ];
    }

    /**
     * A fresh, unconfirmed secret (replaces an earlier unconfirmed one).
     *
     * @return array{secret: string, otpauth_uri: string}
     */
    public function setup(User $user, string $password): array
    {
        $this->assertPassword($user, $password);
        if ($user->hasTwoFactorEnabled()) {
            throw new BusinessRuleViolation('TWO_FACTOR_ALREADY_ENABLED', 'Two-factor sign-in is already on.');
        }

        $secret = $this->totp->generateSecret();
        $user->forceFill([
            'two_factor_secret' => $secret,
            'two_factor_confirmed_at' => null,
            'two_factor_recovery_codes' => null,
            'two_factor_last_step' => null,
        ])->saveQuietly();

        return ['secret' => $secret, 'otpauth_uri' => $this->totp->uri($secret, $this->issuer($user), $user->email)];
    }

    /**
     * Turns two-factor sign-in on with the first code from the app.
     *
     * @return list<string> the recovery codes (plain, shown this once)
     */
    public function confirm(User $user, string $code): array
    {
        if ($user->hasTwoFactorEnabled()) {
            throw new BusinessRuleViolation('TWO_FACTOR_ALREADY_ENABLED', 'Two-factor sign-in is already on.');
        }
        if (($user->getAttributes()['two_factor_secret'] ?? null) === null) {
            throw new BusinessRuleViolation('TWO_FACTOR_NOT_STARTED', 'Start the two-factor setup first.');
        }
        if (! $this->twoFactor->verifyTotp($user, $code)) {
            throw SessionSignIn::invalidCode();
        }

        $recovery = $this->twoFactor->newRecoveryCodes();
        DB::transaction(function () use ($user, $recovery) {
            $user->forceFill([
                'two_factor_confirmed_at' => now(),
                'two_factor_recovery_codes' => $recovery['hashes'],
            ])->saveQuietly();
            $this->audit->record('auth.two_factor_enabled', $user);
        });
        $user->notify(new TwoFactorChangedNotification(TwoFactorChangedNotification::ENABLED));

        return $recovery['codes'];
    }

    /**
     * @return list<string> new recovery codes; the old ones stop working
     */
    public function regenerateRecoveryCodes(User $user, string $password): array
    {
        $this->assertPassword($user, $password);
        $this->assertEnabled($user);

        $recovery = $this->twoFactor->newRecoveryCodes();
        DB::transaction(function () use ($user, $recovery) {
            $user->forceFill(['two_factor_recovery_codes' => $recovery['hashes']])->saveQuietly();
            $this->audit->record('auth.recovery_codes_regenerated', $user);
        });

        return $recovery['codes'];
    }

    /**
     * Turns two-factor sign-in off — not while the organization requires it.
     *
     * @param  string  $code  a code from the app (6 digits) or a recovery code
     */
    public function disable(User $user, string $password, string $code): void
    {
        $this->assertEnabled($user);
        if ($this->policy->requiredFor($user)) {
            throw new BusinessRuleViolation('TWO_FACTOR_REQUIRED_BY_POLICY', 'Your organization requires two-factor sign-in, so it cannot be turned off.');
        }
        $this->assertPassword($user, $password);

        $code = trim($code);
        $valid = preg_match('/^\d{6}$/', $code) === 1
            ? $this->twoFactor->verifyTotp($user, $code)
            : $this->twoFactor->useRecoveryCode($user, $code);
        if (! $valid) {
            throw SessionSignIn::invalidCode();
        }

        DB::transaction(function () use ($user) {
            self::clear($user);
            $this->audit->record('auth.two_factor_disabled', $user);
        });
        $user->notify(new TwoFactorChangedNotification(TwoFactorChangedNotification::DISABLED));
    }

    /**
     * Removes every two-factor column of the user (turn off, administrator reset).
     */
    public static function clear(User $user): void
    {
        $user->forceFill([
            'two_factor_secret' => null,
            'two_factor_confirmed_at' => null,
            'two_factor_recovery_codes' => null,
            'two_factor_last_step' => null,
        ])->saveQuietly();
    }

    private function assertPassword(User $user, string $password): void
    {
        if (! Hash::check($password, $user->password)) {
            throw new BusinessRuleViolation('INVALID_PASSWORD', 'The password is incorrect.', ['password' => ['The password is incorrect.']]);
        }
    }

    private function assertEnabled(User $user): void
    {
        if (! $user->hasTwoFactorEnabled()) {
            throw new BusinessRuleViolation('TWO_FACTOR_NOT_ENABLED', 'Two-factor sign-in is not on.');
        }
    }

    private function issuer(User $user): string
    {
        $name = $user->organization_id !== null ? ($this->organizations->summary($user->organization_id)['name'] ?? null) : null;

        return (string) ($name ?: config('app.name'));
    }
}
