<?php

namespace App\Modules\Orders\Presentation\Http\Controllers;

use App\Modules\Orders\Presentation\Http\Support\CheckoutVerifiedPhones;
use App\Modules\Shared\Application\Localization\LocaleContext;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\BangladeshMobile;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Sms\Application\Contracts\PhoneVerification;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * BD1a: checking the shopper's mobile number with an SMS code before placing an order (cart
 * checkout and landing page order forms), when the store asks for it (`phone_verification`).
 */
class StoreCheckoutPhoneController
{
    public function __construct(
        private readonly PhoneVerification $codes,
        private readonly TenantContext $tenant,
    ) {}

    /**
     * Send a checkout code
     *
     * `{phone}` (a Bangladeshi mobile number) → 202 `{resend_after, expires_in}` (seconds). The
     * SMS is in the shopper's language. Errors: `SMS_UNAVAILABLE` (422), `OTP_TOO_SOON` (429,
     * `details.retry_after`), `OTP_LIMIT` (429), field errors.
     */
    public function send(Request $request, LocaleContext $locale): JsonResponse
    {
        $phone = $this->phone($request);
        $result = $this->codes->send($this->tenant->requireOrganization(), $phone, 'checkout', $request->ip(), $locale->current());

        return ApiResponse::success(['resend_after' => $result['resend_after'], 'expires_in' => $result['expires_in']], 202);
    }

    /**
     * Check a checkout code
     *
     * `{phone, code}` → 200 `{phone, verified: true}`; the number then counts as checked for
     * this store's checkout in this session for 2 hours. Errors: `OTP_INVALID`, `OTP_EXPIRED`
     * (422), `OTP_TOO_MANY_ATTEMPTS` (429), field errors.
     */
    public function verify(Request $request): JsonResponse
    {
        $request->validate(['code' => ['required', 'string', 'regex:/^\d{4,8}$/']], ['code.regex' => 'Enter the code from the SMS.']);
        $phone = $this->phone($request);
        $organizationId = $this->tenant->requireOrganization();

        $this->codes->verify($organizationId, $phone, 'checkout', (string) $request->input('code'));
        CheckoutVerifiedPhones::remember($request, $organizationId, $phone);

        return ApiResponse::success(['phone' => $phone, 'verified' => true]);
    }

    private function phone(Request $request): string
    {
        $raw = $request->input('phone');
        if (is_string($raw) && trim($raw) !== '') {
            $request->merge(['phone' => BangladeshMobile::normalize($raw) ?? $raw]);
        }
        $request->validate(
            ['phone' => ['required', 'string', 'regex:'.BangladeshMobile::PATTERN]],
            ['phone.regex' => 'Enter a Bangladeshi mobile number, e.g. 01712345678.'],
        );

        return (string) $request->input('phone');
    }
}
