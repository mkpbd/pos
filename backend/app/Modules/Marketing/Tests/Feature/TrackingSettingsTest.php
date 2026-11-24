<?php

namespace App\Modules\Marketing\Tests\Feature;

use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * BD1c: Marketing → Tracking & pixels — defaults, validation, the write-only Conversions API
 * token (never in a response, the audit trail or a log), the pasted code that only holders of
 * storefront.custom_html may change, permissions, the test event and organization isolation.
 */
class TrackingSettingsTest extends TestCase
{
    use InteractsWithTenancy, RefreshDatabase;

    private const TOKEN = 'EAAG-SECRET-TOKEN-123456';

    private const URL = '/api/v1/marketing/tracking';

    /** @var array<string, mixed> */
    private array $tenant;

    /** @var list<array{message: string, context: array<string, mixed>}> */
    private array $logged = [];

    protected function setUp(): void
    {
        parent::setUp();
        Http::preventStrayRequests();
        Event::listen(MessageLogged::class, function (MessageLogged $e) {
            $this->logged[] = ['message' => $e->message, 'context' => $e->context];
        });
        $this->tenant = $this->provisionTenant('Berry Kids');
        $this->actingAsUser($this->tenant['admin']);
    }

    public function test_defaults_before_the_first_save(): void
    {
        $data = $this->getJson(self::URL)->assertOk()->json('data');

        $this->assertSame([
            'meta_pixel_id' => null, 'meta_capi_enabled' => false, 'meta_capi_token_set' => false, 'meta_test_event_code' => null,
            'ga4_measurement_id' => null, 'tiktok_pixel_id' => null, 'head_code' => null, 'body_code' => null,
            'capi_last_status' => null, 'capi_last_error' => null, 'capi_last_sent_at' => null, 'updated_at' => null, 'can_edit_code' => true,
        ], $data);
        $this->assertDatabaseCount('tracking_settings', 0);
    }

    public function test_saving_settings_and_the_write_only_token(): void
    {
        $response = $this->patchJson(self::URL, [
            'meta_pixel_id' => ' 123456789012345 ',
            'meta_capi_enabled' => true,
            'meta_capi_token' => self::TOKEN,
            'meta_test_event_code' => 'TEST12345',
            'ga4_measurement_id' => 'g-abc123xyz9',
            'tiktok_pixel_id' => 'c4abcdefgh1234567890',
            'head_code' => '<script>console.log("head")</script>',
            'body_code' => '<noscript><img src="https://example.test/p.gif"></noscript>',
        ])->assertOk();

        $data = $response->json('data');
        $this->assertSame(['123456789012345', true, true, 'TEST12345', 'G-ABC123XYZ9', 'C4ABCDEFGH1234567890'], [
            $data['meta_pixel_id'], $data['meta_capi_enabled'], $data['meta_capi_token_set'], $data['meta_test_event_code'], $data['ga4_measurement_id'], $data['tiktok_pixel_id'],
        ]);
        $this->assertSame('<script>console.log("head")</script>', $data['head_code']);
        $this->assertArrayNotHasKey('meta_capi_token', $data);
        $this->assertStringNotContainsString(self::TOKEN, $response->getContent());
        $this->assertSame($this->tenant['admin']->id, DB::table('tracking_settings')->value('updated_by'));

        // Encrypted at rest.
        $raw = (string) DB::table('tracking_settings')->value('meta_capi_token');
        $this->assertNotSame('', $raw);
        $this->assertStringNotContainsString(self::TOKEN, $raw);

        // Audited with the changed keys — never the token or the code.
        $audit = DB::table('audit_logs')->where('action', 'tracking.settings_updated')->first();
        $this->assertNotNull($audit);
        $json = json_encode($audit);
        $this->assertStringNotContainsString(self::TOKEN, $json);
        $this->assertStringNotContainsString('console.log', $json);
        $context = json_decode((string) $audit->context, true);
        ksort($context);
        $this->assertSame(['body_code_changed' => true, 'head_code_changed' => true, 'token_changed' => true], $context);
        $this->assertSame('123456789012345', json_decode((string) $audit->new_values, true)['meta_pixel_id']);

        // Omitted keeps the token; the GET never shows it.
        $this->patchJson(self::URL, ['meta_test_event_code' => 'TEST999'])->assertOk()->assertJsonPath('data.meta_capi_token_set', true);
        $this->assertStringNotContainsString(self::TOKEN, $this->getJson(self::URL)->assertOk()->getContent());
        $last = DB::table('audit_logs')->where('action', 'tracking.settings_updated')->orderByDesc('created_at')->orderByDesc('id')->first();
        $this->assertSame([], json_decode((string) $last->context, true) ?? []);

        // Saving the same values again changes nothing and writes no audit entry.
        $count = DB::table('audit_logs')->where('action', 'tracking.settings_updated')->count();
        $this->patchJson(self::URL, ['meta_pixel_id' => '123456789012345', 'head_code' => '<script>console.log("head")</script>'])->assertOk();
        $this->assertSame($count, DB::table('audit_logs')->where('action', 'tracking.settings_updated')->count());

        // Clearing the token while the Conversions API is on → 422; switched off with it, fine.
        $this->patchJson(self::URL, ['meta_capi_token' => null])->assertStatus(422)->assertJsonValidationErrors(['meta_capi_enabled'], 'error.details');
        $this->patchJson(self::URL, ['meta_capi_token' => '', 'meta_capi_enabled' => false])->assertOk()
            ->assertJsonPath('data.meta_capi_token_set', false)->assertJsonPath('data.meta_capi_enabled', false);
        $this->assertNull(DB::table('tracking_settings')->value('meta_capi_token'));

        // Clearing the code.
        $this->patchJson(self::URL, ['head_code' => '  ', 'body_code' => null])->assertOk()->assertJsonPath('data.head_code', null)->assertJsonPath('data.body_code', null);

        $this->assertStringNotContainsString(self::TOKEN, DB::table('audit_logs')->get()->toJson());
        $this->assertStringNotContainsString(self::TOKEN, (string) json_encode($this->logged));
    }

