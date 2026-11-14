<?php

namespace App\Modules\Social\Tests\Feature;

use App\Modules\Social\Domain\Meta\MetaPage;
use App\Modules\Social\Infrastructure\Models\SocialAccount;
use App\Modules\Social\Tests\Concerns\BuildsSocial;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Log\Events\MessageLogged;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Sleep;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * P2b: live publishing through HttpMetaGraphClient against a faked Graph API — the Facebook photo,
 * multi-photo and link posts, Instagram single and carousel posts with the container status
 * check, the short link in the caption, Page tokens only in the Authorization header, error
 * mapping (expired token, network), partial failures and retries that never post twice, and the
 * live-only photo rules (public https, JPEG for Instagram).
 */
class SocialLivePublishingTest extends TestCase
{
    use BuildsSocial, RefreshDatabase;

    private const PAGE_TOKEN = 'EAAPageTokenLive0123456789';

    private const IG = '17841400000000009';

    /** @var array<string, mixed> */
    private array $shop;

    /** @var list<HttpRequest> */
    private array $sent = [];

    /** @var array<string, \Closure(HttpRequest): mixed> path pattern => answer */
    private array $answers = [];

    /** @var list<string> */
    private array $logged = [];

    protected function setUp(): void
    {
        parent::setUp();
        Http::preventStrayRequests();
        Sleep::fake();
        config(['app.url' => 'https://admin.berrykids.com']);
        $this->shop = $this->socialShop('Berry Kids', 'shop.berrykids.com');
        $this->patchJson('/api/v1/social/settings', ['mode' => 'live', 'meta_app_id' => '1234567890', 'meta_app_secret' => 'app-secret-value-1234'])->assertOk();
        $this->inTenant($this->shop['tenant']['organization'], function () {
            $page = ['id' => '222', 'name' => 'Berry Kids', 'access_token' => self::PAGE_TOKEN, 'picture_url' => null, 'instagram' => ['id' => self::IG, 'username' => 'berrykids', 'picture_url' => null]];
            $account = new SocialAccount(['sandbox' => false, 'pages' => [$page], 'connected_by' => $this->shop['tenant']['admin']->id, 'connected_at' => now()]);
            $account->usePage(MetaPage::fromArray($page));
            $account->save();
        });
        Event::listen(MessageLogged::class, function (MessageLogged $e) {
            $this->logged[] = $e->message.' '.json_encode($e->context);
        });
        $this->fakeGraph();
    }

