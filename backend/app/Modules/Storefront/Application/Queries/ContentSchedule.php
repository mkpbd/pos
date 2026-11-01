<?php

namespace App\Modules\Storefront\Application\Queries;

use App\Modules\Cms\Application\Contracts\BlogDirectory;
use App\Modules\Cms\Application\Contracts\PageDirectory;
use App\Modules\OnlineCatalog\Application\Contracts\StorefrontCatalog;
use App\Modules\Storefront\Infrastructure\Models\Banner;
use App\Modules\Storefront\Infrastructure\Models\HomepageSection;
use Carbon\CarbonImmutable;
use DateTimeInterface;

/**
 * The next instant something scheduled changes what the storefront shows (E12): a banner,
 * homepage section or the announcement starting or ending, a listing window, an automatic
 * promotion, a blog post or page publication. Cached storefront payloads expire then, so
 * scheduled content goes live on time without a write to bump the content version.
 */
class ContentSchedule
{
    public function __construct(
        private readonly StorefrontConfig $config,
        private readonly StorefrontCatalog $catalog,
        private readonly BlogDirectory $blog,
        private readonly PageDirectory $pages,
    ) {}

    public function nextChange(): ?CarbonImmutable
    {
        $now = now();
        $announcement = $this->config->theme()->settings['announcement'] ?? [];
        $times = [
            Banner::query()->where('is_active', true)->where('starts_at', '>', $now)->min('starts_at'),
            Banner::query()->where('is_active', true)->where('ends_at', '>', $now)->min('ends_at'),
            HomepageSection::query()->where('is_enabled', true)->where('starts_at', '>', $now)->min('starts_at'),
            HomepageSection::query()->where('is_enabled', true)->where('ends_at', '>', $now)->min('ends_at'),
            $this->catalog->nextScheduledChange(),
            $this->blog->nextPublicationAt(),
            $this->pages->nextPublicationAt(),
        ];
        if (($announcement['enabled'] ?? false) === true) {
            foreach (['starts_at', 'ends_at'] as $key) {
                if (is_string($announcement[$key] ?? null) && CarbonImmutable::parse($announcement[$key])->gt($now)) {
                    $times[] = $announcement[$key];
                }
            }
        }

        $stamps = [];
        foreach ($times as $time) {
            if ($time instanceof DateTimeInterface) {
                $stamps[] = $time->getTimestamp();
            } elseif (is_string($time) && $time !== '') {
                $stamps[] = CarbonImmutable::parse($time)->getTimestamp();
            }
        }

        return $stamps === [] ? null : CarbonImmutable::createFromTimestamp(min($stamps));
    }
}
