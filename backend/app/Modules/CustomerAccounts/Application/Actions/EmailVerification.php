<?php

namespace App\Modules\CustomerAccounts\Application\Actions;

use App\Modules\CustomerAccounts\Infrastructure\Models\CustomerAccount;
use App\Modules\CustomerAccounts\Infrastructure\Notifications\VerifyCustomerEmail;
use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * E-mail ownership: a link with a random token (stored as sha256, valid VALID_HOURS)
 * marks the account verified. Unverified accounts can still sign in and shop.
 */
class EmailVerification
{
    public const VALID_HOURS = 24;

    public function __construct(
        private readonly TenantContext $tenant,
        private readonly OrganizationDirectory $organizations,
    ) {}

    /**
     * Sends a new link (the previous one stops working). Nothing happens for a verified account.
     *
     * @param  string  $siteUrl  scheme and host of the storefront, for the link
     */
    public function send(CustomerAccount $account, string $siteUrl): void
    {
        if ($account->email_verified_at !== null) {
            return;
        }

        $token = Str::random(48);
        $account->forceFill([
            'email_verification_token_hash' => hash('sha256', $token),
            'email_verification_sent_at' => now(),
        ])->save();

        $name = $this->organizations->summary($this->tenant->requireOrganization())['name'] ?? $siteUrl;
        $account->notify(new VerifyCustomerEmail($name, rtrim($siteUrl, '/').'/account/verify-email?token='.$token, self::VALID_HOURS));
    }

    public function verify(string $token): CustomerAccount
    {
        return DB::transaction(function () use ($token) {
            /** @var CustomerAccount|null $account */
            $account = CustomerAccount::query()
                ->where('email_verification_token_hash', hash('sha256', $token))
                ->lockForUpdate()
                ->first();

            if ($account === null || $account->email_verification_sent_at?->lt(now()->subHours(self::VALID_HOURS)) !== false) {
                throw new BusinessRuleViolation('TOKEN_INVALID', 'This confirmation link is invalid or has expired. Request a new one from your account page.');
            }

            $account->forceFill([
                'email_verified_at' => now(),
                'email_verification_token_hash' => null,
                'email_verification_sent_at' => null,
            ])->save();

            return $account;
        });
    }
}
