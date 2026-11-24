<?php

namespace App\Modules\Sms\Tests\Feature;

use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Sms\Application\Contracts\SmsSender;
use App\Modules\Sms\Application\Data\SmsSettingsData;
use App\Modules\Sms\Domain\SmsTemplate;
use App\Modules\Sms\Domain\SmsText;
use App\Modules\Sms\Infrastructure\Gateways\HostGuard;
use App\Modules\Sms\Infrastructure\Gateways\HttpSmsGateway;
use App\Modules\Sms\Infrastructure\Jobs\SendSmsJob;
use App\Modules\Sms\Infrastructure\Models\SmsMessage;
use App\Modules\Sms\Infrastructure\Retention\PruneSmsRecords;
use App\Modules\Sms\Tests\Concerns\BuildsSms;
use App\Modules\System\Application\Actions\PruneRecords;
use Illuminate\Contracts\Queue\ShouldBeEncrypted;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Factory;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * BD1a: delivery — the HTTP gateway (methods, body formats, parameter names, phone formats,
 * success text, retries), the SSRF guard and redirects, dedupe, the monthly limit, order
 * templates, SMS parts and retention.
 */
class SmsDeliveryTest extends TestCase
{
    use BuildsSms, RefreshDatabase;

    private const KEY = 'KEY-SECRET-123456';

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
    }

    private function sender(): SmsSender
    {
        return app(SmsSender::class);
    }

    private function message(?string $id): SmsMessage
    {
        return SmsMessage::query()->withoutGlobalScopes()->findOrFail($id);
    }

    public function test_get_request_with_mapped_parameters_and_phone_format(): void
    {
        Http::fake(['sms.example.com/*' => Http::response('1001|SMS SUBMITTED', 200)]);
        $this->enableHttpSms([
            'http_method' => 'GET', 'param_to' => 'msisdn', 'param_message' => 'sms', 'phone_format' => 'local',
            'extra_params' => ['type' => 'text'], 'success_contains' => 'SUBMITTED',
        ]);

        $id = $this->sender()->queue($this->org, '+880 1712-345678', 'order_placed', 'Order R-1 received');

        $message = $this->message($id);
        $this->assertSame(['sent', 'http', 1, 200], [$message->status, $message->driver, $message->attempts, $message->provider_status]);
        $this->assertSame('01712345678', $message->to_phone);
        $this->assertNotNull($message->sent_at);
        Http::assertSent(function (HttpRequest $r) {
            parse_str((string) parse_url($r->url(), PHP_URL_QUERY), $query);

            return $r->method() === 'GET' && str_starts_with($r->url(), 'https://sms.example.com/api/send?')
                && $query === ['msisdn' => '01712345678', 'sms' => 'Order R-1 received', 'senderid' => 'BERRYKIDS', 'api_key' => self::KEY, 'type' => 'text'];
        });
        $this->assertStringNotContainsString(self::KEY, $this->allLogs());
    }

    public function test_post_form_and_json_bodies_and_phone_formats(): void
    {
        Http::fake(['sms.example.com/*' => Http::response('{"ok":true}', 200)]);
        $this->enableHttpSms(['phone_format' => '880']);
        $this->sender()->queue($this->org, '01712345678', 'order_placed', 'Form body');
        Http::assertSent(fn (HttpRequest $r) => $r->method() === 'POST' && $r->isForm()
            && $r->data() === ['to' => '8801712345678', 'message' => 'Form body', 'senderid' => 'BERRYKIDS', 'api_key' => self::KEY]);

        $this->enableHttpSms(['http_body' => 'json', 'phone_format' => 'plus880']);
        $this->sender()->queue($this->org, '01712345678', 'order_placed', 'JSON body');
        Http::assertSent(fn (HttpRequest $r) => $r->method() === 'POST' && $r->isJson()
            && $r->data() === ['to' => '+8801712345678', 'message' => 'JSON body', 'senderid' => 'BERRYKIDS', 'api_key' => self::KEY]);
    }

    public function test_success_text_must_appear_in_the_answer(): void
    {
        Http::fake(['sms.example.com/*' => Http::response('{"status":"ERROR","reason":"balance"}', 200)]);
        $this->enableHttpSms(['success_contains' => '"status":"SUCCESS"']);

        $message = $this->message($this->sender()->queue($this->org, '01712345678', 'order_placed', 'Hello'));
        $this->assertSame(['failed', 'unexpected_response', 200], [$message->status, $message->error, $message->provider_status]);
        $this->assertSame('{"status":"ERROR","reason":"balance"}', $message->provider_response);
    }

    public function test_client_errors_are_not_retried(): void
    {
        Http::fake(['sms.example.com/*' => Http::response('Bad sender id', 400)]);
        $this->enableHttpSms();
        Queue::fake();
        $id = $this->sender()->queue($this->org, '01712345678', 'order_placed', 'Hello');
        Queue::assertPushed(SendSmsJob::class, 1);

        $job = (new SendSmsJob($id, $this->org))->withFakeQueueInteractions();
        app()->call([$job, 'handle']);

        $message = $this->message($id);
        $this->assertSame(['failed', 'http_400', 1], [$message->status, $message->error, $message->attempts]);
        Http::assertSentCount(1);
    }

    public function test_server_errors_are_retried_then_failed(): void
    {
        Http::fake(['sms.example.com/*' => Http::response('busy', 503)]);
        $this->enableHttpSms();
        Queue::fake();
        $id = $this->sender()->queue($this->org, '01712345678', 'order_placed', 'Hello');

        foreach ([1, 2] as $attempt) {
            $job = (new SendSmsJob($id, $this->org))->withFakeQueueInteractions();
            $job->job->attempts = $attempt;
            try {
                app()->call([$job, 'handle']);
                $this->fail('A retryable failure is thrown so the queue tries again.');
            } catch (\RuntimeException $e) {
                $this->assertStringContainsString('http_503', $e->getMessage());
            }
            $this->assertSame(['queued', $attempt], [$this->message($id)->status, $this->message($id)->attempts]);
        }

        $job = (new SendSmsJob($id, $this->org))->withFakeQueueInteractions();
        $job->job->attempts = 3;
        app()->call([$job, 'handle']);
        $message = $this->message($id);
        $this->assertSame(['failed', 'http_503', 3, 503], [$message->status, $message->error, $message->attempts, $message->provider_status]);

        // A finished message is never sent again.
        app()->call([(new SendSmsJob($id, $this->org))->withFakeQueueInteractions(), 'handle']);
        Http::assertSentCount(3);

        $this->assertSame(3, (new SendSmsJob($id, $this->org))->tries);
        $this->assertSame([30, 120], (new SendSmsJob($id, $this->org))->backoff);
    }

    public function test_connection_errors_are_retryable(): void
    {
        Http::fake(fn () => throw new ConnectionException('cURL error 28: timed out https://sms.example.com/?api_key='.self::KEY));
        $this->enableHttpSms();

        $message = $this->message($this->sender()->queue($this->org, '01712345678', 'order_placed', 'Hello'));
        // The sync queue has one try only.
        $this->assertSame(['failed', 'connection_failed'], [$message->status, $message->error]);
        $this->assertStringNotContainsString(self::KEY, $this->allLogs());
    }

    public function test_private_and_local_gateway_addresses_are_refused(): void
    {
        Http::fake();
        $this->enableHttpSms();
        $this->dns['internal.example.com'] = ['10.1.2.3'];
        $this->dns['mixed.example.com'] = ['93.184.216.34', '192.168.1.5'];
        $this->dns['v6.example.com'] = ['::1'];
        $this->dns['mapped.example.com'] = ['::ffff:127.0.0.1'];

        foreach ([
            'https://127.0.0.1/send', 'https://10.0.0.8/send', 'https://169.254.169.254/latest/meta-data', 'https://localhost/send',
            'https://internal.example.com/send', 'https://mixed.example.com/send', 'https://v6.example.com/send', 'https://[::1]/send',
            'https://mapped.example.com/send', 'https://100.100.100.200/send', 'https://0.0.0.0/send',
        ] as $url) {
            DB::table('sms_settings')->update(['http_url' => $url]);
            $message = $this->message($this->sender()->queue($this->org, '01712345678', 'order_placed', 'Hello'));
            $this->assertSame(['failed', 'blocked_host'], [$message->status, $message->error], $url);
        }

        // A plain http address saved earlier (e.g. while allowed) is refused at send time.
        DB::table('sms_settings')->update(['http_url' => 'http://sms.example.com/send']);
        $message = $this->message($this->sender()->queue($this->org, '01712345678', 'order_placed', 'Hello'));
        $this->assertSame('blocked_host', $message->error);
        Http::assertNothingSent();

        // Development only: private hosts allowed.
        config(['sms.allow_private_hosts' => true]);
        DB::table('sms_settings')->update(['http_url' => 'https://127.0.0.1:8025/send']);
        $this->assertSame('sent', $this->message($this->sender()->queue($this->org, '01712345678', 'order_placed', 'Hello'))->status);
    }

    public function test_the_guard_ranges(): void
    {
        foreach (['93.184.216.34', '8.8.8.8', '2606:4700:4700::1111'] as $public) {
            $this->assertTrue(HostGuard::isPublic($public), $public);
        }
        foreach (['127.0.0.1', '10.0.0.1', '172.16.5.4', '192.168.0.1', '169.254.169.254', '100.64.0.1', '224.0.0.1', '255.255.255.255',
            '0.0.0.0', '::1', '::', 'fe80::1', 'fd00:ec2::254', 'ff02::1', '::ffff:10.0.0.1', '64:ff9b::7f00:1', 'not-an-ip'] as $private) {
            $this->assertFalse(HostGuard::isPublic($private), $private);
        }
    }

    public function test_redirects_are_never_followed(): void
    {
        Http::fake([
            'sms.example.com/*' => Http::response('', 302, ['Location' => 'http://169.254.169.254/latest/meta-data']),
            '169.254.169.254/*' => Http::response('secret', 200),
        ]);
        $this->enableHttpSms();

        $message = $this->message($this->sender()->queue($this->org, '01712345678', 'order_placed', 'Hello'));
        $this->assertSame(['failed', 'redirect_refused', 302], [$message->status, $message->error, $message->provider_status]);
        Http::assertSentCount(1);
    }

    public function test_dedupe_invalid_phones_and_switched_off_sms(): void
    {
        $this->assertNull($this->sender()->queue($this->org, '01712345678', 'order_placed', 'Off'));
        $this->assertDatabaseCount('sms_messages', 0);

        $this->enableSms();
        $first = $this->sender()->queue($this->org, '01712345678', 'order_placed', 'Order R-1 received', 'order:r1:order_placed');
        $this->assertNotNull($first);
        $this->assertNull($this->sender()->queue($this->org, '01712345678', 'order_placed', 'Order R-1 received', 'order:r1:order_placed'));
        $this->assertNull($this->sender()->queue($this->org, '01212345678', 'order_placed', 'Bad number'));
        $this->assertNull($this->sender()->queue($this->org, '01712345678', 'newsletter', 'Unknown purpose'));
        $this->assertDatabaseCount('sms_messages', 1);

        // Another organization may use the same key.
        $other = $this->provisionTenant('Other Shop');
        $this->actingAsUser($other['admin']);
        $this->enableSms();
        $this->assertNotNull($this->sender()->queue($other['organization']->id, '01712345678', 'order_placed', 'Hi', 'order:r1:order_placed'));
    }

    public function test_monthly_limit_skips_further_messages(): void
    {
        $this->enableSms(['monthly_limit' => 2]);
        $ids = [];
        for ($i = 1; $i <= 3; $i++) {
            $ids[] = $this->sender()->queue($this->org, '01712345678', 'order_placed', "Message {$i}");
        }

        $this->assertSame(['sent', 'sent', 'skipped'], array_map(fn ($id) => $this->message($id)->status, $ids));
        $this->assertSame('monthly_limit', $this->message($ids[2])->error);
        $this->assertSame(0, $this->message($ids[2])->attempts);

        // Last month's messages do not count.
        DB::table('sms_messages')->update(['created_at' => now()->subMonthsNoOverflow(1)->startOfMonth()]);
        $this->assertSame('sent', $this->message($this->sender()->queue($this->org, '01712345678', 'order_placed', 'New month'))->status);
    }

    public function test_order_event_templates(): void
    {
        $this->enableSms(['templates' => ['order_delivered' => ['enabled' => false], 'order_shipped' => ['bn' => '']]]);
        $orderId = '0195b8a0-0000-7000-8000-0000000000aa';
        $vars = ['name' => 'Rina', 'order' => 'W-1001', 'total' => '1,250.00', 'link' => 'https://shop.example.com/order/W-1001?token=abc'];

        $this->sender()->orderEvent($this->org, 'order_placed', '01712345678', 'en', $vars, $orderId);
        $this->assertSame('Berry Kids: Order W-1001 received. Total Tk 1,250.00. Track: https://shop.example.com/order/W-1001?token=abc', $this->lastLoggedText());
        $this->sender()->orderEvent($this->org, 'order_placed', '01712345678', 'en', $vars, $orderId);

        $this->sender()->orderEvent($this->org, 'order_cancelled', '01712345678', 'bn', $vars, $orderId);
        $this->assertSame('Berry Kids: অর্ডার W-1001 বাতিল করা হয়েছে। https://shop.example.com/order/W-1001?token=abc', $this->lastLoggedText());

        // An empty Bangla text falls back to English; a missing value collapses.
        $this->sender()->orderEvent($this->org, 'order_shipped', '01712345678', 'bn', $vars + ['courier' => 'Pathao', 'tracking' => null, 'tracking_link' => null], $orderId);
        $this->assertSame('Berry Kids: Order W-1001 handed to Pathao, tracking', $this->lastLoggedText());

        // Switched off / off by default / unknown event: nothing.
        $this->sender()->orderEvent($this->org, 'order_delivered', '01712345678', 'en', $vars, $orderId);
        $this->sender()->orderEvent($this->org, 'order_confirmed', '01712345678', 'en', $vars, $orderId);
        $this->sender()->orderEvent($this->org, 'order_lost', '01712345678', 'en', $vars, $orderId);

        $rows = SmsMessage::query()->withoutGlobalScopes()->orderBy('created_at')->get();
        $this->assertSame(['order_placed', 'order_cancelled', 'order_shipped'], $rows->pluck('purpose')->all());
        $this->assertSame(["order:{$orderId}:order_placed", "order:{$orderId}:order_cancelled", "order:{$orderId}:order_shipped"], $rows->pluck('dedupe_key')->all());
        $this->assertSame(['order'], $rows->pluck('related_type')->unique()->values()->all());
        $this->assertSame('unicode', $rows[1]->encoding);
    }

    public function test_template_rendering(): void
    {
        $this->assertSame('Shop: Hi Rina, {unknown} order', SmsTemplate::render('{shop}: Hi {name}, {unknown} {order} order', ['shop' => 'Shop', 'name' => 'Rina']));
        $this->assertSame('A B', SmsTemplate::render('A {tracking} {tracking_link} B', []));
        $this->assertSame(SmsTemplate::defaults()['order_placed']['en'], SmsTemplate::textFor('order_placed', ['enabled' => true, 'en' => '', 'bn' => ''], 'bn'));
        $this->assertSame('বাংলা', SmsTemplate::textFor('order_placed', ['enabled' => true, 'en' => 'English', 'bn' => 'বাংলা'], 'bn'));
        $this->assertSame('English', SmsTemplate::textFor('order_placed', ['enabled' => true, 'en' => 'English', 'bn' => 'বাংলা'], 'en'));
        $this->assertSame(SmsTemplate::defaults()['order_placed']['en'], SmsTemplate::textFor('order_placed', ['enabled' => true, 'en' => ' ', 'bn' => ''], 'bn'));
    }

    public function test_sms_parts(): void
    {
        $this->assertSame(['encoding' => 'gsm', 'length' => 0, 'segments' => 0], SmsText::analyze(''));
        $this->assertSame(['encoding' => 'gsm', 'length' => 160, 'segments' => 1], SmsText::analyze(str_repeat('a', 160)));
        $this->assertSame(['encoding' => 'gsm', 'length' => 161, 'segments' => 2], SmsText::analyze(str_repeat('a', 161)));
        $this->assertSame(['encoding' => 'gsm', 'length' => 306, 'segments' => 2], SmsText::analyze(str_repeat('a', 306)));
        $this->assertSame(['encoding' => 'gsm', 'length' => 307, 'segments' => 3], SmsText::analyze(str_repeat('a', 307)));
        // Extension characters count twice.
        $this->assertSame(['encoding' => 'gsm', 'length' => 160, 'segments' => 1], SmsText::analyze(str_repeat('a', 158).'€'));
        $this->assertSame(['encoding' => 'gsm', 'length' => 161, 'segments' => 2], SmsText::analyze(str_repeat('a', 159).'{'));
        $this->assertSame(['encoding' => 'gsm', 'length' => 18, 'segments' => 1], SmsText::analyze('^{}\\[~]|€'));
        $this->assertSame('gsm', SmsText::analyze("Price: £10 @ shop\nÉté ü")['encoding']);
        $this->assertSame(['encoding' => 'unicode', 'length' => 70, 'segments' => 1], SmsText::analyze(str_repeat('আ', 70)));
        $this->assertSame(['encoding' => 'unicode', 'length' => 71, 'segments' => 2], SmsText::analyze(str_repeat('আ', 71)));
        $this->assertSame(['encoding' => 'unicode', 'length' => 135, 'segments' => 3], SmsText::analyze(str_repeat('a', 134).'৳'));
        // One emoji is two UTF-16 units; ç (not GSM; only Ç is) is Unicode.
        $this->assertSame(['encoding' => 'unicode', 'length' => 2, 'segments' => 1], SmsText::analyze('😀'));
        $this->assertSame('unicode', SmsText::analyze('ç')['encoding']);
    }

    public function test_one_time_codes_are_stored_masked(): void
    {
        $this->enableSms();
        $id = $this->sender()->queue($this->org, '01712345678', 'otp', 'Berry Kids: your code is 987650.', maskedText: 'Berry Kids: your code is ••••••.');

        $message = $this->message($id);
        $this->assertSame('Berry Kids: your code is ••••••.', $message->body);
        $this->assertSame('sent', $message->status);
        // Segments of the real (GSM) text, not of the masked one.
        $this->assertSame('gsm', $message->encoding);
        $this->assertSame('Berry Kids: your code is 987650.', $this->lastLoggedText());
        $this->assertStringNotContainsString('987650', (string) DB::table('sms_messages')->get()->toJson());
    }

    public function test_jobs_carry_the_real_text_encrypted(): void
    {
        $this->enableSms();
        Queue::fake();
        $this->sender()->queue($this->org, '01712345678', 'otp', 'code 123456', maskedText: 'code ••••••');

        Queue::assertPushed(SendSmsJob::class, fn (SendSmsJob $job) => $job->text === 'code 123456' && $job->organizationId === $this->org);
        $this->assertInstanceOf(ShouldBeEncrypted::class, new SendSmsJob('x', 'y'));
    }

    public function test_retention(): void
    {
        $this->enableSms();
        $old = $this->sender()->queue($this->org, '01712345678', 'order_placed', 'Old');
        $new = $this->sender()->queue($this->org, '01712345678', 'order_placed', 'New');
        DB::table('sms_messages')->where('id', $old)->update(['created_at' => now()->subDays(181)]);
        app(TenantContext::class)->runAs($this->org, function () {
            DB::table('sms_otps')->insert([
                ['id' => (string) Str::uuid7(), 'organization_id' => $this->org, 'phone' => '01712345678', 'purpose' => 'login', 'code_hash' => str_repeat('a', 64), 'attempts' => 0, 'expires_at' => now()->subDays(2), 'created_at' => now()->subDays(2)],
                ['id' => (string) Str::uuid7(), 'organization_id' => $this->org, 'phone' => '01712345678', 'purpose' => 'login', 'code_hash' => str_repeat('b', 64), 'attempts' => 0, 'expires_at' => now()->addMinutes(5), 'created_at' => now()],
            ]);
        });

        $this->assertSame(1, (new PruneSmsRecords)->prune(true));
        $this->assertDatabaseCount('sms_otps', 2);

        $counts = app(PruneRecords::class)();
        $this->assertSame(1, $counts['sms_messages']);
        $this->assertSame([$new], DB::table('sms_messages')->pluck('id')->all());
        $this->assertDatabaseCount('sms_otps', 1);

        config(['pos.retention.sms_messages' => 0]);
        $this->assertNull((new PruneSmsRecords)->prune(false));
    }

    public function test_the_gateway_strips_the_key_from_answers(): void
    {
        $this->assertSame('ok [hidden] [hidden]', HttpSmsGateway::clean("ok\n".self::KEY.' '.self::KEY, self::KEY));
        $this->assertSame('x [hidden]', HttpSmsGateway::clean('x a%2Fb%2Bc', 'a/b+c'));
        $this->assertSame(500, mb_strlen(HttpSmsGateway::clean(str_repeat('x', 900), null)));
        $settings = new SmsSettingsData('org', 'http', paramTo: 'to', paramMessage: 'msg');
        $this->assertSame(['to' => '8801712345678', 'msg' => 'Hi'], (new HttpSmsGateway(app(Factory::class), app(HostGuard::class)))->params($settings, '01712345678', 'Hi'));
    }
}
