<?php

namespace App\Modules\Social\Tests\Feature;

use App\Modules\Social\Application\Actions\ConnectMeta;
use App\Modules\Social\Infrastructure\Meta\SandboxMetaGraphClient;
use App\Modules\Social\Infrastructure\Models\SocialAccount;
use App\Modules\Social\Tests\Concerns\BuildsSocial;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * P2b: social settings (write-only, encrypted app secret), the sandbox connection and the live
 * Facebook Login flow (state bound to user and organization, code → long-lived token → Pages),
 * choosing a Page, disconnecting — and secrets never reaching responses, the audit trail or logs.
 */
class SocialConnectTest extends TestCase
{
    use BuildsSocial, RefreshDatabase;

    private const SECRET = 'app-secret-0123456789abcdef';

    private const PAGE_TOKEN = 'EAAPageTokenValue0123456789';

    private const USER_TOKEN = 'EAAUserTokenValue0123456789';

    /** @var array<string, mixed> */
    private array $shop;

    /** @var list<string> */
    private array $logged = [];

    protected function setUp(): void
    {
        parent::setUp();
        Http::preventStrayRequests();
        config(['app.url' => 'https://admin.example.com']);
        $this->shop = $this->socialShop();
        Event::listen(MessageLogged::class, function (MessageLogged $e) {
            $this->logged[] = $e->message.' '.json_encode($e->context);
        });
    }

    private function goLive(): void
    {
        $this->patchJson('/api/v1/social/settings', ['mode' => 'live', 'meta_app_id' => '1234567890', 'meta_app_secret' => self::SECRET])->assertOk();
    }

    /** @var list<array<string, mixed>> what /me/accounts answers */
    private array $graphPages = [];

    private bool $exchangeFails = false;

    /** @var list<HttpRequest> every request the faked Graph API received */
    private array $recorded = [];

    /**
     * @param  list<array<string, mixed>>  $pages
     */
    private function fakeFacebookLogin(array $pages): void
    {
        $this->graphPages = $pages;
        Http::fake(function (HttpRequest $request) {
            $this->recorded[] = $request;
            $path = (string) parse_url($request->url(), PHP_URL_PATH);
            if ($path === '/v21.0/oauth/access_token' && $this->exchangeFails) {
                return Http::response(['error' => ['message' => 'Invalid verification code format.', 'type' => 'OAuthException', 'code' => 100, 'fbtrace_id' => 'AbC']], 400);
            }

            return match ($path) {
                '/v21.0/oauth/access_token' => ($request->data()['grant_type'] ?? null) === 'fb_exchange_token'
                    ? Http::response(['access_token' => self::USER_TOKEN, 'token_type' => 'bearer', 'expires_in' => 5184000])
                    : Http::response(['access_token' => 'EAAShortLivedToken0123', 'token_type' => 'bearer', 'expires_in' => 3600]),
                '/v21.0/me/accounts' => Http::response(['data' => $this->graphPages]),
                default => Http::response(['error' => ['message' => 'Unknown path', 'code' => 100]], 400),
            };
        });
    }

    /**
     * The state the connect step sent to Facebook.
     */
    private function startLiveConnect(): string
    {
        $location = (string) $this->get('/api/v1/social/meta/connect')->assertStatus(302)->headers->get('Location');
        $this->assertStringStartsWith('https://www.facebook.com/v21.0/dialog/oauth?', $location);
        parse_str((string) parse_url($location, PHP_URL_QUERY), $query);
        $this->assertSame(['1234567890', 'https://admin.example.com/api/v1/social/meta/callback', 'code'], [$query['client_id'], $query['redirect_uri'], $query['response_type']]);
        $this->assertSame('pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish,business_management', $query['scope']);
        $this->assertStringNotContainsString(self::SECRET, $location);

        return $query['state'];
    }

