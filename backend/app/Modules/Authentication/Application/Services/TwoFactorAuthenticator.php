<?php

namespace App\Modules\Authentication\Application\Services;

use App\Modules\Authentication\Domain\TwoFactor\RecoveryCodes;
use App\Modules\Authentication\Domain\TwoFactor\Totp;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Checks a second factor of a user with two-factor sign-in: an authenticator code (each time
 * step accepted once — replay protection) or an unused recovery code (removed once used).
 */
class TwoFactorAuthenticator
{
    public const TOTP = 'totp';

    public const RECOVERY_CODE = 'recovery_code';

    public function __construct(
        private readonly Totp $totp,
        private readonly RecoveryCodes $recoveryCodes,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @return self::TOTP|self::RECOVERY_CODE|null the method that succeeded, null when the code is wrong
     */
    public function verify(User $user, ?string $code, ?string $recoveryCode): ?string
    {
        if ($code !== null && $code !== '') {
            return $this->verifyTotp($user, $code) ? self::TOTP : null;
        }
        if ($recoveryCode !== null && $recoveryCode !== '') {
            return $this->useRecoveryCode($user, $recoveryCode) ? self::RECOVERY_CODE : null;
        }

        return null;
    }

    /**
     * A code that matches a time step later than the last accepted one; stores that step.
     */
    public function verifyTotp(User $user, string $code): bool
    {
        $secret = $user->two_factor_secret;
        if ($secret === null) {
            return false;
        }

        $step = $this->totp->verify($secret, trim($code), now()->getTimestamp());
        if ($step === null) {
            return false;
        }

        // Conditional update: two requests with the same code cannot both pass.
        $accepted = DB::table('users')
            ->where('id', $user->id)
            ->where(fn ($q) => $q->whereNull('two_factor_last_step')->orWhere('two_factor_last_step', '<', $step))
            ->update(['two_factor_last_step' => $step]) === 1;

        if ($accepted) {
            $user->forceFill(['two_factor_last_step' => $step])->syncOriginalAttribute('two_factor_last_step');
        }

        return $accepted;
    }

    public function useRecoveryCode(User $user, string $code): bool
    {
        $remaining = DB::transaction(function () use ($user, $code): ?int {
            /** @var User|null $locked */
            $locked = User::query()->withoutGlobalScopes()->lockForUpdate()->find($user->id);
            $hashes = array_values($locked?->two_factor_recovery_codes ?? []);
            $index = $this->recoveryCodes->match($code, $hashes, $this->key());
            if ($index === null) {
                return null;
            }

            array_splice($hashes, $index, 1);
            $locked->forceFill(['two_factor_recovery_codes' => $hashes])->saveQuietly();
            $user->forceFill(['two_factor_recovery_codes' => $hashes])->syncOriginalAttribute('two_factor_recovery_codes');

            return count($hashes);
        });

        if ($remaining === null) {
            return false;
        }

        $this->audit->record('auth.recovery_code_used', $user, context: ['remaining' => $remaining]);

        return true;
    }

    /**
     * Fresh recovery codes: returns the plain codes and the hashes to store.
     *
     * @return array{codes: list<string>, hashes: list<string>}
     */
    public function newRecoveryCodes(): array
    {
        $codes = $this->recoveryCodes->generate();

        return ['codes' => $codes, 'hashes' => array_map(fn (string $c) => $this->recoveryCodes->hash($c, $this->key()), $codes)];
    }

    public function recoveryCodesLeft(User $user): ?int
    {
        return $user->hasTwoFactorEnabled() ? count($user->two_factor_recovery_codes ?? []) : null;
    }

    /** Recovery codes are keyed with the application key (like the encrypted secret). */
    private function key(): string
    {
        return (string) config('app.key');
    }
}