    public function test_validation(): void
    {
        $this->patchJson(self::URL, [
            'meta_pixel_id' => '12345',
            'meta_capi_enabled' => 'maybe',
            'meta_test_event_code' => 'TEST 1',
            'ga4_measurement_id' => 'UA-12345-1',
            'tiktok_pixel_id' => 'short',
            'head_code' => str_repeat('a', 20001),
            'body_code' => ['x'],
        ])->assertStatus(422)->assertJsonValidationErrors([
            'meta_pixel_id', 'meta_capi_enabled', 'meta_test_event_code', 'ga4_measurement_id', 'tiktok_pixel_id', 'head_code', 'body_code',
        ], 'error.details');

        // The Conversions API needs a pixel id and a token.
        $this->patchJson(self::URL, ['meta_capi_enabled' => true])->assertStatus(422)->assertJsonValidationErrors(['meta_capi_enabled'], 'error.details');
        $this->patchJson(self::URL, ['meta_capi_enabled' => true, 'meta_pixel_id' => '1234567890'])->assertStatus(422);
        $this->patchJson(self::URL, ['meta_capi_enabled' => true, 'meta_capi_token' => self::TOKEN])->assertStatus(422);
        $this->assertDatabaseCount('tracking_settings', 0);

        // Exactly 20 000 characters of code is fine.
        $this->patchJson(self::URL, ['head_code' => str_repeat('a', 20000)])->assertOk();
    }

    public function test_only_custom_html_holders_change_the_code(): void
    {
        $this->patchJson(self::URL, ['head_code' => '<script>a()</script>'])->assertOk();

        // The online store manager has marketing.* but not storefront.custom_html.
        $manager = $this->createUserWithRole($this->tenant['organization'], SystemRole::OnlineStoreManager);
        $this->actingAsUser($manager);
        $this->getJson(self::URL)->assertOk()->assertJsonPath('data.can_edit_code', false)->assertJsonPath('data.head_code', '<script>a()</script>');

        $this->patchJson(self::URL, ['head_code' => '<script>evil()</script>'])->assertForbidden()->assertJsonPath('error.code', 'CUSTOM_HTML_FORBIDDEN');
        $this->patchJson(self::URL, ['meta_pixel_id' => '1234567890', 'body_code' => '<img src=x>'])->assertForbidden();
        $this->assertSame('<script>a()</script>', DB::table('tracking_settings')->value('head_code'));
        $this->assertNull(DB::table('tracking_settings')->value('meta_pixel_id'));

        // The pixel ids are theirs; sending the stored code back unchanged is fine.
        $this->patchJson(self::URL, ['meta_pixel_id' => '1234567890', 'head_code' => '<script>a()</script>', 'body_code' => null])->assertOk()
            ->assertJsonPath('data.meta_pixel_id', '1234567890')->assertJsonPath('data.can_edit_code', false);
    }

    public function test_permissions(): void
    {
        $org = $this->tenant['organization'];
        $cashier = $this->createUserWithRole($org, SystemRole::Cashier);
        $accountant = $this->createUserWithRole($org, SystemRole::Accountant);

        foreach ([$cashier, $accountant] as $user) {
            $this->actingAsUser($user);
            $this->getJson(self::URL)->assertForbidden();
            $this->patchJson(self::URL, ['meta_pixel_id' => '1234567890'])->assertForbidden();
            $this->postJson(self::URL.'/test')->assertForbidden();
        }

        $this->app['auth']->forgetGuards();
        $this->getJson(self::URL)->assertUnauthorized();
    }

