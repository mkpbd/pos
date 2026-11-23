<?php

namespace App\Modules\Authentication\Application\Services;

use App\Modules\Authentication\Infrastructure\Notifications\AccountLockedNotification;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * G1a account lockout. Every wrong password of an existing account and every wrong two-factor
 * code counts; after `pos.lockout.max_attempts` in a row the account is locked for
 * `pos.lockout.minutes` (audited, the user is e-mailed). A successful sign-in resets the count;
 * an e-mailed password reset or an administrator's unlock clears the lock.
 *
 * Unknown e-mail addresses are left to the per-IP `throttle:auth` limiter.
 */
class AccountLockout
{
    public function __construct(
        private readonly AuditTrail $audit,
        private readonly Request $request,
    ) {}

    public function secondsRemaining(User $user): int
    {
        return $user->isLocked() ? max(1, $user->locked_until->getTimestamp() - now()->getTimestamp()) : 0;
    }

    public function lockedError(User $user): BusinessRuleViolation
    {
        $seconds = $this->secondsRemaining($user);
        $minutes = max(1, (int) ceil($seconds / 60));

        return new BusinessRuleViolation(
            'ACCOUNT_LOCKED',
            'Too many failed sign-ins. Try again in '.$minutes.' '.($minutes === 1 ? 'minute' : 'minutes').' or ask your administrator.',
            ['retry_after_seconds' => $seconds],
        );
    }

    /**
     * Counts one failed sign-in. Returns true when this failure locked the account.
     */
    public function recordFailure(User $user): bool
    {
        $max = max(1, (int) config('pos.lockout.max_attempts'));
        $minutes = max(1, (int) config('pos.lockout.minutes'));

        // The row lock taken by the UPDATE serialises concurrent failures: exactly one of them
        // reaches the threshold and locks.
        $lockedUntil = DB::transaction(function () use ($user, $max, $minutes): ?Carbon {
            $count = (int) DB::selectOne(
                'UPDATE users SET failed_login_count = failed_login_count + 1 WHERE id = ? RETURNING failed_login_count',
                [$user->id],
            )->failed_login_count;

            if ($count < $max) {
                $this->sync($user, ['failed_login_count' => $count]);

                return null;
            }

            $until = now()->addMinutes($minutes);
            DB::table('users')->where('id', $user->id)->update(['locked_until' => $until, 'failed_login_count' => 0]);
            $this->sync($user, ['locked_until' => $until, 'failed_login_count' => 0]);

            return $until;
        });

        if ($lockedUntil === null) {
            return false;
        }

        $this->audit->record('auth.account_locked', $user, context: [
            'ip' => $this->request->ip(),
            'locked_until' => $lockedUntil->toIso8601String(),
            'failed_attempts' => $max,
        ]);
        $user->notify(new AccountLockedNotification($minutes));

        return true;
    }

    /**
     * After a successful sign-in: the failure count starts again from zero.
     */
    public function reset(User $user): void
    {
        if ((int) $user->failed_login_count === 0 && $user->locked_until === null) {
            return;
        }

        DB::table('users')->where('id', $user->id)->update(['failed_login_count' => 0, 'locked_until' => null]);
        $this->sync($user, ['failed_login_count' => 0, 'locked_until' => null]);
    }

    /**
     * Password reset by e-mail or an administrator's unlock. Returns whether the account was locked.
     */
    public function clear(User $user): bool
    {
        $wasLocked = $user->isLocked();
        $this->reset($user);

        return $wasLocked;
    }

    /**
     * @param  array<string, mixed>  $attributes  already written to the table
     */
    private function sync(User $user, array $attributes): void
    {
        $user->forceFill($attributes)->syncOriginalAttributes(array_keys($attributes));
    }
}
