<?php

namespace App\Modules\Social\Infrastructure\Meta;

use App\Modules\Social\Domain\Meta\MetaApp;
use App\Modules\Social\Domain\Meta\MetaGraphClient;
use App\Modules\Social\Domain\Meta\MetaGraphError;
use App\Modules\Social\Domain\Meta\MetaPage;
use App\Modules\Social\Domain\Meta\MetaToken;
use App\Modules\Social\Domain\Meta\PublishedPost;
use Carbon\CarbonImmutable;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Factory as HttpFactory;
use Illuminate\Http\Client\PendingRequest;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Sleep;

/**
 * P2b: the Meta Graph API over Laravel's HTTP client (no SDK).
 *
 * - Facebook Login: dialog `https://www.facebook.com/{v}/dialog/oauth`, code → user token and
 *   short → long-lived token on `POST /{v}/oauth/access_token` (form body, so the app secret is
 *   never part of an address); Pages with `GET /me/accounts`
 *   (`id, name, access_token, picture, instagram_business_account{id, username,
 *   profile_picture_url}`).
 * - Facebook: one photo `POST /{page}/photos` (`url`, `caption`); several: each photo
 *   `POST /{page}/photos` with `published=false`, then `POST /{page}/feed` with `message` and
 *   `attached_media=[{"media_fbid": …}]`; none: `POST /{page}/feed` with `message` and `link`.
 *   The permalink comes from `GET /{post}?fields=permalink_url`.
 * - Instagram: `POST /{ig}/media` (`image_url`, `caption`; a carousel of `is_carousel_item`
 *   children for several photos), the container's `status_code` polled until FINISHED, then
 *   `POST /{ig}/media_publish` and `GET /{media}?fields=permalink`.
 *
 * Tokens travel in the `Authorization: Bearer` header, and every call made with a user or Page
 * token carries `appsecret_proof` (HMAC-SHA256 of the token with the app secret), so a leaked
 * token alone cannot call the Graph API for the app; the app secret itself goes only to the token
 * endpoint, in a POST body. Posts are never retried automatically (a lost answer must not post
 * twice).
 * Failures are MetaGraphError; the log gets the path, HTTP status, Meta's error codes and trace
 * id — never tokens, the secret or messages.
 */
final class HttpMetaGraphClient implements MetaGraphClient
{
    public const GRAPH_URL = 'https://graph.facebook.com';

    public const DIALOG_URL = 'https://www.facebook.com';

    public function __construct(
        private readonly HttpFactory $http,
        private readonly int $timeout = 30,
        private readonly int $statusChecks = 10,
        private readonly int $statusWaitMs = 1500,
    ) {}

    public function loginUrl(MetaApp $app, string $redirectUri, string $state): string
    {
        return self::DIALOG_URL.'/'.$app->graphVersion.'/dialog/oauth?'.http_build_query([
            'client_id' => $app->id,
            'redirect_uri' => $redirectUri,
            'state' => $state,
            'response_type' => 'code',
            'scope' => implode(',', self::SCOPES),
        ], '', '&', PHP_QUERY_RFC3986);
    }

    public function exchangeCode(MetaApp $app, string $code, string $redirectUri): MetaToken
    {
        // POST with a form body: the app secret never appears in a request address.
        return $this->token($this->send($app, null, 'post', 'oauth/access_token', [
            'client_id' => $app->id,
            'client_secret' => $app->secret,
            'redirect_uri' => $redirectUri,
            'code' => $code,
        ]));
    }

    public function longLivedToken(MetaApp $app, MetaToken $token): MetaToken
    {
        return $this->token($this->send($app, null, 'post', 'oauth/access_token', [
            'grant_type' => 'fb_exchange_token',
            'client_id' => $app->id,
            'client_secret' => $app->secret,
            'fb_exchange_token' => $token->value,
        ]));
    }

