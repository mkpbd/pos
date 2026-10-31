<?php

namespace App\Modules\Authentication\Application\Actions;

use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\PersonalAccessToken;

/**
 * Self-service password change. Signs out every other session and token,
 * keeping only the credential used for this request.
 */
class ChangePassword
{
    public function __construct(private readonly AuditTrail $audit) {}

    public function __invoke(User $user, string $newPassword, ?string $currentSessionId): void
    {
        DB::transaction(function () use ($user, $newPassword, $currentSessionId) {
            $user->forceFill(['password' => $newPassword])->save();

            $current = $user->currentAccessToken();
            $user->tokens()
                ->when($current instanceof PersonalAccessToken, fn ($q) => $q->whereKeyNot($current->getKey()))
                ->delete();

            DB::table('sessions')
                ->where('user_id', $user->id)
                ->when($currentSessionId !== null, fn ($q) => $q->where('id', '!=', $currentSessionId))
                ->delete();

            $this->audit->record('auth.password_changed', $user);
        });
    }
}
