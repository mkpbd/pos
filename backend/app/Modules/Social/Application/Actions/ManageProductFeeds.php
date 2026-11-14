<?php

namespace App\Modules\Social\Application\Actions;

use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Localization\LocaleContext;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Social\Domain\FeedChannel;
use App\Modules\Social\Infrastructure\Feeds\ProductFeedFiles;
use App\Modules\Social\Infrastructure\Models\ProductFeed;
use App\Modules\Storefront\Application\Queries\StorefrontConfig;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * P2b: the organization's three catalog feeds (Meta, TikTok, Pinterest) — created on first use
 * with a random 64-character token, disabled. Enabling generates the feed once (so the admin
 * sees its item count at once); rotating replaces the token, so the old address stops working
 * at once. Both audited (never the token).
 */
class ManageProductFeeds
{
    public function __construct(
        private readonly ProductFeedFiles $files,
        private readonly StorefrontConfig $storefront,
        private readonly LocaleContext $locale,
        private readonly AuditTrail $audit,
        private readonly TenantContext $tenant,
    ) {}

    /**
     * @return list<ProductFeed> in channel order
     */
    public function all(): array
    {
        $feeds = ProductFeed::query()->get()->keyBy(fn (ProductFeed $f) => $f->channel->value);
        $result = [];
        foreach (FeedChannel::cases() as $channel) {
            $result[] = $feeds[$channel->value] ?? $this->create($channel);
        }

        return $result;
    }

    public function find(FeedChannel $channel): ProductFeed
    {
        return ProductFeed::query()->where('channel', $channel->value)->first() ?? $this->create($channel);
    }

    public function setEnabled(FeedChannel $channel, bool $enabled): ProductFeed
    {
        $feed = DB::transaction(function () use ($channel, $enabled) {
            $feed = $this->locked($channel);
            if ($feed->enabled !== $enabled) {
                $feed->enabled = $enabled;
                $feed->save();
                $this->audit->record('social.feed_updated', $feed, ['enabled' => ! $enabled], ['enabled' => $enabled], ['channel' => $channel->value]);
            }

            return $feed;
        });
        if ($enabled) {
            // In the store's default language, as the feed's address serves it.
            $settings = $this->storefront->settings();
            $this->locale->runAs($settings->bangla_enabled ? $settings->default_locale : LocaleContext::EN, fn () => $this->files->generate($feed, 'xml'));
        } else {
            $this->files->forget($feed);
        }

        return $feed->fresh() ?? $feed;
    }

    public function rotate(FeedChannel $channel): ProductFeed
    {
        $feed = DB::transaction(function () use ($channel) {
            $feed = $this->locked($channel);
            $feed->token = ProductFeed::newToken();
            $feed->save();
            $this->audit->record('social.feed_token_rotated', $feed, [], [], ['channel' => $channel->value]);

            return $feed;
        });
        $this->files->forget($feed);

        return $feed;
    }

    private function locked(FeedChannel $channel): ProductFeed
    {
        $this->find($channel);

        /** @var ProductFeed */
        return ProductFeed::query()->where('channel', $channel->value)->lockForUpdate()->firstOrFail();
    }

    private function create(FeedChannel $channel): ProductFeed
    {
        // Two first reads at once: the unique (organization, channel) index keeps one row.
        ProductFeed::query()->insertOrIgnore([
            'id' => (string) Str::uuid(),
            'organization_id' => $this->tenant->requireOrganization(),
            'channel' => $channel->value,
            'token' => ProductFeed::newToken(),
            'enabled' => false,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        /** @var ProductFeed */
        return ProductFeed::query()->where('channel', $channel->value)->firstOrFail();
    }
}
