<?php

namespace App\Modules\Authentication\Application\Services;

use App\Modules\Authentication\Application\Contracts\TillPins;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Users\Domain\Enums\UserStatus;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

/**
 * POS1a: checks till PINs with their own lockout — 5 wrong PINs in a row lock the PIN for
 * 15 minutes (the password lockout of G1a is separate). The check runs with the user row locked,
 * so parallel guesses cannot get past the limit. The PIN is never logged or audited.
 */
class PinCredentials implements TillPins
{
    public const MAX_ATTEMPTS = 5;

    public const LOCK_MINUTES = 15;

    public function __construct(private readonly AuditTrail $audit) {}

    /**
     * @throws BusinessRuleViolation PIN_NOT_SET, PIN_LOCKED, PIN_INVALID
     */
    public function check(User $user, string $pin): void
    {
        $outcome = DB::transaction(function () use ($user, $pin): array {
            $row = DB::table('users')->where('id', $user->id)->lockForUpdate()
                ->first(['pin_hash', 'pin_failed_count', 'pin_locked_until']);

            if ($row === null || $row->pin_hash === null) {
                return ['not_set'];
            }

            $lockedUntil = $row->pin_locked_until !== null ? Carbon::parse($row->pin_locked_until) : null;
            if ($lockedUntil !== null && $lockedUntil->isFuture()) {
                return ['locked', $lockedUntil];
            }

            if (Hash::check($pin, $row->pin_hash)) {
                if ((int) $row->pin_failed_count !== 0 || $lockedUntil !== null) {
                    $this->write($user, ['pin_failed_count' => 0, 'pin_locked_until' => null]);
                }

                return ['ok'];
            }

            $count = (int) $row->pin_failed_count + 1;
            if ($count >= self::MAX_ATTEMPTS) {
                $until = now()->addMinutes(self::LOCK_MINUTES);
                $this->write($user, ['pin_failed_count' => 0, 'pin_locked_until' => $until]);

                return ['locked_now', $until];
            }

            $this->write($user, ['pin_failed_count' => $count]);

            return ['invalid', self::MAX_ATTEMPTS - $count];
        });

        match ($outcome[0]) {
            'ok' => null,
            'not_set' => throw self::notSet(),
            'locked' => throw self::locked($outcome[1]),
            'locked_now' => $this->lockedNow($user, $outcome[1]),
            default => throw new BusinessRuleViolation(
                'PIN_INVALID',
                'Wrong PIN. '.$outcome[1].' '.($outcome[1] === 1 ? 'try' : 'tries').' left.',
                ['attempts_left' => $outcome[1]],
            ),
        };
    }

    public function candidates(string $organizationId, string $branchId, string $permission, ?string $exceptUserId = null): array
    {
        return $this->eligible($organizationId, $permission)
            ->whereNotNull('pin_hash')
            ->when($exceptUserId !== null, fn (Builder $q) => $q->whereKeyNot($exceptUserId))
            ->with('branchMemberships')
            ->orderBy('name')
            ->orderBy('id')
            ->get(['id', 'name', 'organization_id', 'is_platform_admin'])
            ->filter(fn (User $user) => $user->canAccessBranch($branchId))
            ->map(fn (User $user) => ['id' => $user->id, 'name' => $user->name])
            ->values()
            ->all();
    }

    public function mayAct(string $organizationId, string $userId, string $branchId, string $permission): bool
    {
        $user = $this->eligible($organizationId, $permission)->whereKey($userId)->first();

        return $user !== null && $user->canAccessBranch($branchId);
    }

    public function verify(string $organizationId, string $userId, string $pin): array
    {
        $user = User::query()->withoutGlobalScope('organization')
            ->where('organization_id', $organizationId)
            ->where('status', UserStatus::Active->value)
            ->findOrFail($userId);

        $this->check($user, $pin);

        return ['id' => $user->id, 'name' => $user->name];
    }

    public static function notSet(): BusinessRuleViolation
    {
        return new BusinessRuleViolation('PIN_NOT_SET', 'No till PIN is set for this user. Set one on the profile page.');
    }

    public static function locked(Carbon $until): BusinessRuleViolation
    {
        $seconds = max(1, $until->getTimestamp() - now()->getTimestamp());
        $minutes = max(1, (int) ceil($seconds / 60));

        return new BusinessRuleViolation(
            'PIN_LOCKED',
            'Too many wrong PINs. Try again in '.$minutes.' '.($minutes === 1 ? 'minute' : 'minutes').'.',
            ['retry_after' => $seconds],
            423,
        );
    }

    /**
     * Active users of the organization holding the permission, not locked out of signing in.
     *
     * @return Builder<User>
     */
    private function eligible(string $organizationId, string $permission): Builder
    {
        return User::query()->withoutGlobalScope('organization')
            ->where('organization_id', $organizationId)
            ->where('status', UserStatus::Active->value)
            ->where(fn (Builder $q) => $q->whereNull('locked_until')->orWhere('locked_until', '<=', now()))
            ->whereHas('roles.permissions', fn (Builder $q) => $q->where('name', $permission));
    }

    private function lockedNow(User $user, Carbon $until): never
    {
        $this->audit->record('auth.pin_locked', $user, context: [
            'locked_until' => $until->toIso8601String(),
            'failed_attempts' => self::MAX_ATTEMPTS,
        ]);

        throw self::locked($until);
    }

    /**
     * @param  array<string, mixed>  $attributes
     */
    private function write(User $user, array $attributes): void
    {
        DB::table('users')->where('id', $user->id)->update($attributes);
        $user->forceFill($attributes)->syncOriginalAttributes(array_keys($attributes));
    }
}
