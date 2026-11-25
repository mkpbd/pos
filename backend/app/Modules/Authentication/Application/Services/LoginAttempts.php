<?php

namespace App\Modules\Authentication\Application\Services;

use App\Modules\Authentication\Infrastructure\Models\LoginActivity;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Http\Request;

/**
 * Writes one row of the sign-in history (login_activities) per attempt outcome.
 *
 * Failure reasons: invalid_credentials, account_inactive, organization_suspended,
 * invalid_two_factor (G1a), account_locked (G1a), invalid_pin and pin_locked (POS1a: channel
 * `pin`, a sign-in with a till PIN, with the till it happened at).
 */
class LoginAttempts
{
    public function __construct(private readonly Request $request) {}

    /**
     * @param  'session'|'token'|'pin'  $channel
     */
    public function record(string $email, string $channel, ?User $user, ?string $failureReason, ?string $posTerminalId = null): void
    {
        LoginActivity::query()->create([
            'organization_id' => $user?->organization_id,
            'user_id' => $user?->id,
            'email' => mb_substr(mb_strtolower(trim($email)), 0, 255),
            'channel' => $channel,
            'succeeded' => $failureReason === null,
            'failure_reason' => $failureReason,
            'ip_address' => $this->request->ip(),
            'user_agent' => mb_substr((string) $this->request->userAgent(), 0, 1000),
            'pos_terminal_id' => $posTerminalId,
            'created_at' => now(),
        ]);
    }
}
