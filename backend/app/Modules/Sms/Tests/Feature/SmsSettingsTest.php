<?php

namespace App\Modules\Sms\Tests\Feature;

use App\Modules\Sms\Application\Contracts\SmsSender;
use App\Modules\Sms\Domain\SmsTemplate;
use App\Modules\Sms\Infrastructure\Models\SmsMessage;
use App\Modules\Sms\Tests\Concerns\BuildsSms;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * BD1a: Settings → SMS — defaults, saving, the write-only API key (never in a response, the
 * audit trail, a log or a stored provider answer), validation, permissions, the test message,
 * the message log and organization isolation.
 */
class SmsSettingsTest extends TestCase
{
    use BuildsSms, RefreshDatabase;

    private const KEY = 'KEY-SECRET-123456';

    /** @var array<string, mixed> */
    private array $tenant;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpSms();
        Http::preventStrayRequests();
        $this->tenant = $this->provisionTenant('Berry Kids');
        $this->actingAsUser($this->tenant['admin']);
    }

    public function test_defaults_before_the_first_save(): void
    {
        $data = $this->getJson('/api/v1/sms/settings')->assertOk()->json('data');

        $this->assertFalse($data['is_enabled']);
        $this->assertSame('log', $data['driver']);
        $this->assertSame('POST', $data['http_method']);
        $this->assertSame('form', $data['http_body']);
        $this->assertSame(['to', 'message'], [$data['param_to'], $data['param_message']]);
        $this->assertSame('880', $data['phone_format']);
        $this->assertFalse($data['api_key_set']);
        $this->assertSame([], $data['extra_params']);
        $this->assertFalse($data['ready']);
        $this->assertFalse($data['otp_ready']);
        $this->assertSame(['month_sent' => 0, 'month_failed' => 0, 'month_segments' => 0], $data['usage']);
        $this->assertSame(SmsTemplate::PLACEHOLDERS, $data['placeholders']);
        $this->assertSame(SmsTemplate::defaults(), $data['templates']);
        $this->assertSame(SmsTemplate::defaults(), $data['default_templates']);
        $this->assertTrue($data['templates']['order_placed']['enabled']);
        $this->assertFalse($data['templates']['order_confirmed']['enabled']);
        $this->assertArrayNotHasKey('api_key', $data);
        $this->assertDatabaseCount('sms_settings', 0);
    }

    public function test_saving_settings_and_the_write_only_api_key(): void
    {
        $response = $this->patchJson('/api/v1/sms/settings', [
            'is_enabled' => true,
            'driver' => 'http',
            'http_url' => 'https://sms.example.com/api/send',
            'http_method' => 'GET',
            'param_to' => 'msisdn',
            'param_message' => 'sms',
            'param_api_key' => 'api_key',
            'api_key' => self::KEY,
            'param_sender' => 'senderid',
            'sender_id' => 'BERRY',
            'extra_params' => ['type' => 'text', 'label' => 'transactional'],
            'success_contains' => 'SUCCESS',
            'phone_format' => 'plus880',
            'monthly_limit' => 2000,
            'templates' => ['order_confirmed' => ['enabled' => true], 'order_placed' => ['bn' => '{shop}: অর্ডার {order}']],
        ])->assertOk();

        $data = $response->json('data');
        $this->assertTrue($data['ready']);
        $this->assertTrue($data['otp_ready']);
        $this->assertTrue($data['api_key_set']);
        $this->assertSame(['type' => 'text', 'label' => 'transactional'], $data['extra_params']);
        $this->assertSame('plus880', $data['phone_format']);
        $this->assertSame(2000, $data['monthly_limit']);
        $this->assertTrue($data['templates']['order_confirmed']['enabled']);
        $this->assertSame('{shop}: অর্ডার {order}', $data['templates']['order_placed']['bn']);
        $this->assertSame(SmsTemplate::defaults()['order_placed']['en'], $data['templates']['order_placed']['en']);
        $this->assertStringNotContainsString(self::KEY, $response->getContent());

        // Encrypted at rest.
        $raw = DB::table('sms_settings')->value('api_key');
        $this->assertNotSame(self::KEY, $raw);
        $this->assertStringNotContainsString(self::KEY, (string) $raw);

        // Audited with the changed keys, never the key.
        $audit = DB::table('audit_logs')->where('action', 'sms.settings_updated')->latest('created_at')->first();
        $this->assertNotNull($audit);
        $this->assertStringNotContainsString(self::KEY, json_encode($audit));
        $this->assertTrue(json_decode((string) $audit->context, true)['api_key_changed']);

        // Omitted keeps the key; the GET never shows it.
        $this->patchJson('/api/v1/sms/settings', ['sender_id' => 'BERRY2'])->assertOk()->assertJsonPath('data.api_key_set', true);
        $show = $this->getJson('/api/v1/sms/settings')->assertOk();
        $this->assertStringNotContainsString(self::KEY, $show->getContent());
        $last = DB::table('audit_logs')->where('action', 'sms.settings_updated')->orderByDesc('created_at')->orderByDesc('id')->first();
        $this->assertArrayNotHasKey('api_key_changed', json_decode((string) $last->context, true) ?? []);

        // null clears it.
        $this->patchJson('/api/v1/sms/settings', ['api_key' => null])->assertOk()->assertJsonPath('data.api_key_set', false);
        $this->assertNull(DB::table('sms_settings')->value('api_key'));
        $this->assertStringNotContainsString(self::KEY, DB::table('audit_logs')->get()->toJson());
        $this->assertStringNotContainsString(self::KEY, $this->allLogs());
    }

    public function test_validation(): void
    {
        $invalid = fn (array $body, string $field) => $this->patchJson('/api/v1/sms/settings', $body)
            ->assertStatus(422)->assertJsonValidationErrors([$field], 'error.details');

        $invalid(['http_url' => 'http://sms.example.com/send'], 'http_url');
        $invalid(['http_url' => 'not a url'], 'http_url');
        $invalid(['http_url' => 'https://example.com/'.str_repeat('a', 500)], 'http_url');
        $invalid(['is_enabled' => true, 'driver' => 'http'], 'http_url');
        $invalid(['driver' => 'smpp'], 'driver');
        $invalid(['http_method' => 'PUT'], 'http_method');
        $invalid(['param_to' => 'to number'], 'param_to');
        $invalid(['param_api_key' => str_repeat('k', 41)], 'param_api_key');
        $invalid(['sender_id' => str_repeat('S', 21)], 'sender_id');
        $invalid(['phone_format' => '0088'], 'phone_format');
        $invalid(['monthly_limit' => 0], 'monthly_limit');
        $invalid(['monthly_limit' => 1000001], 'monthly_limit');
        $invalid(['extra_params' => array_combine(range('a', 'k'), range('a', 'k'))], 'extra_params');
        $invalid(['extra_params' => ['bad name' => 'x']], 'extra_params');
        $invalid(['templates' => ['order_placed' => ['en' => str_repeat('x', 481)]]], 'templates.order_placed.en');
        $invalid(['templates' => ['order_lost' => ['en' => 'x']]], 'templates');

        // Plain http only when allowed, and never in production.
        config(['sms.allow_insecure_http' => true]);
        $this->patchJson('/api/v1/sms/settings', ['http_url' => 'http://sms.example.com/send'])->assertOk();
        $this->app['env'] = 'production';
        try {
            $invalid(['http_url' => 'http://sms.example.com/send2'], 'http_url');
        } finally {
            $this->app['env'] = 'testing';
        }
        $this->assertDatabaseCount('sms_settings', 1);
    }

    public function test_permissions(): void
    {
        $org = $this->tenant['organization'];
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier);
        $storeManager = $this->createUserWithRole($org, SystemRole::OnlineStoreManager);
        $branchManager = $this->createUserWithRole($org, SystemRole::BranchManager);

        $this->actingAsUser($cashier);
        $this->getJson('/api/v1/sms/settings')->assertForbidden();
        $this->getJson('/api/v1/sms/messages')->assertForbidden();

        foreach ([$storeManager, $branchManager] as $manager) {
            $this->actingAsUser($manager);
            $this->getJson('/api/v1/sms/settings')->assertOk();
            $this->getJson('/api/v1/sms/messages')->assertOk();
            $this->patchJson('/api/v1/sms/settings', ['is_enabled' => true])->assertForbidden();
            $this->postJson('/api/v1/sms/test', ['phone' => '01712345678'])->assertForbidden();
        }
    }

    public function test_test_message_in_test_mode_and_over_http(): void
    {
        $this->postJson('/api/v1/sms/test', ['phone' => '01712345678'])->assertStatus(422)->assertJsonPath('error.code', 'SMS_UNAVAILABLE');

        $this->enableSms();
        $this->postJson('/api/v1/sms/test', ['phone' => '+8801712345678'])->assertOk()
            ->assertJsonPath('data.status', 'sent')
            ->assertJsonPath('data.encoding', 'gsm')
            ->assertJsonPath('data.segments', 1);
        $this->assertSame('Berry Kids: test message from your POS.', $this->lastLoggedText());
        $this->postJson('/api/v1/sms/test', ['phone' => '0123'])->assertStatus(422)->assertJsonValidationErrors(['phone'], 'error.details');

        $answer = ['{"status":"SUCCESS","echo":"api_key='.self::KEY.'"}', 200];
        Http::fake(function () use (&$answer) {
            return Http::response(...$answer);
        });
        $this->enableHttpSms(['success_contains' => 'SUCCESS']);
        $result = $this->postJson('/api/v1/sms/test', ['phone' => '01712345678', 'message' => 'আসসালামু আলাইকুম'])->assertOk()->json('data');
        $this->assertSame('sent', $result['status']);
        $this->assertSame(200, $result['provider_status']);
        $this->assertSame('unicode', $result['encoding']);
        $this->assertStringNotContainsString(self::KEY, (string) $result['provider_response']);
        $this->assertStringContainsString('[hidden]', (string) $result['provider_response']);
        $this->assertStringNotContainsString(self::KEY, (string) DB::table('sms_messages')->pluck('provider_response')->implode(' '));
        $this->assertStringNotContainsString(self::KEY, $this->allLogs());

        $answer = ['Invalid API key', 401];
        $this->postJson('/api/v1/sms/test', ['phone' => '01712345678'])->assertOk()
            ->assertJsonPath('data.status', 'failed')->assertJsonPath('data.error', 'http_401')->assertJsonPath('data.provider_status', 401);

        $this->assertSame(['test'], SmsMessage::query()->withoutGlobalScopes()->distinct()->pluck('purpose')->all());
    }

    public function test_test_messages_are_rate_limited(): void
    {
        $this->enableSms();
        for ($i = 0; $i < 5; $i++) {
            $this->postJson('/api/v1/sms/test', ['phone' => '01712345678'])->assertOk();
        }
        $this->postJson('/api/v1/sms/test', ['phone' => '01712345678'])->assertStatus(429);
    }

    public function test_message_log_filters_and_usage(): void
    {
        $this->enableSms();
        $orgId = $this->tenant['organization']->id;
        $sender = app(SmsSender::class);
        $sender->queue($orgId, '01712345678', 'order_placed', 'Order A received', 'order:a:order_placed', 'order', '0195b8a0-0000-7000-8000-000000000001');
        $sender->queue($orgId, '01812345678', 'order_shipped', 'Order B shipped');
        DB::table('sms_messages')->where('to_phone', '01812345678')->update(['status' => 'failed', 'error' => 'http_500']);
        DB::table('sms_messages')->where('to_phone', '01812345678')->update(['created_at' => now()->subDays(3)]);

        $rows = $this->getJson('/api/v1/sms/messages')->assertOk()->assertJsonPath('meta.pagination.total', 2)->json('data');
        $this->assertSame('01712345678', $rows[0]['to_phone']);
        $this->assertSame(['type' => 'order', 'id' => '0195b8a0-0000-7000-8000-000000000001'], $rows[0]['related']);
        $this->assertSame('sent', $rows[0]['status']);
        $this->assertSame('log', $rows[0]['driver']);
        $this->assertSame(1, $rows[0]['attempts']);
        $this->assertNull($rows[1]['related']);

        $this->getJson('/api/v1/sms/messages?status=failed')->assertJsonPath('meta.pagination.total', 1)->assertJsonPath('data.0.to_phone', '01812345678');
        $this->getJson('/api/v1/sms/messages?purpose=order_placed')->assertJsonPath('meta.pagination.total', 1);
        $this->getJson('/api/v1/sms/messages?search=+880 1812')->assertJsonPath('meta.pagination.total', 1)->assertJsonPath('data.0.to_phone', '01812345678');
        $this->getJson('/api/v1/sms/messages?from='.now()->subDay()->toDateString())->assertJsonPath('meta.pagination.total', 1)->assertJsonPath('data.0.to_phone', '01712345678');
        $this->getJson('/api/v1/sms/messages?to='.now()->subDays(2)->toDateString())->assertJsonPath('meta.pagination.total', 1)->assertJsonPath('data.0.to_phone', '01812345678');
        $this->getJson('/api/v1/sms/messages?status=lost')->assertStatus(422);

        $this->getJson('/api/v1/sms/settings')->assertJsonPath('data.usage', ['month_sent' => 1, 'month_failed' => now()->subDays(3)->month === now()->month ? 1 : 0, 'month_segments' => 1]);
    }

    public function test_organizations_never_see_or_use_each_others_settings_and_messages(): void
    {
        $this->enableHttpSms();
        $orgA = $this->tenant['organization']->id;
        Http::fake(['sms.example.com/*' => Http::response('OK', 200)]);
        $this->assertNotNull(app(SmsSender::class)->queue($orgA, '01712345678', 'order_placed', 'Hello from A'));

        $other = $this->provisionTenant('Other Shop');
        $this->actingAsUser($other['admin']);
        $data = $this->getJson('/api/v1/sms/settings')->assertOk()->json('data');
        $this->assertFalse($data['is_enabled']);
        $this->assertNull($data['http_url']);
        $this->assertFalse($data['api_key_set']);
        $this->getJson('/api/v1/sms/messages')->assertOk()->assertJsonPath('meta.pagination.total', 0);

        // B's sends never use A's gateway: B is off, so nothing is queued.
        $sender = app(SmsSender::class);
        $this->assertFalse($sender->ready($other['organization']->id));
        $this->assertNull($sender->queue($other['organization']->id, '01712345678', 'order_placed', 'Hello from B'));

        // B in test mode sends through the log, A's HTTP gateway sees one request only.
        $this->enableSms();
        $sender->queue($other['organization']->id, '01712345678', 'order_placed', 'Hello from B');
        Http::assertSentCount(1);
        $this->assertSame('Hello from B', $this->lastLoggedText());
        $this->assertSame(1, SmsMessage::query()->withoutGlobalScopes()->where('organization_id', $other['organization']->id)->count());

        // A's admin does not see B's message.
        $this->actingAsUser($this->tenant['admin']);
        $this->getJson('/api/v1/sms/messages')->assertJsonPath('meta.pagination.total', 1)->assertJsonPath('data.0.body', 'Hello from A');
        Http::assertSent(fn (HttpRequest $r) => str_starts_with($r->url(), 'https://sms.example.com/api/send'));
    }
}
