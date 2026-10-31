<?php

namespace App\Modules\Authentication\Application\Actions;

use App\Modules\Authentication\Infrastructure\Models\LoginActivity;
use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;

/**
 * Checks e-mail/password and account state, recording every attempt in login_activities.
 * Unknown e-mail and wrong password produce the same error to prevent account enumeration.
 */
class VerifyCredentials
{
    /** bcrypt of a throwaway string; only used to spend comparable time on unknown e-mails. */
    private const DUMMY_HASH = '$2y$12$nEMAsT1z.Uzq4hsFslcwU.Cn6F.UHYDeJSi3pFxfCmCCgwggzpH/m';

    public function __construct(
        private readonly Request $request,
        private readonly OrganizationDirectory $organizations,
    ) {}

    /**
     * @param  'session'|'token'  $channel
     */
    public function __invoke(string $email, string $password, string $channel): User
    {
        $email = mb_strtolower(trim($email));
        $user = User::query()->withoutGlobalScope('organization')->where('email', $email)->first();

        if ($user === null || ! Hash::check($password, $user->password)) {
            if ($user === null) {
                // Equalise timing between unknown e-mail and wrong password.
                Hash::check($password, self::DUMMY_HASH);
            }
            $this->record($email, $channel, $user, 'invalid_credentials');

            throw new BusinessRuleViolation('INVALID_CREDENTIALS', 'These credentials do not match our records.');
        }

        if (! $user->isActive()) {
            $this->record($email, $channel, $user, 'account_inactive');

            throw new BusinessRuleViolation('ACCOUNT_INACTIVE', 'Your account has been deactivated. Contact your administrator.');
        }

        if ($user->organization_id !== null) {
            if (! $this->organizations->isActive($user->organization_id)) {
                $this->record($email, $channel, $user, 'organization_suspended');

                throw new BusinessRuleViolation('ORGANIZATION_SUSPENDED', 'Your organization is suspended. Contact support.');
            }
        }

        if (Hash::needsRehash($user->password)) {
            $user->forceFill(['password' => $password])->save();
        }

        $user->forceFill(['last_login_at' => now()])->saveQuietly();
        $this->record($email, $channel, $user, null);

        return $user;
    }

    private function record(string $email, string $channel, ?User $user, ?string $failureReason): void
    {
        LoginActivity::query()->create([
            'organization_id' => $user?->organization_id,
            'user_id' => $user?->id,
            'email' => mb_substr($email, 0, 255),
            'channel' => $channel,
            'succeeded' => $failureReason === null,
            'failure_reason' => $failureReason,
            'ip_address' => $this->request->ip(),
            'user_agent' => mb_substr((string) $this->request->userAgent(), 0, 1000),
            'created_at' => now(),
        ]);
    }
}
