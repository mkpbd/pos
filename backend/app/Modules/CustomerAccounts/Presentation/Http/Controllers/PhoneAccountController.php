<?php

namespace App\Modules\CustomerAccounts\Presentation\Http\Controllers;

use App\Modules\CustomerAccounts\Application\Actions\CustomerProfile;
use App\Modules\CustomerAccounts\Application\Actions\EmailVerification;
use App\Modules\CustomerAccounts\Application\Actions\PhoneSignIn;
use App\Modules\CustomerAccounts\Infrastructure\Models\CustomerAccount;
use App\Modules\Shared\Application\Localization\LocaleContext;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\BangladeshMobile;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Shared\Infrastructure\Validation\TenantUnique;
use App\Modules\Sms\Application\Contracts\PhoneVerification;
use Illuminate\Auth\AuthenticationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * BD1a: the shopper's mobile number — sign-in with an SMS code, completing a new account after
 * the first code, and verifying the profile's phone.
 */
class PhoneAccountController
{
    /**
     * Send a code
     *
     * `{phone, purpose: login|verify_phone}` → 202 `{resend_after, expires_in}` (seconds) — the same
     * answer whether or not an account uses the number. `login` is for guests (409
     * `ALREADY_SIGNED_IN` when signed in), `verify_phone` needs a signed-in shopper.
     * `SMS_UNAVAILABLE`, `OTP_TOO_SOON` (429, `details.retry_after`), `OTP_LIMIT` (429).
     */
    public function send(Request $request, PhoneVerification $phones, TenantContext $tenant, LocaleContext $locale): JsonResponse
    {
        $data = $request->validate([
            'phone' => ['required', 'string', 'max:20'],
            'purpose' => ['required', Rule::in(['login', 'verify_phone'])],
        ]);
        $phone = $this->phone($data['phone']);
        $signedIn = Auth::guard('customer')->check();
        if ($data['purpose'] === 'login' && $signedIn) {
            throw self::alreadySignedIn();
        }
        if ($data['purpose'] === 'verify_phone' && ! $signedIn) {
            throw new AuthenticationException('Unauthenticated.', ['customer']);
        }

        return ApiResponse::success($phones->send($tenant->requireOrganization(), $phone, $data['purpose'], $request->ip(), $locale->current()), 202);
    }

    /**
     * Sign in with a code
     *
     * `{phone, code, remember?}` (guests). The account whose verified phone this is →
     * `{status: "signed_in", customer, merge: {merged_lines, capped_lines}}` (the guest cart is
     * merged, as with password sign-in). No such account →
     * `{status: "needs_profile", phone}`: finish with `otp/register` within 15 minutes. Code
     * errors: `OTP_INVALID`, `OTP_EXPIRED`, `OTP_TOO_MANY_ATTEMPTS` (429); a disabled account
     * `INVALID_CREDENTIALS`.
     */
    public function login(Request $request, PhoneSignIn $signIn, CustomerProfile $profile): JsonResponse
    {
        $data = $request->validate([
            'phone' => ['required', 'string', 'max:20'],
            'code' => ['required', 'string', 'max:10'],
            'remember' => ['sometimes', 'boolean'],
        ]);
        if (Auth::guard('customer')->check()) {
            throw self::alreadySignedIn();
        }
        $phone = $this->phone($data['phone']);

        $signedIn = $signIn->login($phone, $data['code'], $request->boolean('remember'));

        return ApiResponse::success($signedIn === null
            ? ['status' => 'needs_profile', 'phone' => $phone]
            : ['status' => 'signed_in', 'customer' => $profile->show($signedIn[0]), 'merge' => $signedIn[1]]);
    }

    /**
     * Create an account with the proven phone
     *
     * `{name, email?}` after `otp/login` answered `needs_profile` → 201 profile, signed in. No
     * password; the phone is verified; an e-mail address gets a confirmation link.
     * `OTP_SESSION_EXPIRED` (422) after 15 minutes, `PHONE_IN_USE` (409) when another account
     * verified the phone meanwhile.
     */
    public function register(Request $request, PhoneSignIn $signIn, CustomerProfile $profile, EmailVerification $verification): JsonResponse
    {
        if (Auth::guard('customer')->check()) {
            throw self::alreadySignedIn();
        }
        $data = $request->validate([
            'name' => ['required', 'string', 'max:120'],
            'email' => ['sometimes', 'nullable', 'string', 'email:rfc', 'max:254', new TenantUnique('customer_accounts', 'email')],
        ]);

        $account = $signIn->register($data['name'], $data['email'] ?? null);
        $verification->send($account, $request->getSchemeAndHttpHost());

        return ApiResponse::created($profile->show($account));
    }

    /**
     * Verify the profile's phone
     *
     * `{phone, code}` with a `verify_phone` code → profile with the phone verified.
     * `PHONE_IN_USE` (409) when another account has verified it.
     */
    public function verifyPhone(Request $request, CustomerProfile $profile): JsonResponse
    {
        $data = $request->validate([
            'phone' => ['required', 'string', 'max:20'],
            'code' => ['required', 'string', 'max:10'],
        ]);
        /** @var CustomerAccount $account */
        $account = $request->user('customer');
        $profile->verifyPhone($account, $this->phone($data['phone']), $data['code']);

        return ApiResponse::success($profile->show($account));
    }

    private function phone(string $input): string
    {
        return BangladeshMobile::normalize($input)
            ?? throw ValidationException::withMessages(['phone' => ['Enter a Bangladeshi mobile number, e.g. 01712345678.']]);
    }

    private static function alreadySignedIn(): BusinessRuleViolation
    {
        return new BusinessRuleViolation('ALREADY_SIGNED_IN', 'You are already signed in.', [], 409);
    }
}