    public function pages(MetaApp $app, MetaToken $userToken): array
    {
        $json = $this->send($app, $userToken->value, 'get', 'me/accounts', [
            'fields' => 'id,name,access_token,picture{url},instagram_business_account{id,username,profile_picture_url}',
            'limit' => 100,
        ]);
        $pages = [];
        foreach (is_array($json['data'] ?? null) ? $json['data'] : [] as $row) {
            if (! is_array($row) || ! is_scalar($row['id'] ?? null) || ! is_string($row['access_token'] ?? null)) {
                continue;
            }
            $ig = is_array($row['instagram_business_account'] ?? null) && is_scalar($row['instagram_business_account']['id'] ?? null) ? $row['instagram_business_account'] : null;
            $pages[] = new MetaPage(
                (string) $row['id'],
                is_string($row['name'] ?? null) ? $row['name'] : (string) $row['id'],
                $row['access_token'],
                is_string($row['picture']['data']['url'] ?? null) ? $row['picture']['data']['url'] : null,
                $ig === null ? null : [
                    'id' => (string) $ig['id'],
                    'username' => is_string($ig['username'] ?? null) ? $ig['username'] : '',
                    'picture_url' => is_string($ig['profile_picture_url'] ?? null) ? $ig['profile_picture_url'] : null,
                ],
            );
        }

        return $pages;
    }

    public function publishToFacebook(MetaApp $app, MetaPage $page, string $message, array $imageUrls, ?string $link): PublishedPost
    {
        $token = $page->accessToken;
        if ($imageUrls === []) {
            $json = $this->send($app, $token, 'post', $page->id.'/feed', array_filter(['message' => $message, 'link' => $link], fn ($v) => $v !== null && $v !== ''));
            $id = $this->id($json, 'id');
        } elseif (count($imageUrls) === 1) {
            $json = $this->send($app, $token, 'post', $page->id.'/photos', ['url' => $imageUrls[0], 'caption' => $message, 'published' => 'true']);
            $id = is_scalar($json['post_id'] ?? null) ? (string) $json['post_id'] : $this->id($json, 'id');
        } else {
            $media = [];
            foreach ($imageUrls as $url) {
                $media[] = ['media_fbid' => $this->id($this->send($app, $token, 'post', $page->id.'/photos', ['url' => $url, 'published' => 'false']), 'id')];
            }
            $json = $this->send($app, $token, 'post', $page->id.'/feed', ['message' => $message, 'attached_media' => (string) json_encode($media)]);
            $id = $this->id($json, 'id');
        }

        try {
            $permalink = $this->send($app, $token, 'get', $id, ['fields' => 'permalink_url'])['permalink_url'] ?? null;
        } catch (MetaGraphError) {
            $permalink = null;
        }

        return new PublishedPost($id, is_string($permalink) && $permalink !== '' ? $permalink : 'https://www.facebook.com/'.$id);
    }

    public function publishToInstagram(MetaApp $app, MetaPage $page, string $caption, array $imageUrls): PublishedPost
    {
        $ig = $page->instagram['id'] ?? null;
        if ($ig === null || $imageUrls === []) {
            throw new MetaGraphError(MetaGraphError::GRAPH_ERROR, 'Instagram needs a connected Instagram business account and at least one photo.');
        }
        $token = $page->accessToken;
        if (count($imageUrls) === 1) {
            $container = $this->id($this->send($app, $token, 'post', $ig.'/media', ['image_url' => $imageUrls[0], 'caption' => $caption]), 'id');
        } else {
            $children = [];
            foreach ($imageUrls as $url) {
                $children[] = $this->id($this->send($app, $token, 'post', $ig.'/media', ['image_url' => $url, 'is_carousel_item' => 'true']), 'id');
            }
            $container = $this->id($this->send($app, $token, 'post', $ig.'/media', [
                'media_type' => 'CAROUSEL',
                'children' => implode(',', $children),
                'caption' => $caption,
            ]), 'id');
        }
        $this->waitUntilReady($app, $token, $container);
        $mediaId = $this->id($this->send($app, $token, 'post', $ig.'/media_publish', ['creation_id' => $container]), 'id');

        try {
            $permalink = $this->send($app, $token, 'get', $mediaId, ['fields' => 'permalink'])['permalink'] ?? null;
        } catch (MetaGraphError) {
            $permalink = null;
        }

        return new PublishedPost($mediaId, is_string($permalink) && $permalink !== '' ? $permalink : null);
    }

