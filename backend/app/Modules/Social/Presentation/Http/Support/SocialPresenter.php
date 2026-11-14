<?php

namespace App\Modules\Social\Presentation\Http\Support;

use App\Modules\Marketing\Application\Contracts\MarketingLinks;
use App\Modules\OnlineCatalog\Application\Contracts\StorefrontCatalog;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Social\Application\Queries\SocialConfig;
use App\Modules\Social\Application\Services\PostMedia;
use App\Modules\Social\Domain\PostTarget;
use App\Modules\Social\Infrastructure\Models\ProductFeed;
use App\Modules\Social\Infrastructure\Models\SocialAccount;
use App\Modules\Social\Infrastructure\Models\SocialPost;
use App\Modules\Social\Infrastructure\Models\SocialPostResult;
use App\Modules\Social\Infrastructure\Models\SocialSettings;
use App\Modules\Users\Application\Contracts\UserDirectory;

/**
 * P2b: social settings, the connected account, posts and feeds for the admin. Secrets (app
 * secret, tokens) are never part of any payload.
 */
class SocialPresenter
{
    public function __construct(
        private readonly SocialConfig $config,
        private readonly PostMedia $media,
        private readonly StorefrontCatalog $catalog,
        private readonly MarketingLinks $marketing,
        private readonly UserDirectory $users,
        private readonly TenantContext $tenant,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function settings(SocialSettings $settings): array
    {
        return [
            'mode' => $settings->mode->value,
            'meta_app_id' => $settings->meta_app_id,
            'secret_set' => is_string($settings->meta_app_secret) && $settings->meta_app_secret !== '',
            'graph_version' => $settings->graph_version,
            'redirect_uri' => $this->config->redirectUri(),
            'live_ready' => $settings->liveReady(),
            'updated_at' => $settings->updated_at?->toIso8601String(),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function account(SocialSettings $settings, ?SocialAccount $account): array
    {
        $usable = $account !== null && $account->sandbox === ($settings->mode->value === 'sandbox');
        $names = $account?->connected_by === null ? [] : $this->users->names($this->tenant->requireOrganization(), [$account->connected_by]);

        return [
            'mode' => $settings->mode->value,
            'connected' => $usable,
            'sandbox' => $account?->sandbox ?? false,
            'page' => $account === null ? null : ['id' => $account->page_id, 'name' => $account->page_name, 'picture_url' => $account->page_picture_url],
            'instagram' => $account === null || $account->instagram_id === null ? null : [
                'id' => $account->instagram_id,
                'username' => $account->instagram_username,
                'picture_url' => $account->instagram_picture_url,
            ],
            'pages' => $account === null ? [] : array_map(fn ($page) => [
                'id' => $page->id,
                'name' => $page->name,
                'instagram' => $page->instagram === null ? null : ['id' => $page->instagram['id'], 'username' => $page->instagram['username']],
            ], $account->grantedPages()),
            'connected_at' => $account?->connected_at->toIso8601String(),
            'connected_by' => $account?->connected_by === null ? null : ['id' => $account->connected_by, 'name' => $names[$account->connected_by] ?? null],
        ];
    }

    /**
     * @param  list<SocialPost>  $posts  with results
     * @return list<array<string, mixed>>
     */
    public function posts(array $posts): array
    {
        if ($posts === []) {
            return [];
        }
        $organization = $this->tenant->requireOrganization();
        $media = $this->media->forPosts($posts);
        $products = $this->catalog->productSummaries(array_values(array_unique(array_filter(array_map(fn (SocialPost $p) => $p->product_id, $posts)))));
        $campaigns = $this->marketing->campaigns(array_values(array_unique(array_filter(array_map(fn (SocialPost $p) => $p->campaign_id, $posts)))));
        $linkIds = [];
        foreach ($posts as $post) {
            foreach ($post->results as $result) {
                if ($result->short_link_id !== null) {
                    $linkIds[] = $result->short_link_id;
                }
            }
        }
        $links = $this->marketing->shortLinks(array_values(array_unique($linkIds)));
        $authors = $this->users->names($organization, array_values(array_unique(array_filter(array_map(fn (SocialPost $p) => $p->created_by, $posts)))));

        return array_map(function (SocialPost $post) use ($media, $products, $campaigns, $links, $authors) {
            $results = $post->results->keyBy(fn (SocialPostResult $r) => $r->target->value);

            return [
                'id' => $post->id,
                'caption' => $post->caption,
                'targets' => array_map(fn (PostTarget $t) => $t->value, $post->targetList()),
                'image_ids' => $post->mediaIds(SocialPost::KIND_PRODUCT_IMAGE),
                'media_ids' => $post->mediaIds(SocialPost::KIND_MEDIA),
                'media' => array_map(fn (array $m) => ['id' => $m['id'], 'kind' => $m['kind'], 'url' => $m['url']], $media[$post->id] ?? []),
                'link_url' => $post->link_path,
                'product' => $post->product_id === null || ! isset($products[$post->product_id]) ? null : ['id' => $post->product_id, 'name' => $products[$post->product_id]['name']],
                'campaign' => $post->campaign_id === null || ! isset($campaigns[$post->campaign_id]) ? null : ['id' => $post->campaign_id, 'name' => $campaigns[$post->campaign_id]['name']],
                'status' => $post->status->value,
                'scheduled_at' => $post->scheduled_at?->toIso8601String(),
                'published_at' => $post->published_at?->toIso8601String(),
                'results' => array_values(array_filter(array_map(function (PostTarget $target) use ($results, $links) {
                    /** @var SocialPostResult|null $result */
                    $result = $results[$target->value] ?? null;
                    if ($result === null) {
                        return null;
                    }
                    $link = $result->short_link_id === null ? null : ($links[$result->short_link_id] ?? null);

                    return [
                        'target' => $target->value,
                        'status' => $result->status->value,
                        'remote_id' => $result->remote_id,
                        'permalink' => $result->permalink,
                        'error' => $result->error_code === null ? null : ['code' => $result->error_code, 'message' => (string) $result->error_message],
                        'short_link' => $link === null ? null : ['code' => $link['code'], 'url' => $link['url']],
                        'published_at' => $result->published_at?->toIso8601String(),
                        'sandbox' => $result->sandbox,
                    ];
                }, $post->targetList()))),
                'allowed_actions' => $post->status->allowedActions(),
                'created_by' => $post->created_by === null ? null : ['id' => $post->created_by, 'name' => $authors[$post->created_by] ?? null],
                'created_at' => $post->created_at?->toIso8601String(),
                'updated_at' => $post->updated_at?->toIso8601String(),
            ];
        }, $posts);
    }

    /**
     * @return array<string, mixed>
     */
    public function post(SocialPost $post): array
    {
        $post->loadMissing('results');

        return $this->posts([$post])[0];
    }

    /**
     * @return array<string, mixed>
     */
    public function feed(ProductFeed $feed): array
    {
        $base = $this->config->siteUrl().'/feeds/'.$feed->channel->value.'/'.$feed->token;

        return [
            'channel' => $feed->channel->value,
            'enabled' => $feed->enabled,
            'xml_url' => $base.'.xml',
            'csv_url' => $base.'.csv',
            'item_count' => $feed->item_count,
            'last_generated_at' => $feed->last_generated_at?->toIso8601String(),
            'updated_at' => $feed->updated_at?->toIso8601String(),
        ];
    }
}