    public function test_settings_keep_the_app_secret_write_only_and_encrypted(): void
    {
        $this->getJson('/api/v1/social/settings')->assertOk()->assertJsonPath('data', [
            'mode' => 'sandbox', 'meta_app_id' => null, 'secret_set' => false, 'graph_version' => 'v21.0',
            'redirect_uri' => 'https://admin.example.com/api/v1/social/meta/callback', 'live_ready' => false, 'updated_at' => null,
        ]);

        // Live mode needs both.
        $this->patchJson('/api/v1/social/settings', ['mode' => 'live'])->assertStatus(422)->assertJsonValidationErrors(['meta_app_id', 'meta_app_secret'], 'error.details');
        $this->patchJson('/api/v1/social/settings', ['meta_app_id' => 'abc'])->assertStatus(422)->assertJsonValidationErrors('meta_app_id', 'error.details');
        $this->patchJson('/api/v1/social/settings', ['graph_version' => '21'])->assertStatus(422)->assertJsonValidationErrors('graph_version', 'error.details');

        $response = $this->patchJson('/api/v1/social/settings', ['mode' => 'live', 'meta_app_id' => '1234567890', 'meta_app_secret' => self::SECRET, 'graph_version' => 'v22.0'])->assertOk();
        $this->assertSame(['live', '1234567890', true, 'v22.0', true], [
            $response->json('data.mode'), $response->json('data.meta_app_id'), $response->json('data.secret_set'), $response->json('data.graph_version'), $response->json('data.live_ready'),
        ]);
        $this->assertStringNotContainsString(self::SECRET, $response->getContent());
        $this->assertStringNotContainsString(self::SECRET, $this->getJson('/api/v1/social/settings')->getContent());

        // Encrypted at rest; omitted keeps it, "" clears it (not allowed while live).
        $raw = (string) DB::table('social_settings')->value('meta_app_secret');
        $this->assertStringNotContainsString(self::SECRET, $raw);
        $this->assertSame(self::SECRET, decrypt($raw, false));
        $this->patchJson('/api/v1/social/settings', ['graph_version' => 'v21.0'])->assertOk()->assertJsonPath('data.secret_set', true);
        $this->patchJson('/api/v1/social/settings', ['meta_app_secret' => ''])->assertStatus(422)->assertJsonValidationErrors('meta_app_secret', 'error.details');
        $this->patchJson('/api/v1/social/settings', ['mode' => 'sandbox', 'meta_app_secret' => null])->assertOk()->assertJsonPath('data.secret_set', false);

        // Audited without the secret.
        $audit = DB::table('audit_logs')->where('action', 'social.settings_updated')->get();
        $this->assertGreaterThanOrEqual(3, $audit->count());
        $this->assertStringNotContainsString(self::SECRET, json_encode($audit->all()));
        $this->assertTrue($audit->contains(fn ($row) => str_contains((string) $row->context, 'secret_changed')));

        // Online Store Managers manage it; cashiers cannot see it.
        $this->actingAsUser($this->createUserWithRole($this->shop['tenant']['organization'], SystemRole::OnlineStoreManager));
        $this->patchJson('/api/v1/social/settings', ['graph_version' => 'v22.0'])->assertOk();
        $this->actingAsUser($this->createUserWithRole($this->shop['tenant']['organization'], SystemRole::Cashier));
        $this->patchJson('/api/v1/social/settings', ['mode' => 'sandbox'])->assertForbidden();
    }

