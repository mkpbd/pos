<?php

namespace App\Modules\Authentication\Application\Actions;

use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

/**
 * Logs a verified user into the SPA's cookie session (Sanctum stateful auth).
 */
class StartSession
{
    public function __construct(
        private readonly Request $request,
        private readonly AuditTrail $audit,
    ) {}

    /**
     * @param  'totp'|'recovery_code'|null  $twoFactor  the second factor used (G1a), if any
     * @param  array<string, mixed>  $context  POS1a: audit context of other sign-in methods (`channel` pin, the till)
     */
    public function __invoke(User $user, bool $remember = false, ?string $twoFactor = null, array $context = []): void
    {
        if (! $this->request->hasSession()) {
            throw new BusinessRuleViolation(
                'SESSION_UNAVAILABLE',
                'Session login is only available to the web app. Devices must request a token from /auth/tokens.',
            );
        }

        Auth::guard('web')->login($user, $remember);
        $this->request->session()->regenerate();

        $this->audit->record('auth.login', $user, context: $context + ['channel' => 'session'] + ($twoFactor !== null ? ['two_factor' => $twoFactor] : []));
    }
}
