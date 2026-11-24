<?php

namespace App\Modules\CustomerAccounts\Application\Actions;

use App\Modules\CustomerAccounts\Infrastructure\Models\CustomerAccount;
use App\Modules\Customers\Application\Actions\OnlineCustomerProfiles;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Sms\Application\Contracts\PhoneVerification;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\Request;

/**
 * BD1a: signing in with a mobile number and an SMS code (`login` codes, Sms PhoneVerification).
 *
 * A proven phone signs into the account whose VERIFIED phone it is. Accounts that only typed the
 * number are never signed into (anyone may have typed it): without a verified account the
 * session remembers the proven phone for SESSION_MINUTES and the shopper completes a new
 * account (name, optional e-mail) — no password, phone verified.
 */
class PhoneSignIn
{
    public const SESSION_KEY = 'customer_otp_phone';

    public const SESSION_MINUTES = 15;

    public function __construct(
        private readonly PhoneVerification $phones,
        private readonly TenantContext $tenant,
        private readonly Request $request,
        private readonly CustomerSession $session,
        private readonly OnlineCustomerProfiles $customers,
        private readonly CreateCustomerAccount $create,
    ) {}

    /**
     * Checks the code; signs in (returns the account and the guest cart merge) or remembers the
     * phone (returns null).
     *
     * @return array{0: CustomerAccount, 1: array{merged_lines: int, capped_lines: int}}|null
     */
    public function login(string $phone, string $code, bool $remember): ?array
    {
        if (! $this->request->hasSession()) {
            throw new BusinessRuleViolation('SESSION_UNAVAILABLE', 'Signing in needs a browser session.');
        }
        $this->phones->verify($this->tenant->requireOrganization(), $phone, 'login', $code);

        $account = $this->verifiedAccount($phone);
        if ($account === null) {
            $this->request->session()->put(self::SESSION_KEY, ['phone' => $phone, 'at' => now()->getTimestamp()]);

            return null;
        }

        if (! $account->isActive() || ! $this->customers->isUsable($account->customer_id)) {
            throw new BusinessRuleViolation('INVALID_CREDENTIALS', 'This account cannot sign in. Please contact the store.');
        }

        $this->request->session()->forget(self::SESSION_KEY);
        $merge = $this->session->login($account, $remember);

        return [$account, $merge];
    }

    /**
     * Creates the account for the phone proven in this session and signs it in.
     * OTP_SESSION_EXPIRED without a (recent) proven phone; PHONE_IN_USE when an account verified
     * the phone meanwhile.
     */
    public function register(string $name, ?string $email): CustomerAccount
    {
        $phone = $this->provenPhone()
            ?? throw new BusinessRuleViolation('OTP_SESSION_EXPIRED', 'Your code has expired. Ask for a new code to continue.');

        if ($this->verifiedAccount($phone) !== null) {
            throw CustomerProfile::phoneInUse();
        }

        try {
            $account = ($this->create)(['name' => $name, 'email' => $email, 'phone' => $phone, 'phone_verified' => true]);
        } catch (UniqueConstraintViolationException $e) {
            throw CustomerProfile::isVerifiedPhoneClash($e) ? CustomerProfile::phoneInUse() : $e;
        }

        $this->request->session()->forget(self::SESSION_KEY);
        $this->session->login($account);

        return $account;
    }

    private function provenPhone(): ?string
    {
        if (! $this->request->hasSession()) {
            return null;
        }
        $proven = $this->request->session()->get(self::SESSION_KEY);
        if (! is_array($proven) || ! is_string($proven['phone'] ?? null) || ! is_int($proven['at'] ?? null)) {
            return null;
        }
        if ($proven['at'] < now()->subMinutes(self::SESSION_MINUTES)->getTimestamp()) {
            $this->request->session()->forget(self::SESSION_KEY);

            return null;
        }

        return $proven['phone'];
    }

    private function verifiedAccount(string $phone): ?CustomerAccount
    {
        /** @var CustomerAccount|null */
        return CustomerAccount::query()->where('phone', $phone)->whereNotNull('phone_verified_at')->first();
    }
}
