<?php

namespace App\Modules\Social\Infrastructure\Meta;

use App\Modules\Social\Domain\Meta\MetaApp;
use App\Modules\Social\Domain\Meta\MetaGraphClient;
use App\Modules\Social\Domain\Meta\MetaGraphError;
use App\Modules\Social\Domain\Meta\MetaPage;
use App\Modules\Social\Domain\Meta\MetaToken;
use App\Modules\Social\Domain\Meta\PublishedPost;
use Carbon\CarbonImmutable;
use Illuminate\Support\Str;

/**
 * P2b: Facebook and Instagram without the network (sandbox mode, demos and tests). Connecting
 * yields "Demo Page" with the Instagram account @demo_shop and "Demo Page 2" without one;
 * publishing returns fake ids and permalinks under https://sandbox.invalid/. A caption containing
 * `#fail-test` fails (SANDBOX_FAILURE), so failures and retries can be tried out.
 */
final class SandboxMetaGraphClient implements MetaGraphClient
{
    public const FAIL_TAG = '#fail-test';

    public const PAGE_ID = '100000000000001';

    public const PAGE_NAME = 'Demo Page';

    public const SECOND_PAGE_ID = '100000000000002';

    public const INSTAGRAM_ID = '17841400000000001';

    public const INSTAGRAM_USERNAME = 'demo_shop';

    public const PERMALINK_BASE = 'https://sandbox.invalid';

    public function loginUrl(MetaApp $app, string $redirectUri, string $state): string
    {
        return $redirectUri.'?'.http_build_query(['code' => 'sandbox', 'state' => $state]);
    }

    public function exchangeCode(MetaApp $app, string $code, string $redirectUri): MetaToken
    {
        return new MetaToken('sandbox-user-'.Str::random(24), CarbonImmutable::now()->addHour());
    }

    public function longLivedToken(MetaApp $app, MetaToken $token): MetaToken
    {
        return new MetaToken('sandbox-user-'.Str::random(24), CarbonImmutable::now()->addDays(60));
    }

    public function pages(MetaApp $app, MetaToken $userToken): array
    {
        return self::demoPages();
    }

    /**
     * @return list<MetaPage>
     */
    public static function demoPages(): array
    {
        return [
            new MetaPage(self::PAGE_ID, self::PAGE_NAME, 'sandbox-page-'.Str::random(24), null, [
                'id' => self::INSTAGRAM_ID, 'username' => self::INSTAGRAM_USERNAME, 'picture_url' => null,
            ]),
            new MetaPage(self::SECOND_PAGE_ID, 'Demo Page 2', 'sandbox-page-'.Str::random(24), null, null),
        ];
    }

    public function publishToFacebook(MetaApp $app, MetaPage $page, string $message, array $imageUrls, ?string $link): PublishedPost
    {
        $this->failOnTag($message, 'Facebook');
        $id = $page->id.'_'.$this->digits();

        return new PublishedPost($id, self::PERMALINK_BASE.'/facebook/'.$id);
    }

    public function publishToInstagram(MetaApp $app, MetaPage $page, string $caption, array $imageUrls): PublishedPost
    {
        $this->failOnTag($caption, 'Instagram');
        if (($page->instagram['id'] ?? null) === null || $imageUrls === []) {
            throw new MetaGraphError(MetaGraphError::GRAPH_ERROR, 'Instagram needs a connected Instagram business account and at least one photo.');
        }

        return new PublishedPost('1790'.$this->digits(), self::PERMALINK_BASE.'/instagram/p/'.Str::lower(Str::random(11)));
    }

    private function failOnTag(string $text, string $network): void
    {
        if (str_contains(mb_strtolower($text), self::FAIL_TAG)) {
            throw new MetaGraphError(MetaGraphError::SANDBOX_FAILURE, "Sandbox: the {$network} post failed on purpose (the caption contains ".self::FAIL_TAG.').');
        }
    }

    private function digits(): string
    {
        return (string) random_int(100000000000000, 999999999999999);
    }
}
