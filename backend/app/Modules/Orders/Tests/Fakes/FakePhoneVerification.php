<?php

namespace App\Modules\Orders\Tests\Fakes;

use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Sms\Application\Contracts\PhoneVerification;

/**
 * BD1a: an in-memory PhoneVerification for Orders tests — every code is `CODE`, kept per
 * organization + phone + purpose until used once.
 */
class FakePhoneVerification implements PhoneVerification
{
    public const CODE = '123456';

    public bool $available = true;

    /** @var array<string, bool> "org|phone|purpose" => unused code */
    public array $codes = [];

    /** @var list<array{org: string, phone: string, purpose: string, ip: ?string, locale: string}> */
    public array $sent = [];

    public function send(string $orgId, string $phone, string $purpose, ?string $ip, string $locale = 'en'): array
    {
        if (! $this->available) {
            throw new BusinessRuleViolation('SMS_UNAVAILABLE', 'SMS is not available.');
        }
        $this->codes["{$orgId}|{$phone}|{$purpose}"] = true;
        $this->sent[] = ['org' => $orgId, 'phone' => $phone, 'purpose' => $purpose, 'ip' => $ip, 'locale' => $locale];

        return ['resend_after' => 60, 'expires_in' => 300];
    }

    public function verify(string $orgId, string $phone, string $purpose, string $code): void
    {
        $key = "{$orgId}|{$phone}|{$purpose}";
        if (! isset($this->codes[$key]) || $code !== self::CODE) {
            throw new BusinessRuleViolation('OTP_INVALID', 'The code is not correct.');
        }
        unset($this->codes[$key]);
    }
}
