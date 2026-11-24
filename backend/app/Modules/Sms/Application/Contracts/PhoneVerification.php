<?php

namespace App\Modules\Sms\Application\Contracts;

use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;

/**
 * BD1a: one-time SMS codes proving a shopper owns a mobile number (Sms module).
 * Failures are BusinessRuleViolation with the codes SMS_UNAVAILABLE (422), OTP_TOO_SOON (429,
 * details.retry_after), OTP_LIMIT (429), OTP_INVALID (422), OTP_EXPIRED (422) and
 * OTP_TOO_MANY_ATTEMPTS (429).
 */
interface PhoneVerification
{
    public const PURPOSES = ['login', 'checkout', 'verify_phone'];

    /**
     * Sends a new 6-digit code (earlier unused codes for the phone + purpose stop working).
     *
     * @return array{resend_after: int, expires_in: int} seconds
     *
     * @throws BusinessRuleViolation
     */
    public function send(string $orgId, string $phone, string $purpose, ?string $ip, string $locale = 'en'): array;

    /**
     * Checks and consumes the newest code for the phone + purpose.
     *
     * @throws BusinessRuleViolation
     */
    public function verify(string $orgId, string $phone, string $purpose, string $code): void;
}
