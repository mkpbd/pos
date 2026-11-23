<?php

namespace App\Modules\Authentication\Application\Actions;

use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Users\Infrastructure\Models\User;
use Laravel\Sanctum\NewAccessToken;

/**
 * Personal access token for a device or integration. Abilities are not narrowed here:
 * authorization always goes through the user's current role permissions.
 */
class IssueDeviceToken
{
    public function __construct(private readonly AuditTrail $audit) {}

    /**
     * @param  'totp'|'recovery_code'|null  $twoFactor  the second factor used (G1a), if any
     */
    public function __invoke(User $user, string $deviceName, ?string $twoFactor = null): NewAccessToken
    {
        $token = $user->createToken($deviceName, ['*'], now()->addDays(config('pos.device_token_ttl_days')));

        $this->audit->record('auth.token_issued', $user, context: [
            'channel' => 'token',
            'token_id' => $token->accessToken->getKey(),
            'device_name' => $deviceName,
        ] + ($twoFactor !== null ? ['two_factor' => $twoFactor] : []));

        return $token;
    }
}
