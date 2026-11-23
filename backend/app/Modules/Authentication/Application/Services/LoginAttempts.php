<?php

namespace App\Modules\Authentication\Application\Services;

use App\Modules\Authentication\Infrastructure\Models\LoginActivity;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Http\Request;

/**
 * Writes one row of the sign-in history (login_activities) per attempt outcome.
 *
 * Failure reasons: invalid_credentials, account_inactive, organization_suspended,
 * invalid_two_factor (G1a), account_locked (G1a).
 */
class LoginAttempts
{
    public function __construct(private readonly Request $request) {}

    /**
     * @param  'session'|'token'  $channel
     */
    public function record(string $email, string $channel, ?User $user, ?string $failureReason): void
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
            'created_at' => now(),
        ]);
    }
}