    public function test_sandbox_connect_stores_the_demo_pages_and_a_page_can_be_chosen_or_disconnected(): void
    {
        $this->getJson('/api/v1/social/accounts')->assertOk()->assertJsonPath('data.connected', false)->assertJsonPath('data.page', null);
        $this->connectSandbox();

        $account = $this->getJson('/api/v1/social/accounts')->assertOk()->json('data');
        $this->assertSame(['sandbox', true, true], [$account['mode'], $account['connected'], $account['sandbox']]);
        $this->assertSame(['id' => SandboxMetaGraphClient::PAGE_ID, 'name' => 'Demo Page', 'picture_url' => null], $account['page']);
        $this->assertSame('demo_shop', $account['instagram']['username']);
        $this->assertSame([SandboxMetaGraphClient::PAGE_ID, SandboxMetaGraphClient::SECOND_PAGE_ID], array_column($account['pages'], 'id'));
        $this->assertNull($account['pages'][1]['instagram']);
        $this->assertSame($this->shop['tenant']['admin']->id, $account['connected_by']['id']);
        $this->assertStringNotContainsString('sandbox-page-', json_encode($account));

        $this->postJson('/api/v1/social/accounts/select', ['page_id' => 'nope'])->assertStatus(422)->assertJsonValidationErrors('page_id', 'error.details');
        $this->postJson('/api/v1/social/accounts/select', ['page_id' => SandboxMetaGraphClient::SECOND_PAGE_ID])->assertOk()
            ->assertJsonPath('data.page.name', 'Demo Page 2')->assertJsonPath('data.instagram', null);

        // Tokens are encrypted at rest.
        $row = DB::table('social_accounts')->first();
        $this->assertStringNotContainsString('sandbox-page-', $row->page_token.$row->pages);

        $this->deleteJson('/api/v1/social/accounts')->assertNoContent();
        $this->assertSame(0, DB::table('social_accounts')->count());
        $this->assertSame(['social.connected', 'social.account_selected', 'social.disconnected'], DB::table('audit_logs')->where('action', 'like', 'social.%')->orderBy('created_at')->orderBy('id')->pluck('action')->all());
    }

    public function test_live_facebook_login_connects_the_page_with_its_instagram_account(): void
    {
        $this->connectSandbox();
        $this->goLive();
        $this->assertSame(0, DB::table('social_accounts')->count(), 'Changing the mode disconnects the sandbox Page.');
        $this->getJson('/api/v1/social/accounts')->assertJsonPath('data.connected', false);

        $this->fakeFacebookLogin([
            ['id' => '111', 'name' => 'Berry Kids (no IG)', 'access_token' => 'EAAOtherPageToken0123'],
            ['id' => '222', 'name' => 'Berry Kids', 'access_token' => self::PAGE_TOKEN, 'picture' => ['data' => ['url' => 'https://scontent.example/p.jpg']],
                'instagram_business_account' => ['id' => '17841400000000009', 'username' => 'berrykids', 'profile_picture_url' => 'https://scontent.example/ig.jpg']],
        ]);
        $state = $this->startLiveConnect();
        $this->get('/api/v1/social/meta/callback?code=the-code&state='.$state)->assertStatus(302)->assertHeader('Location', '/admin/marketing/social?connected=1');

        $account = $this->getJson('/api/v1/social/accounts')->assertOk()->json('data');
        $this->assertSame(['live', true, false], [$account['mode'], $account['connected'], $account['sandbox']]);
        $this->assertSame(['id' => '222', 'name' => 'Berry Kids', 'picture_url' => 'https://scontent.example/p.jpg'], $account['page'], 'The Page with an Instagram account is chosen.');
        $this->assertSame(['id' => '17841400000000009', 'username' => 'berrykids', 'picture_url' => 'https://scontent.example/ig.jpg'], $account['instagram']);
        $this->assertSame(['111', '222'], array_column($account['pages'], 'id'));

        // Both token exchanges are POSTs with the app secret in the form body only.
        $exchanges = array_values(array_filter($this->recorded, fn (HttpRequest $r) => parse_url($r->url(), PHP_URL_PATH) === '/v21.0/oauth/access_token'));
        $this->assertCount(2, $exchanges);
        foreach ($exchanges as $exchange) {
            $this->assertSame('POST', $exchange->method());
            $this->assertTrue($exchange->isForm());
            $this->assertSame([self::SECRET, '1234567890'], [$exchange['client_secret'], $exchange['client_id']]);
        }
        $this->assertSame(['the-code', 'https://admin.example.com/api/v1/social/meta/callback'], [$exchanges[0]['code'], $exchanges[0]['redirect_uri']]);
        $this->assertSame(['fb_exchange_token', 'EAAShortLivedToken0123'], [$exchanges[1]['grant_type'], $exchanges[1]['fb_exchange_token']]);
        // The Pages were read with the long-lived token (header) and its appsecret_proof.
        $pagesRead = array_values(array_filter($this->recorded, fn (HttpRequest $r) => parse_url($r->url(), PHP_URL_PATH) === '/v21.0/me/accounts'))[0];
        $this->assertTrue($pagesRead->hasHeader('Authorization', 'Bearer '.self::USER_TOKEN));
        parse_str((string) parse_url($pagesRead->url(), PHP_URL_QUERY), $query);
        $this->assertSame(hash_hmac('sha256', self::USER_TOKEN, self::SECRET), $query['appsecret_proof']);
        // Neither the secret nor a token is in any request address.
        foreach ($this->recorded as $request) {
            foreach ([self::SECRET, self::USER_TOKEN, 'EAAShortLivedToken0123'] as $secret) {
                $this->assertStringNotContainsString($secret, $request->url());
            }
        }
        $this->assertNotNull(SocialAccount::query()->withoutGlobalScopes()->value('token_expires_at'));

        // The state works once.
        $this->get('/api/v1/social/meta/callback?code=the-code&state='.$state)->assertHeader('Location', '/admin/marketing/social?error=state_invalid');

        // No secret or token in any response, the audit trail or the log.
        $everything = json_encode(DB::table('audit_logs')->get()->all()).json_encode($account).implode("\n", $this->logged);
        foreach ([self::SECRET, self::PAGE_TOKEN, self::USER_TOKEN] as $secret) {
            $this->assertStringNotContainsString($secret, $everything);
        }
    }

