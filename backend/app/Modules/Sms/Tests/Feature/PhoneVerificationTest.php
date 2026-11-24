<?php

namespace App\Modules\Sms\Tests\Feature;

use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Sms\Application\Contracts\PhoneVerification;
use App\Modules\Sms\Infrastructure\Models\SmsMessage;
use App\Modules\Sms\Infrastructure\Models\SmsOtp;
use App\Modules\Sms\Tests\Concerns\BuildsSms;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * BD1a: one-time phone codes — sending (availability, resend wait, hourly / daily limits),
 * checking (wrong, expired, too many attempts, consumed once, only the newest code), the code
 * never stored in plain text and organization isolation.
 */
class PhoneVerificationTest extends TestCase
{
    use BuildsSms, RefreshDatabase;

    private const PHONE = '01712345678';

    /** @var array<string, mixed> */
    private array $tenant;

    private string $org;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSms();
        Http::preventStrayRequests();
        $this->tenant = $this->provisionTenant('Berry Kids');
        $this->org = $this->tenant['organization']->id;
        $this->actingAsUser($this->tenant['admin']);
        $this->enableSms();
    }

    private function otp(): PhoneVerification
    {
        return app(PhoneVerification::class);
    }

    /**
     * @return array{code: string, status: int, details: array<string, mixed>}
     */
    private function failure(callable $call): array
    {
        try {
            $call();
        } catch (BusinessRuleViolation $e) {
            return ['code' => $e->errorCode, 'status' => $e->status, 'details' => $e->details];
        }
        $this->fail('Expected a BusinessRuleViolation.');
    }

    public function test_sending_a_code(): void
    {
        $answer = $this->otp()->send($this->org, '+880 1712-345678', 'login', '203.0.113.9');
        $this->assertSame(['resend_after' => 60, 'expires_in' => 300], $answer);

        $code = $this->lastCode();
        $this->assertMatchesRegularExpression('/^\d{6}$/', (string) $code);
        $this->assertSame("Berry Kids: your code is {$code}. Valid 5 minutes. Do not share it.", $this->lastLoggedText());

        $otp = SmsOtp::query()->withoutGlobalScopes()->sole();
        $this->assertSame([self::PHONE, 'login', 0, '203.0.113.9'], [$otp->phone, $otp->purpose, $otp->attempts, $otp->ip]);
        $this->assertSame(hash_hmac('sha256', "{$this->org}|".self::PHONE."|login|{$code}", (string) config('app.key')), DB::table('sms_otps')->value('code_hash'));
        $this->assertStringNotContainsString((string) $code, (string) DB::table('sms_otps')->get()->toJson());

        $message = SmsMessage::query()->withoutGlobalScopes()->sole();
        $this->assertSame(['otp', 'Berry Kids: your code is ••••••. Valid 5 minutes. Do not share it.', 'sent', null], [$message->purpose, $message->body, $message->status, $message->related_type]);

        // Bangla.
        $this->travel(61)->seconds();
        $this->otp()->send($this->org, self::PHONE, 'login', null, 'bn');
        $this->assertSame("Berry Kids: আপনার কোড {$this->lastCode()}। ৫ মিনিট বৈধ। কাউকে জানাবেন না।", $this->lastLoggedText());
    }

    public function test_codes_are_unavailable_when_sms_is_not_ready(): void
    {
        $this->patchJson('/api/v1/sms/settings', ['is_enabled' => false])->assertOk();
        $this->assertSame('SMS_UNAVAILABLE', $this->failure(fn () => $this->otp()->send($this->org, self::PHONE, 'login', null))['code']);

        // Test mode never "sends" codes in production.
        $this->patchJson('/api/v1/sms/settings', ['is_enabled' => true])->assertOk();
        $this->app['env'] = 'production';
        try {
            $this->assertSame('SMS_UNAVAILABLE', $this->failure(fn () => $this->otp()->send($this->org, self::PHONE, 'login', null))['code']);
        } finally {
            $this->app['env'] = 'testing';
        }

        // Over the monthly limit the code could not go out: unavailable, nothing kept.
        DB::table('sms_settings')->update(['monthly_limit' => 1]);
        $this->postJson('/api/v1/sms/test', ['phone' => self::PHONE])->assertOk();
        $this->assertSame('SMS_UNAVAILABLE', $this->failure(fn () => $this->otp()->send($this->org, self::PHONE, 'login', null))['code']);
        $this->assertDatabaseCount('sms_otps', 0);
    }

    public function test_resend_wait_and_hourly_and_daily_limits(): void
    {
        $this->otp()->send($this->org, self::PHONE, 'login', '203.0.113.9');
        $tooSoon = $this->failure(fn () => $this->otp()->send($this->org, self::PHONE, 'login', '203.0.113.9'));
        $this->assertSame(['OTP_TOO_SOON', 429], [$tooSoon['code'], $tooSoon['status']]);
        $this->assertGreaterThan(55, $tooSoon['details']['retry_after']);
        $this->assertLessThanOrEqual(60, $tooSoon['details']['retry_after']);

        // Another purpose is not "too soon", but counts for the phone.
        $this->otp()->send($this->org, self::PHONE, 'verify_phone', '203.0.113.9');
        for ($i = 0; $i < 3; $i++) {
            $this->travel(61)->seconds();
            $this->otp()->send($this->org, self::PHONE, 'login', '203.0.113.9');
        }
        $this->travel(61)->seconds();
        $limit = $this->failure(fn () => $this->otp()->send($this->org, self::PHONE, 'login', '203.0.113.9'));
        $this->assertSame(['OTP_LIMIT', 429], [$limit['code'], $limit['status']]);

        // An hour later the phone may ask again.
        $this->travel(61)->minutes();
        $this->otp()->send($this->org, self::PHONE, 'login', '203.0.113.9');

        // Per address.
        config(['sms.otp.max_per_ip_per_hour' => 2]);
        $this->travel(2)->hours();
        $this->otp()->send($this->org, '01812345678', 'login', '198.51.100.7');
        $this->otp()->send($this->org, '01912345678', 'login', '198.51.100.7');
        $this->assertSame('OTP_LIMIT', $this->failure(fn () => $this->otp()->send($this->org, '01612345678', 'login', '198.51.100.7'))['code']);
        $this->otp()->send($this->org, '01612345678', 'login', '198.51.100.8');

        // Per organization and day.
        config(['sms.otp.daily_limit_per_org' => SmsOtp::query()->withoutGlobalScopes()->where('created_at', '>=', now()->setTimezone('Asia/Dhaka')->startOfDay()->utc())->count()]);
        $this->assertSame('OTP_LIMIT', $this->failure(fn () => $this->otp()->send($this->org, '01512345678', 'login', null))['code']);
    }

    public function test_checking_codes(): void
    {
        $this->otp()->send($this->org, self::PHONE, 'login', null);
        $code = (string) $this->lastCode();
        $wrong = $code === '000000' ? '111111' : '000000';

        $this->assertSame(['OTP_INVALID', 422], array_values(array_slice($this->failure(fn () => $this->otp()->verify($this->org, self::PHONE, 'login', $wrong)), 0, 2)));
        $this->assertSame('OTP_INVALID', $this->failure(fn () => $this->otp()->verify($this->org, self::PHONE, 'login', 'abc'))['code']);
        // Wrong guesses are counted even though the request fails.
        $this->assertSame(2, SmsOtp::query()->withoutGlobalScopes()->sole()->attempts);
        // Another purpose has no code.
        $this->assertSame('OTP_INVALID', $this->failure(fn () => $this->otp()->verify($this->org, self::PHONE, 'checkout', $code))['code']);

        $this->otp()->verify($this->org, '+8801712345678', 'login', $code);
        $this->assertNotNull(SmsOtp::query()->withoutGlobalScopes()->sole()->consumed_at);
        // Used once only.
        $this->assertSame('OTP_INVALID', $this->failure(fn () => $this->otp()->verify($this->org, self::PHONE, 'login', $code))['code']);
    }

    public function test_too_many_attempts_and_expiry(): void
    {
        $this->otp()->send($this->org, self::PHONE, 'login', null);
        $code = (string) $this->lastCode();
        $wrong = $code === '000000' ? '111111' : '000000';
        for ($i = 0; $i < 5; $i++) {
            $this->failure(fn () => $this->otp()->verify($this->org, self::PHONE, 'login', $wrong));
        }
        $blocked = $this->failure(fn () => $this->otp()->verify($this->org, self::PHONE, 'login', $code));
        $this->assertSame(['OTP_TOO_MANY_ATTEMPTS', 429], [$blocked['code'], $blocked['status']]);

        $this->travel(61)->seconds();
        $this->otp()->send($this->org, self::PHONE, 'checkout', null);
        $code = (string) $this->lastCode();
        $this->travel(301)->seconds();
        $this->assertSame('OTP_EXPIRED', $this->failure(fn () => $this->otp()->verify($this->org, self::PHONE, 'checkout', $code))['code']);
    }

    public function test_only_the_newest_code_works(): void
    {
        $this->otp()->send($this->org, self::PHONE, 'login', null);
        $first = (string) $this->lastCode();
        $this->travel(61)->seconds();
        $this->otp()->send($this->org, self::PHONE, 'login', null);
        $second = (string) $this->lastCode();

        if ($first !== $second) {
            $this->assertSame('OTP_INVALID', $this->failure(fn () => $this->otp()->verify($this->org, self::PHONE, 'login', $first))['code']);
        }
        $this->otp()->verify($this->org, self::PHONE, 'login', $second);
        $this->assertSame('OTP_INVALID', $this->failure(fn () => $this->otp()->verify($this->org, self::PHONE, 'login', $first))['code']);
    }

    public function test_a_code_of_one_organization_never_works_in_another(): void
    {
        $other = $this->provisionTenant('Other Shop');
        $this->actingAsUser($other['admin']);
        $this->enableSms();

        $this->otp()->send($this->org, self::PHONE, 'login', null);
        $code = (string) $this->lastCode();

        $this->assertSame('OTP_INVALID', $this->failure(fn () => $this->otp()->verify($other['organization']->id, self::PHONE, 'login', $code))['code']);
        // B's limits do not see A's codes.
        $this->otp()->send($other['organization']->id, self::PHONE, 'login', null);
        $codeB = (string) $this->lastCode();
        if ($codeB !== $code) {
            $this->assertSame('OTP_INVALID', $this->failure(fn () => $this->otp()->verify($this->org, self::PHONE, 'login', $codeB))['code']);
        }
        $this->otp()->verify($this->org, self::PHONE, 'login', $code);
        $this->otp()->verify($other['organization']->id, self::PHONE, 'login', $codeB);

        $this->assertSame(1, SmsOtp::query()->withoutGlobalScopes()->where('organization_id', $other['organization']->id)->count());
        $this->assertSame(1, SmsMessage::query()->withoutGlobalScopes()->where('organization_id', $other['organization']->id)->count());
    }

    public function test_consuming_locks_the_code_row(): void
    {
        $this->otp()->send($this->org, self::PHONE, 'login', null);
        $code = (string) $this->lastCode();
        $statements = [];
        DB::listen(function ($query) use (&$statements) {
            $statements[] = $query->sql;
        });

        $this->otp()->verify($this->org, self::PHONE, 'login', $code);

        $this->assertNotEmpty(array_filter($statements, fn (string $sql) => str_contains($sql, 'sms_otps') && str_contains($sql, 'for update')));
    }
}
