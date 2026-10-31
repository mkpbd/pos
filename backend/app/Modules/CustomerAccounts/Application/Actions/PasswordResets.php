<?php

namespace App\Modules\CustomerAccounts\Application\Actions;

use App\Modules\CustomerAccounts\Infrastructure\Models\CustomerAccount;
use App\Modules\CustomerAccounts\Infrastructure\Notifications\ResetCustomerPassword;
use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Forgotten passwords of store accounts. One live token per e-mail and organization (sha256
 * stored, valid VALID_MINUTES); answers never reveal whether an account exists.
 *
 * Note: a reset does not end the account's other sessions (Laravel's logoutOtherDevices
 * needs the old password); it rotates the remember-me token, so "remember me" cookies of
 * other browsers stop working.
 */
class PasswordResets
{
    public const VALID_MINUTES = 60;

    /** At most one e-mail per address in this window. */
    public const RESEND_AFTER_SECONDS = 60;

    public function __construct(
        private readonly TenantContext $tenant,
        private readonly OrganizationDirectory $organizations,
    ) {}

    public function request(string $email, string $siteUrl): void
    {
        $organizationId = $this->tenant->requireOrganization();
        $email = mb_strtolower(trim($email));

        /** @var CustomerAccount|null $account */
        $account = CustomerAccount::query()->whereRaw('lower(email) = ?', [$email])->first();
        if ($account === null || ! $account->isActive()) {
            return;
        }

        $token = DB::transaction(function () use ($organizationId, $email) {
            $existing = DB::table('customer_password_reset_tokens')
                ->where('organization_id', $organizationId)->where('email', $email)->lockForUpdate()->first();
            if ($existing !== null && now()->subSeconds(self::RESEND_AFTER_SECONDS)->lt($existing->created_at)) {
                return null;
            }

            $token = Str::random(64);
            DB::table('customer_password_reset_tokens')->where('organization_id', $organizationId)->where('email', $email)->delete();
            DB::table('customer_password_reset_tokens')->insert([
                'organization_id' => $organizationId,
                'email' => $email,
                'token_hash' => hash('sha256', $token),
                'created_at' => now(),
            ]);

            return $token;
        });
        if ($token === null) {
            return;
        }

        $name = $this->organizations->summary($organizationId)['name'] ?? $siteUrl;
        $url = rtrim($siteUrl, '/').'/account/reset-password?'.http_build_query(['token' => $token, 'email' => $email]);
        $account->notify(new ResetCustomerPassword($name, $url, self::VALID_MINUTES));
    }

    /**
     * Sets the new password and consumes the token. Every failure (unknown e-mail, wrong or
     * expired token, disabled account) is the same field error on `token`.
     */
    public function reset(string $email, string $token, string $password): CustomerAccount
    {
        $organizationId = $this->tenant->requireOrganization();
        $email = mb_strtolower(trim($email));

        return DB::transaction(function () use ($organizationId, $email, $token, $password) {
            $row = DB::table('customer_password_reset_tokens')
                ->where('organization_id', $organizationId)->where('email', $email)->lockForUpdate()->first();
            /** @var CustomerAccount|null $account */
            $account = CustomerAccount::query()->whereRaw('lower(email) = ?', [$email])->lockForUpdate()->first();

            $valid = $row !== null
                && hash_equals($row->token_hash, hash('sha256', $token))
                && now()->subMinutes(self::VALID_MINUTES)->lt($row->created_at)
                && $account !== null && $account->isActive();
            if (! $valid) {
                throw ValidationException::withMessages(['token' => ['This password reset link is invalid or has expired. Please request a new one.']]);
            }

            DB::table('customer_password_reset_tokens')->where('organization_id', $organizationId)->where('email', $email)->delete();
            $account->forceFill([
                'password' => $password,
                'remember_token' => Str::random(60),
                // The link proved the shopper reads this mailbox.
                'email_verified_at' => $account->email_verified_at ?? now(),
            ])->save();

            return $account;
        });
    }
}
