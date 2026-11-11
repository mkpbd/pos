<?php

namespace App\Modules\Storefront\Application\Queries;

use App\Modules\Media\Application\Contracts\MediaLibrary;
use App\Modules\OnlineCatalog\Application\Contracts\StorefrontCatalog;
use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Storefront\Domain\BannerPlacement;
use App\Modules\Storefront\Infrastructure\Models\Banner;
use App\Modules\Storefront\Infrastructure\Models\StorefrontDomain;
use Illuminate\Contracts\Container\Container;

/**
 * T2: the demo gallery — the configured demo hosts (`storefront.demo_hosts`, in that order)
 * whose domain exists, whose organization is active and whose store is open, each with what
 * its own storefront shows publicly anyway: name, preset, a tagline (the announcement, else the
 * footer text), three theme colours, the heading font, the first hero image, the number of
 * live products and up to six visible top-level categories.
 */
class DemoStoreGallery
{
    public const TAGLINE_LENGTH = 140;

    public const CATEGORY_LIMIT = 6;

    public function __construct(
        private readonly TenantContext $tenant,
        private readonly OrganizationDirectory $organizations,
        private readonly StorefrontConfig $config,
        private readonly Container $container,
        private readonly MediaLibrary $media,
    ) {}

    /**
     * @return list<array{host: string, name: string, preset: string, tagline: ?string, colors: array{primary: string, accent: string, canvas: string}, heading_font: string, image_url: ?string, product_count: int, category_names: list<string>}>
     */
    public function list(): array
    {
        $hosts = array_values(array_unique(array_map(fn ($h) => mb_strtolower((string) $h), (array) config('storefront.demo_hosts'))));
        if ($hosts === []) {
            return [];
        }
        $organizations = StorefrontDomain::query()->withoutGlobalScopes()->whereIn('host', $hosts)->pluck('organization_id', 'host');

        $demos = [];
        foreach ($hosts as $host) {
            $organizationId = $organizations[$host] ?? null;
            if ($organizationId === null || ! $this->organizations->isActive($organizationId)) {
                continue;
            }
            $demo = $this->tenant->runAs($organizationId, fn () => $this->describe($host));
            if ($demo !== null) {
                $demos[] = $demo;
            }
        }

        return $demos;
    }

    /**
     * @return ?array<string, mixed> null when the store is closed
     */
    private function describe(string $host): ?array
    {
        $settings = $this->config->settings();
        if (! $settings->is_enabled) {
            return null;
        }
        $theme = $this->config->theme()->settings;
        // One catalog per organization: its read model caches the organization's category tree.
        $catalog = $this->container->make(StorefrontCatalog::class);

        $announcement = $theme['announcement']['enabled'] ? $theme['announcement']['text'] : null;
        $tagline = is_string($announcement) && trim($announcement) !== '' ? $announcement : $theme['footer']['about'];

        $banner = Banner::query()->live()
            ->whereIn('placement', [BannerPlacement::HeroSlider, BannerPlacement::HomePromo])
            ->orderByRaw('CASE WHEN placement = ? THEN 0 ELSE 1 END', [BannerPlacement::HeroSlider->value])
            ->orderBy('sort_order')->orderBy('created_at')
            ->first(['desktop_media_id']);
        $image = $banner === null ? null : ($this->media->refs([$banner->desktop_media_id])[$banner->desktop_media_id] ?? null);

        return [
            'host' => $host,
            'name' => $settings->site_name,
            'preset' => $theme['preset'],
            'tagline' => is_string($tagline) && trim($tagline) !== '' ? mb_strimwidth(trim($tagline), 0, self::TAGLINE_LENGTH, '…') : null,
            'colors' => [
                'primary' => $theme['colors']['primary'],
                'accent' => $theme['colors']['accent'],
                'canvas' => $theme['colors']['canvas'],
            ],
            'heading_font' => $theme['typography']['heading_font'],
            'image_url' => $image['url'] ?? null,
            'product_count' => count($catalog->sitemapEntries('product')),
            'category_names' => array_column($catalog->categoryStrip(null, self::CATEGORY_LIMIT), 'name'),
        ];
    }
}
