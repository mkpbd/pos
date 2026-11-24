<?php

namespace App\Modules\Sms\Application\Services;

use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\BangladeshMobile;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Sms\Application\Contracts\PhoneVerification;
use App\Modules\Sms\Application\Contracts\SmsSender;
use App\Modules\Sms\Application\Queries\SmsConfig;
use App\Modules\Sms\Infrastructure\Models\SmsMessage;
use App\Modules\Sms\Infrastructure\Models\SmsOtp;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use InvalidArgumentException;

/**
 * BD1a: the PhoneVerification — 6-digit one-time codes by SMS (config `sms.otp.*`).
 *
 * Only an HMAC-SHA256 (APP_KEY) of org|phone|purpose|code is stored, so a code is bound to its
 * organization, phone and purpose. Sends are serialized per phone (advisory lock) and limited:
 * one per `resend_seconds` per phone + purpose, `max_per_phone_per_hour` per phone,
 * `max_per_ip_per_hour` per address and `daily_limit_per_org`. Only the newest code of a phone +
 * purpose works; it allows `max_attempts` wrong guesses (counted even though the request fails)
 * and is consumed once under a row lock.
 */
class OtpCodes implements PhoneVerification
{
    public const MASK = '••••••';

    public function __construct(
        private readonly SmsSender $sender,
        private readonly SmsConfig $config,
        private readonly TenantContext $tenant,
    ) {}

    public function send(string $orgId, string $phone, string $purpose, ?string $ip, string $locale = 'en'): array
    {
        $phone = $this->phone($phone);
        $this->purpose($purpose);
        if (! $this->sender->otpReady($orgId)) {
            throw new BusinessRuleViolation('SMS_UNAVAILABLE', 'Text messages are not available right now.');
        }

        $ttl = max(60, (int) config('sms.otp.ttl_seconds', 300));
        $resend = max(0, (int) config('sms.otp.resend_seconds', 60));
        $ip = $ip !== null ? mb_substr($ip, 0, 45) : null;

        $this->tenant->runAs($orgId, fn () => DB::transaction(function () use ($orgId, $phone, $purpose, $ip, $locale, $ttl, $resend) {
            DB::select('SELECT pg_advisory_xact_lock(hashtext(?))', ["sms-otp|{$orgId}|{$phone}"]);
            $this->checkLimits($orgId, $phone, $purpose, $ip, $resend);

            $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
            SmsOtp::query()->create([
                'organization_id' => $orgId,
                'phone' => $phone,
                'purpose' => $purpose,
                'code_hash' => $this->hash($orgId, $phone, $purpose, $code),
                'attempts' => 0,
                'expires_at' => now()->addSeconds($ttl),
                'ip' => $ip,
                'created_at' => now(),
            ]);

            $text = $this->text($orgId, $locale, $ttl);
            $id = $this->sender->queue($orgId, $phone, 'otp', str_replace(':code', $code, $text), maskedText: str_replace(':code', self::MASK, $text));
            $status = $id !== null ? SmsMessage::query()->whereKey($id)->value('status') : null;
            if ($id === null || $status === 'skipped') {
                throw new BusinessRuleViolation('SMS_UNAVAILABLE', 'Text messages are not available right now.');
            }
        }));

        return ['resend_after' => $resend, 'expires_in' => $ttl];
    }