    /**
     * Instagram processes a container before it can be published.
     */
    private function waitUntilReady(MetaApp $app, string $token, string $container): void
    {
        for ($check = 1; $check <= $this->statusChecks; $check++) {
            $status = $this->send($app, $token, 'get', $container, ['fields' => 'status_code'])['status_code'] ?? null;
            if ($status === 'FINISHED' || $status === 'PUBLISHED') {
                return;
            }
            if ($status === 'ERROR' || $status === 'EXPIRED') {
                throw new MetaGraphError(MetaGraphError::MEDIA_REJECTED, 'Instagram could not process the photos. Use JPEG photos between 4:5 and 1.91:1 at a public https:// address.');
            }
            if ($check < $this->statusChecks) {
                Sleep::for($this->statusWaitMs)->milliseconds();
            }
        }

        throw new MetaGraphError(MetaGraphError::GRAPH_ERROR, 'Instagram is still processing the photos. Try again in a few minutes.');
    }

    /**
     * @param  array<string, mixed>  $params
     * @return array<string, mixed>
     *
     * @throws MetaGraphError
     */
    private function send(MetaApp $app, ?string $token, string $method, string $path, array $params): array
    {
        if ($token !== null) {
            $params['appsecret_proof'] = self::proof($app, $token);
        }
        $request = $this->request($app, $token);
        try {
            $response = $method === 'get' ? $request->get($path, $params) : $request->asForm()->post($path, $params);
        } catch (ConnectionException) {
            Log::warning('Meta Graph API unreachable', ['path' => $path]);
            throw MetaGraphError::network();
        }

        $json = $response->json();
        if (! $response->successful() || ! is_array($json) || isset($json['error'])) {
            $error = MetaGraphError::fromGraph(is_array($json) && is_array($json['error'] ?? null) ? $json['error'] : [], $response->status());
            Log::warning('Meta Graph API request failed', [
                'path' => $path,
                'status' => $response->status(),
                'code' => $error->graphCode,
                'subcode' => $error->graphSubcode,
                'fbtrace_id' => $error->traceId,
                'error' => $error->errorCode,
            ]);

            throw $error;
        }

        return $json;
    }

    /**
     * `appsecret_proof`: HMAC-SHA256 of the access token keyed with the app secret (hex).
     */
    public static function proof(MetaApp $app, string $token): string
    {
        return hash_hmac('sha256', $token, $app->secret);
    }

    private function request(MetaApp $app, ?string $token): PendingRequest
    {
        $request = $this->http->baseUrl(self::GRAPH_URL.'/'.$app->graphVersion)
            ->acceptJson()
            ->timeout($this->timeout)
            ->connectTimeout(min(10, $this->timeout));

        return $token === null ? $request : $request->withToken($token);
    }

    /**
     * @param  array<string, mixed>  $json
     */
    private function token(array $json): MetaToken
    {
        if (! is_string($json['access_token'] ?? null) || $json['access_token'] === '') {
            throw MetaGraphError::unexpected('no access token');
        }
        $expires = is_numeric($json['expires_in'] ?? null) && (int) $json['expires_in'] > 0 ? CarbonImmutable::now()->addSeconds((int) $json['expires_in']) : null;

        return new MetaToken($json['access_token'], $expires);
    }

    /**
     * @param  array<string, mixed>  $json
     */
    private function id(array $json, string $key): string
    {
        if (! is_scalar($json[$key] ?? null) || (string) $json[$key] === '') {
            throw MetaGraphError::unexpected('no id');
        }

        return (string) $json[$key];
    }
}
