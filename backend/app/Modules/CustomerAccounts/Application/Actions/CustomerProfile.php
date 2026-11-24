<?php

namespace App\Modules\CustomerAccounts\Application\Actions;

use App\Modules\CustomerAccounts\Infrastructure\Models\CustomerAccount;
use App\Modules\Customers\Application\Actions\OnlineCustomerProfiles;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Sms\Application\Contracts\PhoneVerification;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

/**
 * The signed-in shopper's own profile (name and phone live on the customer record, the
 * phone also on the account) and password. Changing the e-mail address is not offered yet.
 *
 * BD1a: an account without an e-mail address may add one (once); a phone is verified with an SMS
 * code (one verified phone per account per organization) and changing the number drops the
 * verification; an account without a password sets its first one without the current password.
 */
class CustomerProfile
{
    public const VERIFIED_PHONE_INDEX = 'customer_accounts_org_verified_phone_unique';

    public function __construct(
        private readonly OnlineCustomerProfiles $customers,
        private readonly Request $request,
        private readonly TenantContext $tenant,
        private readonly PhoneVerification $phones,
    ) {}

    /**
     * @return array{id: string, name: string, email: ?string, phone: ?string, email_verified: bool, phone_verified: bool, has_password: bool, preferred_locale: ?string}
     */
    public function show(CustomerAccount $account): array
    {
        return [
            'id' => $account->id,
            'name' => $this->customers->find($account->customer_id)['name'] ?? '',
            'email' => $account->email,
            'phone' => $account->phone,
            'email_verified' => $account->email !== null && $account->email_verified_at !== null,
            'phone_verified' => $account->phone !== null && $account->phone_verified_at !== null,
            'has_password' => $account->password !== null && $account->password !== '',
            // E12b: en | bn (null before the first sign-in since E12b).
            'preferred_locale' => $account->preferred_locale,
        ];
    }

    /**
     * Name, phone (a new number is unverified) and — only while the account has none — the
     * e-mail address. Returns whether an e-mail address was added (it needs confirming).
     */
    public function update(CustomerAccount $account, string $name, ?string $phone, ?string $email = null): bool
    {
        $phone = $phone ?: null;
        $email = $account->email === null && $email !== null && trim($email) !== '' ? mb_strtolower(trim($email)) : null;

        DB::transaction(function () use ($account, $name, $phone, $email) {
            $changes = ['phone' => $phone];
            if ($phone !== $account->phone) {
                $changes['phone_verified_at'] = null;
            }
            if ($email !== null) {
                $changes += ['email' => $email, 'email_verified_at' => null];
            }
            $account->forceFill($changes)->save();
            $this->customers->update($account->customer_id, trim($name), $phone);
            if ($email !== null) {
                $this->customers->addEmail($account->customer_id, $email);
            }
        });

        return $email !== null;
    }

    /**
     * Proves the phone with a `verify_phone` code and makes it the account's verified phone.
     * PHONE_IN_USE (409) when another account of the store has it verified.
     */
    public function verifyPhone(CustomerAccount $account, string $phone, string $code): void
    {
        $organizationId = $this->tenant->requireOrganization();
        $this->phones->verify($organizationId, $phone, 'verify_phone', $code);

        if (CustomerAccount::query()->where('phone', $phone)->whereNotNull('phone_verified_at')->whereKeyNot($account->id)->exists()) {
            throw self::phoneInUse();
        }

        try {
            DB::transaction(function () use ($account, $phone) {
                $account->forceFill(['phone' => $phone, 'phone_verified_at' => now()])->save();
                $this->customers->update($account->customer_id, $this->customers->find($account->customer_id)['name'] ?? '', $phone);
            });
        } catch (UniqueConstraintViolationException $e) {
            throw self::isVerifiedPhoneClash($e) ? self::phoneInUse() : $e;
        }
    }

    /**
     * @throws ValidationException when the current password is wrong
     */
    public function changePassword(CustomerAccount $account, ?string $current, string $new): void
    {
        $hasPassword = $account->password !== null && $account->password !== '';
        if ($hasPassword && ($current === null || ! Hash::check($current, $account->password))) {
            throw ValidationException::withMessages(['current_password' => ['The current password is incorrect.']]);
        }

        $account->forceFill(['password' => $new])->save();
        if ($this->request->hasSession()) {
            $this->request->session()->regenerate();
        }
    }

    public static function phoneInUse(): BusinessRuleViolation
    {
        return new BusinessRuleViolation('PHONE_IN_USE', 'Another account already uses this mobile number.', [], 409);
    }

    public static function isVerifiedPhoneClash(UniqueConstraintViolationException $e): bool
    {
        return str_contains($e->getMessage(), self::VERIFIED_PHONE_INDEX);
    }
}
