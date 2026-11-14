<?php

namespace App\Modules\Social\Application\Actions;

use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Social\Application\Queries\SocialConfig;
use App\Modules\Social\Domain\Meta\MetaGraphClients;
use App\Modules\Social\Domain\Meta\MetaGraphError;
use App\Modules\Social\Domain\Meta\MetaPage;
use App\Modules\Social\Domain\Meta\MetaToken;
use App\Modules\Social\Domain\SocialMode;
use App\Modules\Social\Infrastructure\Models\SocialAccount;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Cache\Repository as Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * P2b: connecting a Facebook Page (and its Instagram business account).
 *
 * - Sandbox: the simulated "Demo Page" (@demo_shop) and "Demo Page 2" are stored at once.
 * - Live: start() sends the browser to the Facebook Login dialog with a random `state` kept in the
 *   cache for 10 minutes, bound to the user and organization (single use). complete() checks it,
 *   exchanges the code for a user token, then a long-lived one, reads the user's Pages with their
 *   Instagram accounts and stores the first Page that has an Instagram account (else the first
 *   Page) — tokens encrypted.
 *
 * Both return where the browser goes next: the Facebook dialog, or the admin's Social page with
 * `?connected=1` / `?error=<code>` (app_not_configured, state_invalid, access_denied,
 * token_exchange_failed, no_pages, graph_error). Connecting is audited (`social.connected`).
 */
class ConnectMeta
{
    public const STATE_TTL = 600;

    public function __construct(
        private readonly SocialConfig $config,
        private readonly MetaGraphClients $clients,
        private readonly AuditTrail $audit,
        private readonly Cache $cache,
    ) {}

    public function start(string $userId, string $organizationId): string
    {
        $settings = $this->config->settings();
        if ($settings->mode === SocialMode::Sandbox) {
            // The sandbox client answers with its demo Pages, without the network.
            $this->store($this->clients->for(SocialMode::Sandbox)->pages($settings->metaApp(), new MetaToken('sandbox')), true, $userId, null);

            return SocialConfig::adminUrl(['connected' => '1']);
        }
        if (! $settings->liveReady()) {
            return SocialConfig::adminUrl(['error' => 'app_not_configured']);
        }

        $state = Str::random(48);
        $redirectUri = $this->config->redirectUri();
        $this->cache->put(self::stateKey($state), ['user_id' => $userId, 'organization_id' => $organizationId, 'redirect_uri' => $redirectUri], self::STATE_TTL);

        return $this->clients->for(SocialMode::Live)->loginUrl($settings->metaApp(), $redirectUri, $state);
    }

    /**
     * @param  array<string, mixed>  $query  the callback's query (code, state, error, …)
     */
    public function complete(string $userId, string $organizationId, array $query): string
    {
        $state = is_string($query['state'] ?? null) ? $query['state'] : '';
        $payload = $state === '' ? null : $this->cache->pull(self::stateKey($state));
        if (! is_array($payload) || ($payload['user_id'] ?? null) !== $userId || ($payload['organization_id'] ?? null) !== $organizationId) {
            return SocialConfig::adminUrl(['error' => 'state_invalid']);
        }
        if (isset($query['error']) || ! is_string($query['code'] ?? null) || $query['code'] === '') {
            return SocialConfig::adminUrl(['error' => 'access_denied']);
        }
        $settings = $this->config->settings();
        if ($settings->mode !== SocialMode::Live || ! $settings->liveReady()) {
            return SocialConfig::adminUrl(['error' => 'app_not_configured']);
        }

        $client = $this->clients->for(SocialMode::Live);
        $app = $settings->metaApp();
        try {
            $short = $client->exchangeCode($app, $query['code'], (string) $payload['redirect_uri']);
            $token = $client->longLivedToken($app, $short);
        } catch (MetaGraphError $e) {
            Log::warning('Facebook Login: token exchange failed', ['error' => $e->errorCode, 'code' => $e->graphCode]);

            return SocialConfig::adminUrl(['error' => 'token_exchange_failed']);
        }
        try {
            $pages = $client->pages($app, $token);
        } catch (MetaGraphError $e) {
            Log::warning('Facebook Login: reading the Pages failed', ['error' => $e->errorCode, 'code' => $e->graphCode]);

            return SocialConfig::adminUrl(['error' => 'graph_error']);
        }
        if ($pages === []) {
            return SocialConfig::adminUrl(['error' => 'no_pages']);
        }

        $this->store($pages, false, $userId, $token);

        return SocialConfig::adminUrl(['connected' => '1']);
    }

    public static function stateKey(string $state): string
    {
        return 'social:meta:state:'.hash('sha256', $state);
    }

    /**
     * @param  list<MetaPage>  $pages
     */
    private function store(array $pages, bool $sandbox, string $userId, ?MetaToken $token): SocialAccount
    {
        $chosen = $pages[0];
        foreach ($pages as $page) {
            if ($page->instagram !== null) {
                $chosen = $page;
                break;
            }
        }

        return DB::transaction(function () use ($pages, $chosen, $sandbox, $userId, $token) {
            $account = SocialAccount::query()->lockForUpdate()->first() ?? new SocialAccount;
            $account->usePage($chosen);
            $account->fill([
                'sandbox' => $sandbox,
                'pages' => array_map(fn (MetaPage $p) => $p->toArray(), $pages),
                'token_expires_at' => $token?->expiresAt === null ? null : CarbonImmutable::instance($token->expiresAt),
                'connected_by' => $userId,
                'connected_at' => CarbonImmutable::now(),
            ]);
            $account->save();
            $this->audit->record('social.connected', $account, [], [
                'page_id' => $account->page_id,
                'page_name' => $account->page_name,
                'instagram_username' => $account->instagram_username,
                'sandbox' => $sandbox,
            ]);

            return $account;
        });
    }
}
