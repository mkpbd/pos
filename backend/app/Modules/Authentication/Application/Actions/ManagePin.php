<?php

namespace App\Modules\Authentication\Application\Actions;

use App\Modules\Authentication\Domain\Pin\PinRules;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

/**
 * POS1a: a user's till PIN — set or change it, remove it (both from the profile, after the
 * current password), or clear it as an administrator (users.manage) when it was forgotten or
 * shared. Setting or clearing a PIN also ends its lockout. The PIN is never audited.
 */
class ManagePin
{
    public function __construct(private readonly AuditTrail $audit) {}

    /**
     * @throws ValidationException `pin` when it breaks the PIN rules
     */
    public function set(User $user, string $pin): void
    {
        if (($problem = PinRules::violation($pin)) !== null) {
            throw ValidationException::withMessages(['pin' => [$problem]]);
        }

        $changed = $user->hasPin();
        DB::transaction(function () use ($user, $pin, $changed) {
            $user->forceFill(['pin_hash' => Hash::make($pin), 'pin_set_at' => now()])->save();
            $this->endLockout($user);
            $this->audit->record('user.pin_set', $user, context: ['changed' => $changed]);
        });
    }

    public function remove(User $user): void
    {

        DB::transaction(function () use ($user) {
            $this->clear($user);
            $this->audit->record('user.pin_removed', $user);
        });
    }

    /**
     * An administrator clears another user's PIN (the user sets a new one). The target is bound
     * inside the tenant; platform administrators are never touched from an organization.
     */
    public function clearByAdministrator(User $user, User $actor): void
    {
        if (($user->isPlatformAdmin() || $user->organization_id === null) && ! $actor->isPlatformAdmin()) {
            throw new NotFoundHttpException;
        }

        $hadPin = $user->hasPin();
        DB::transaction(function () use ($user, $hadPin) {
            $this->clear($user);
            $this->audit->record('user.pin_cleared', $user, context: ['had_pin' => $hadPin]);
        });
    }

    private function clear(User $user): void
    {
        $user->forceFill(['pin_hash' => null, 'pin_set_at' => null])->save();
        $this->endLockout($user);
    }

    /**
     * The PIN counters are written directly (the PIN check updates them outside Eloquent, so the
     * model may not know their current values).
     */
    private function endLockout(User $user): void
    {
        $attributes = ['pin_failed_count' => 0, 'pin_locked_until' => null];
        DB::table('users')->where('id', $user->id)->update($attributes);
        $user->forceFill($attributes)->syncOriginalAttributes(array_keys($attributes));
    }
}
