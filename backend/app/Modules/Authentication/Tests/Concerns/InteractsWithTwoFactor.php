<?php

namespace App\Modules\Authentication\Tests\Concerns;

use App\Modules\Authentication\Application\Services\TwoFactorAuthenticator;
use App\Modules\Authentication\Domain\TwoFactor\Totp;
use App\Modules\Organizations\Infrastructure\Models\Organization;
use App\Modules\Users\Infrastructure\Models\User;

/**
 * Turns two-factor sign-in on for a user directly and computes authenticator codes.
 */
trait InteractsWithTwoFactor
{
    /**
     * @return array{secret: string, recovery_codes: list<string>}
     */
    protected function enableTwoFactor(User $user): array
    {
        $secret = app(Totp::class)->generateSecret();
        $recovery = app(TwoFactorAuthenticator::class)->newRecoveryCodes();
        $user->forceFill([
            'two_factor_secret' => $secret,
            'two_factor_confirmed_at' => now(),
            'two_factor_recovery_codes' => $recovery['hashes'],
            'two_factor_last_step' => null,
        ])->saveQuietly();

        return ['secret' => $secret, 'recovery_codes' => $recovery['codes']];
    }

    /** The authenticator app's code right now. */
    protected function totpCode(string $secret, int $offsetSeconds = 0): string
    {
        return app(Totp::class)->at($secret, now()->getTimestamp() + $offsetSeconds);
    }

    /** A well-formed code that is not valid now (from ten minutes ago). */
    protected function wrongTotpCode(string $secret): string
    {
        $code = $this->totpCode($secret, -600);
        $valid = [$this->totpCode($secret, -30), $this->totpCode($secret), $this->totpCode($secret, 30)];

        return in_array($code, $valid, true) ? $this->totpCode($secret, -900) : $code;
    }

    protected function setTwoFactorPolicy(Organization $organization, string $policy): void
    {
        $organization->forceFill(['settings' => ['two_factor_policy' => $policy] + ($organization->fresh()->settings ?? [])])->save();
    }
}
