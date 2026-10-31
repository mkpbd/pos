<?php

namespace App\Modules\Authentication\Application\Actions;

use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Laravel\Sanctum\PersonalAccessToken;

/**
 * Logs out the current credential: the cookie session for the SPA, or the
 * presented token for devices.
 */
class EndSession
{
    public function __construct(
        private readonly Request $request,
        private readonly AuditTrail $audit,
    ) {}

    public function __invoke(User $user): void
    {
        $token = $user->currentAccessToken();

        if ($token instanceof PersonalAccessToken) {
            $token->delete();
        } else {
            Auth::guard('web')->logout();
            if ($this->request->hasSession()) {
                $this->request->session()->invalidate();
                $this->request->session()->regenerateToken();
            }
        }

        $this->audit->record('auth.logout', $user, context: ['channel' => $token instanceof PersonalAccessToken ? 'token' : 'session']);
    }
}