    public function test_callback_errors_redirect_with_a_code(): void
    {
        $this->goLive();

        // Missing, unknown and other users' states.
        $this->get('/api/v1/social/meta/callback?code=x')->assertHeader('Location', '/admin/marketing/social?error=state_invalid');
        $this->get('/api/v1/social/meta/callback?code=x&state=forged')->assertHeader('Location', '/admin/marketing/social?error=state_invalid');
        $this->fakeFacebookLogin([]);
        $state = $this->startLiveConnect();
        $colleague = $this->createUserWithRole($this->shop['tenant']['organization'], SystemRole::OnlineStoreManager);
        $this->actingAsUser($colleague);
        $this->get('/api/v1/social/meta/callback?code=x&state='.$state)->assertHeader('Location', '/admin/marketing/social?error=state_invalid');
        $this->actingAsUser($this->shop['tenant']['admin']);

        // The user cancelled on Facebook.
        $state = $this->startLiveConnect();
        $this->get('/api/v1/social/meta/callback?error=access_denied&error_reason=user_denied&state='.$state)->assertHeader('Location', '/admin/marketing/social?error=access_denied');

        // No Pages granted.
        $state = $this->startLiveConnect();
        $this->get('/api/v1/social/meta/callback?code=x&state='.$state)->assertHeader('Location', '/admin/marketing/social?error=no_pages');

        // Facebook refuses the code.
        $this->exchangeFails = true;
        $state = $this->startLiveConnect();
        $this->get('/api/v1/social/meta/callback?code=x&state='.$state)->assertHeader('Location', '/admin/marketing/social?error=token_exchange_failed');
        $this->exchangeFails = false;

        // Not signed in (the state is kept in the cache for 10 minutes only).
        $state = $this->startLiveConnect();
        $this->assertTrue(Cache::has(ConnectMeta::stateKey($state)));
        $this->asVisitor();
        $this->get('/api/v1/social/meta/callback?code=x&state='.$state)->assertHeader('Location', '/admin/marketing/social?error=session_expired');
        $this->get('/api/v1/social/meta/connect')->assertHeader('Location', '/admin/marketing/social?error=session_expired');

        // Back in sandbox mode, a pending live state is refused.
        $this->actingAsUser($this->shop['tenant']['admin']);
        $state = $this->startLiveConnect();
        $this->patchJson('/api/v1/social/settings', ['mode' => 'sandbox'])->assertOk();
        $this->get('/api/v1/social/meta/callback?code=x&state='.$state)->assertHeader('Location', '/admin/marketing/social?error=app_not_configured');
        $this->assertSame('sandbox', DB::table('social_settings')->value('mode'));
    }
}