    private function fakeGraph(): void
    {
        Http::fake(function (HttpRequest $request) {
            $this->sent[] = $request;
            $path = (string) parse_url($request->url(), PHP_URL_PATH);
            foreach ($this->answers as $pattern => $answer) {
                if (Str::is($pattern, $path)) {
                    return $answer($request);
                }
            }
            $form = $request->data();

            return match (true) {
                $path === '/v21.0/222/photos' => Http::response(($form['published'] ?? 'true') === 'false' ? ['id' => 'photo'.count($this->sent)] : ['id' => 'photo1', 'post_id' => '222_900']),
                $path === '/v21.0/222/feed' => Http::response(['id' => '222_901']),
                $path === '/v21.0/'.self::IG.'/media' => Http::response(['id' => 'container'.count($this->sent)]),
                $path === '/v21.0/'.self::IG.'/media_publish' => Http::response(['id' => '17900000000000001']),
                str_starts_with($path, '/v21.0/container') => Http::response(['status_code' => 'FINISHED', 'id' => 'c']),
                $path === '/v21.0/17900000000000001' => Http::response(['permalink' => 'https://www.instagram.com/p/ABC123/']),
                str_starts_with($path, '/v21.0/222_') => Http::response(['permalink_url' => 'https://www.facebook.com/berrykids/posts/'.substr($path, 11)]),
                default => Http::response(['error' => ['message' => 'Unexpected '.$path, 'code' => 100]], 400),
            };
        });
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed> the post after publishing
     */
    private function publishPost(array $overrides = []): array
    {
        $post = $this->postJson('/api/v1/social/posts', $overrides + [
            'caption' => 'Our softest polo yet ✨',
            'targets' => ['facebook', 'instagram'],
            'image_ids' => [$this->shop['shirt_images'][0]],
            'product_id' => $this->shop['shirt']['id'],
        ])->assertCreated()->json('data');

        return $this->postJson("/api/v1/social/posts/{$post['id']}/publish")->assertOk()->json('data');
    }

    /**
     * @return list<HttpRequest>
     */
    private function sentTo(string $path): array
    {
        return array_values(array_filter($this->sent, fn (HttpRequest $r) => parse_url($r->url(), PHP_URL_PATH) === $path));
    }

    public function test_a_photo_is_posted_to_the_page_and_to_instagram_with_the_short_link(): void
    {
        $post = $this->publishPost();
        $this->assertSame('published', $post['status']);
        [$facebook, $instagram] = $post['results'];
        $this->assertSame(['222_900', 'https://www.facebook.com/berrykids/posts/900', false], [$facebook['remote_id'], $facebook['permalink'], $facebook['sandbox']]);
        $this->assertSame(['17900000000000001', 'https://www.instagram.com/p/ABC123/'], [$instagram['remote_id'], $instagram['permalink']]);

        $photo = $this->sentTo('/v21.0/222/photos')[0];
        $this->assertSame('POST', $photo->method());
        $this->assertStringStartsWith('https://shop.berrykids.com/storage/', $photo['url']);
        $this->assertSame('true', $photo['published']);
        $this->assertSame("Our softest polo yet ✨\n\n".$facebook['short_link']['url'], $photo['caption']);
        $this->assertMatchesRegularExpression('#^https://shop\.berrykids\.com/go/[a-z0-9]{6}$#', $facebook['short_link']['url']);

        $media = $this->sentTo('/v21.0/'.self::IG.'/media')[0];
        $this->assertSame($photo['url'], $media['image_url']);
        $this->assertSame("Our softest polo yet ✨\n\n".$instagram['short_link']['url'], $media['caption']);
        $this->assertNotSame($facebook['short_link']['url'], $instagram['short_link']['url']);
        $this->assertCount(1, $this->sentTo('/v21.0/'.self::IG.'/media_publish'));

        // Page tokens travel in the Authorization header only, never in an address or the log; every
        // call carries the appsecret_proof (the secret itself is never sent here).
        $proof = hash_hmac('sha256', self::PAGE_TOKEN, 'app-secret-value-1234');
        foreach ($this->sent as $request) {
            $this->assertTrue($request->hasHeader('Authorization', 'Bearer '.self::PAGE_TOKEN));
            $this->assertStringNotContainsString(self::PAGE_TOKEN, $request->url());
            $this->assertStringNotContainsString('app-secret-value-1234', $request->url().json_encode($request->data()));
            parse_str((string) parse_url($request->url(), PHP_URL_QUERY), $query);
            $this->assertSame($proof, $request->method() === 'GET' ? ($query['appsecret_proof'] ?? null) : $request['appsecret_proof'], $request->url());
        }
        $this->assertStringNotContainsString(self::PAGE_TOKEN, implode("\n", $this->logged));
    }

    public function test_several_photos_make_a_facebook_album_post_and_an_instagram_carousel(): void
    {
        $post = $this->publishPost(['image_ids' => $this->shop['shirt_images'], 'link_url' => null, 'product_id' => null]);
        $this->assertSame('published', $post['status']);

        $photos = $this->sentTo('/v21.0/222/photos');
        $this->assertSame(['false', 'false'], array_map(fn (HttpRequest $r) => $r['published'], $photos));
        $feed = $this->sentTo('/v21.0/222/feed')[0];
        $this->assertSame('Our softest polo yet ✨', $feed['message'], 'No link: nothing appended.');
        $attached = json_decode($feed['attached_media'], true);
        $this->assertCount(2, $attached);
        $this->assertArrayHasKey('media_fbid', $attached[0]);

        $media = $this->sentTo('/v21.0/'.self::IG.'/media');
        $this->assertCount(3, $media, 'Two carousel items and the carousel.');
        $this->assertSame(['true', 'true'], [$media[0]['is_carousel_item'], $media[1]['is_carousel_item']]);
        $this->assertSame('CAROUSEL', $media[2]['media_type']);
        $this->assertCount(2, explode(',', $media[2]['children']));
        $this->assertNotEmpty(array_filter($this->sent, fn (HttpRequest $r) => str_contains($r->url(), 'fields=status_code')));
    }

    public function test_a_facebook_post_without_photos_is_a_link_post(): void
    {
        $post = $this->publishPost(['targets' => ['facebook'], 'image_ids' => []]);
        $this->assertSame('published', $post['status']);
        $feed = $this->sentTo('/v21.0/222/feed')[0];
        $this->assertSame('Our softest polo yet ✨', $feed['message']);
        $this->assertSame($post['results'][0]['short_link']['url'], $feed['link']);
        $this->assertSame([], $this->sentTo('/v21.0/222/photos'));
    }

    public function test_an_expired_token_fails_one_target_and_retry_posts_only_that_one(): void
    {
        $this->answers['/v21.0/'.self::IG.'/media'] = fn () => Http::response(['error' => [
            'message' => 'Error validating access token: Session has expired. token EAAShouldNotLeak0123456', 'type' => 'OAuthException', 'code' => 190, 'error_subcode' => 463, 'fbtrace_id' => 'Xyz',
        ]], 400);
        $post = $this->publishPost();
        $this->assertSame('partially_published', $post['status']);
        $this->assertSame('published', $post['results'][0]['status']);
        $this->assertSame('TOKEN_EXPIRED', $post['results'][1]['error']['code']);
        $this->assertStringContainsString('Reconnect Facebook', $post['results'][1]['error']['message']);
        $this->assertStringNotContainsString('EAAShouldNotLeak', json_encode($post).implode("\n", $this->logged));
        $this->assertTrue(collect($this->logged)->contains(fn (string $l) => str_contains($l, '"code":190') && str_contains($l, 'Xyz')), 'Meta codes and trace id are logged.');

        // Retry: only Instagram goes again.
        unset($this->answers['/v21.0/'.self::IG.'/media']);
        $retried = $this->postJson("/api/v1/social/posts/{$post['id']}/retry")->assertOk()->json('data');
        $this->assertSame(['published', 'published', 'published'], [$retried['status'], $retried['results'][0]['status'], $retried['results'][1]['status']]);
        $this->assertCount(1, $this->sentTo('/v21.0/222/photos'), 'Facebook was not posted twice.');
        $this->assertSame($post['results'][0]['remote_id'], $retried['results'][0]['remote_id']);
        $this->assertSame($post['results'][1]['short_link'], $retried['results'][1]['short_link'], 'The retry keeps the short link.');
    }

    public function test_network_failures_and_live_only_photo_rules(): void
    {
        $this->answers['/v21.0/222/photos'] = fn () => throw new ConnectionException('cURL error 28: timed out for https://graph.facebook.com/v21.0/222/photos');
        $post = $this->publishPost(['targets' => ['facebook']]);
        $this->assertSame(['failed', 'NETWORK_ERROR'], [$post['status'], $post['results'][0]['error']['code']]);
        unset($this->answers['/v21.0/222/photos']);

        // Instagram takes JPEG photos only (the cap's photo is a PNG).
        $png = $this->postJson('/api/v1/social/posts', ['caption' => 'Cap', 'targets' => ['instagram'], 'image_ids' => $this->shop['cap_images']])->assertCreated()->json('data.id');
        $this->postJson("/api/v1/social/posts/{$png}/publish")->assertStatus(422)->assertJsonPath('error.code', 'INSTAGRAM_JPEG_ONLY');
        $this->patchJson("/api/v1/social/posts/{$png}", ['targets' => ['facebook']])->assertOk();
        $this->postJson("/api/v1/social/posts/{$png}/publish")->assertOk()->assertJsonPath('data.status', 'published');

        // Photos of a store without a public https address cannot be fetched by Meta.
        config(['app.url' => 'http://localhost']);
        $local = $this->postJson('/api/v1/social/posts', ['caption' => 'Local', 'targets' => ['facebook'], 'image_ids' => [$this->shop['shirt_images'][0]]])->assertCreated()->json('data.id');
        $this->postJson("/api/v1/social/posts/{$local}/publish")->assertStatus(422)->assertJsonPath('error.code', 'MEDIA_NOT_PUBLIC');
    }
}