    public function verify(string $orgId, string $phone, string $purpose, string $code): void
    {
        $phone = $this->phone($phone);
        $this->purpose($purpose);
        $code = trim($code);
        $maxAttempts = max(1, (int) config('sms.otp.max_attempts', 5));

        // Committed on its own, so a wrong guess counts even though the request then fails.
        $outcome = $this->tenant->runAs($orgId, fn () => DB::transaction(function () use ($orgId, $phone, $purpose, $code, $maxAttempts) {
            /** @var SmsOtp|null $otp */
            $otp = SmsOtp::query()->withoutGlobalScope('organization')
                ->where('organization_id', $orgId)->where('phone', $phone)->where('purpose', $purpose)
                ->orderByDesc('created_at')->orderByDesc('id')
                ->lockForUpdate()->first();

            if ($otp === null || $otp->consumed_at !== null) {
                return 'invalid';
            }
            if ($otp->expires_at->lte(now())) {
                return 'expired';
            }
            if ($otp->attempts >= $maxAttempts) {
                return 'too_many';
            }
            if (preg_match('/^\d{6}$/', $code) !== 1 || ! hash_equals($otp->code_hash, $this->hash($orgId, $phone, $purpose, $code))) {
                $otp->forceFill(['attempts' => $otp->attempts + 1])->save();

                return 'invalid';
            }

            $otp->forceFill(['consumed_at' => now()])->save();

            return 'ok';
        }));

        match ($outcome) {
            'ok' => null,
            'expired' => throw new BusinessRuleViolation('OTP_EXPIRED', 'This code has expired. Ask for a new one.'),
            'too_many' => throw new BusinessRuleViolation('OTP_TOO_MANY_ATTEMPTS', 'Too many wrong codes. Ask for a new one.', [], 429),
            default => throw new BusinessRuleViolation('OTP_INVALID', 'The code is not correct.'),
        };
    }

    private function checkLimits(string $orgId, string $phone, string $purpose, ?string $ip, int $resend): void
    {
        $base = fn () => SmsOtp::query()->withoutGlobalScope('organization')->where('organization_id', $orgId);

        $last = $base()->where('phone', $phone)->where('purpose', $purpose)->max('created_at');
        if ($last !== null && $resend > 0) {
            $wait = $resend - (int) floor(now()->getTimestamp() - now()->parse($last)->getTimestamp());
            if ($wait > 0) {
                throw new BusinessRuleViolation('OTP_TOO_SOON', "Wait {$wait} seconds before asking for another code.", ['retry_after' => $wait], 429);
            }
        }

        $hourAgo = now()->subHour();
        $limited = $base()->where('phone', $phone)->where('created_at', '>', $hourAgo)->count() >= (int) config('sms.otp.max_per_phone_per_hour', 5)
            || ($ip !== null && $base()->where('ip', $ip)->where('created_at', '>', $hourAgo)->count() >= (int) config('sms.otp.max_per_ip_per_hour', 20))
            || $base()->where('created_at', '>=', $this->config->dayStart($orgId))->count() >= (int) config('sms.otp.daily_limit_per_org', 1000);
        if ($limited) {
            throw new BusinessRuleViolation('OTP_LIMIT', 'Too many codes were requested. Try again later.', [], 429);
        }
    }

    /** The message with a `:code` marker for the code. */
    private function text(string $orgId, string $locale, int $ttl): string
    {
        $shop = $this->config->shopName($orgId);
        $minutes = (int) ceil($ttl / 60);

        return $locale === 'bn'
            ? "{$shop}: আপনার কোড :code। ".strtr((string) $minutes, ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯']).' মিনিট বৈধ। কাউকে জানাবেন না।'
            : "{$shop}: your code is :code. Valid {$minutes} minutes. Do not share it.";
    }

    private function hash(string $orgId, string $phone, string $purpose, string $code): string
    {
        return hash_hmac('sha256', "{$orgId}|{$phone}|{$purpose}|{$code}", (string) config('app.key'));
    }

    private function phone(string $phone): string
    {
        return BangladeshMobile::normalize($phone)
            ?? throw ValidationException::withMessages(['phone' => ['Enter a Bangladeshi mobile number, e.g. 01712345678.']]);
    }

    private function purpose(string $purpose): void
    {
        if (! in_array($purpose, self::PURPOSES, true)) {
            throw new InvalidArgumentException("Unknown phone code purpose [{$purpose}].");
        }
    }
}