    public function test_the_test_event(): void
    {
        $this->postJson(self::URL.'/test')->assertStatus(422)
            ->assertJsonValidationErrors(['meta_pixel_id', 'meta_capi_token', 'meta_test_event_code'], 'error.details');
        $this->patchJson(self::URL, ['meta_pixel_id' => '123456789012345', 'meta_capi_token' => self::TOKEN])->assertOk();
        $this->postJson(self::URL.'/test')->assertStatus(422)->assertJsonValidationErrors(['meta_test_event_code'], 'error.details');
        $this->patchJson(self::URL, ['meta_test_event_code' => 'TEST12345'])->assertOk();

        $answer = [['events_received' => 1], 200];
        Http::fake(['graph.facebook.com/*' => function () use (&$answer) {
            return Http::response(...$answer);
        }]);

        $this->postJson(self::URL.'/test', [], ['User-Agent' => 'TestBrowser/1.0'])->assertOk()
            ->assertJsonPath('data.status', 'sent')->assertJsonPath('data.error', null);
        Http::assertSent(function (HttpRequest $request) {
            $body = json_decode($request->body(), true);

            return $request->url() === 'https://graph.facebook.com/v21.0/123456789012345/events'
                && $request->method() === 'POST'
                && ! str_contains($request->url(), self::TOKEN)
                && $body['access_token'] === self::TOKEN
                && $body['test_event_code'] === 'TEST12345'
                && $body['data'][0]['event_name'] === 'PageView'
                && $body['data'][0]['action_source'] === 'website'
                && $body['data'][0]['user_data']['client_user_agent'] === 'TestBrowser/1.0'
                && $body['data'][0]['user_data']['country'] === [hash('sha256', 'bd')];
        });
        $data = $this->getJson(self::URL)->json('data');
        $this->assertSame(['sent', null], [$data['capi_last_status'], $data['capi_last_error']]);
        $this->assertNotNull($data['capi_last_sent_at']);

        // A refused event: the reason without the token.
        $answer = [['error' => ['message' => 'Invalid OAuth access token - '.self::TOKEN, 'code' => 190]], 400];
        $result = $this->postJson(self::URL.'/test')->assertOk()->json('data');
        $this->assertSame('failed', $result['status']);
        $this->assertStringStartsWith('http_400: Invalid OAuth access token', (string) $result['error']);
        $this->assertStringContainsString('[hidden]', (string) $result['error']);
        $this->assertStringNotContainsString(self::TOKEN, (string) $result['error']);
        $this->assertSame('failed', DB::table('tracking_settings')->value('capi_last_status'));
        $this->assertStringNotContainsString(self::TOKEN, (string) json_encode($this->logged));

        // A redirect is never followed.
        $answer = ['', 302, ['Location' => 'https://elsewhere.example.test/']];
        $this->postJson(self::URL.'/test')->assertOk()->assertJsonPath('data.status', 'failed')->assertJsonPath('data.error', 'redirect_refused');
        Http::assertNotSent(fn (HttpRequest $r) => str_contains($r->url(), 'elsewhere'));
    }

    public function test_test_events_are_rate_limited(): void
    {
        Http::fake(['graph.facebook.com/*' => Http::response(['events_received' => 1], 200)]);
        $this->patchJson(self::URL, ['meta_pixel_id' => '123456789012345', 'meta_capi_token' => self::TOKEN, 'meta_test_event_code' => 'TEST1'])->assertOk();
        for ($i = 0; $i < 5; $i++) {
            $this->postJson(self::URL.'/test')->assertOk();
        }
        $this->postJson(self::URL.'/test')->assertStatus(429);
    }

    public function test_organizations_never_see_each_others_settings(): void
    {
        $this->patchJson(self::URL, ['meta_pixel_id' => '123456789012345', 'meta_capi_token' => self::TOKEN, 'meta_capi_enabled' => true, 'head_code' => '<script>berry()</script>'])->assertOk();

        $other = $this->provisionTenant('Other Shop');
        $this->actingAsUser($other['admin']);
        $data = $this->getJson(self::URL)->assertOk()->json('data');
        $this->assertSame([null, false, false, null], [$data['meta_pixel_id'], $data['meta_capi_enabled'], $data['meta_capi_token_set'], $data['head_code']]);
        $this->postJson(self::URL.'/test')->assertStatus(422);

        $this->patchJson(self::URL, ['meta_pixel_id' => '9999999999'])->assertOk();
        $this->assertSame(2, DB::table('tracking_settings')->count());
        $this->assertSame('123456789012345', DB::table('tracking_settings')->where('organization_id', $this->tenant['organization']->id)->value('meta_pixel_id'));
    }
}
