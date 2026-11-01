<?php

namespace App\Modules\Storefront\Application\Queries;

use App\Modules\Cms\Application\Contracts\BlogDirectory;
use App\Modules\Media\Application\Contracts\MediaLibrary;
use App\Modules\OnlineCatalog\Application\Contracts\StorefrontCatalog;
use App\Modules\Shared\Application\Contracts\StorefrontContentVersion;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Storefront\Domain\SectionType;
use App\Modules\Storefront\Infrastructure\Models\Banner;
use App\Modules\Storefront\Infrastructure\Models\HomepageSection;
use App\Modules\Storefront\Infrastructure\Models\HomepageSectionItem;

/**
 * The homepage as the storefront renders it: sections in order with their banners and
 * media resolved. Only live sections are included, and a section whose banners are all
 * inactive or out of their schedule is left out, so an empty block never renders.
 *
 * The preview (staff only) includes every section with its state, so the admin can see
 * disabled and scheduled sections in place before publishing them.
 */
class StorefrontHomepage
{
    public function __construct(
        private readonly MediaLibrary $media,
        private readonly StorefrontCatalog $catalog,
        private readonly BlogDirectory $blog,
        private readonly StorefrontContentVersion $version,
        private readonly TenantContext $tenant,
        private readonly ContentSchedule $schedule,
    ) {}

    /**
     * @return array{sections: list<array<string, mixed>>}
     */
    public function build(bool $preview = false): array
    {
        if ($preview) {
            return $this->compute(true);
        }

        // E12: the public homepage is cached per content version until the next scheduled change.
        return $this->version->remember(
            $this->tenant->requireOrganization(),
            'homepage',
            fn () => $this->compute(false),
            fn () => $this->schedule->nextChange(),
        );
    }

    /**
     * @return array{sections: list<array<string, mixed>>}
     */
    private function compute(bool $preview): array
    {
        $sections = HomepageSection::query()->with('items')->orderBy('sort_order')->get();
        if (! $preview) {
            $sections = $sections->filter(fn (HomepageSection $s) => $s->scheduleState() === 'live');
        }

        $bannerIds = $sections->flatMap(fn (HomepageSection $s) => $s->items->where('item_type', HomepageSectionItem::TYPE_BANNER)->pluck('item_id'))->unique()->values()->all();
        $banners = $bannerIds === [] ? collect() : Banner::query()->live()->whereIn('id', $bannerIds)->get()->keyBy('id');

        $mediaIds = $banners->flatMap(fn (Banner $b) => array_filter([$b->desktop_media_id, $b->mobile_media_id]))->all();
        foreach ($sections as $section) {
            array_push($mediaIds, ...$section->type->mediaIds($section->type->normalize($section->config)));
        }
        $refs = $this->media->refs(array_values(array_unique($mediaIds)));
        $ref = fn (?string $id) => $id !== null ? ($refs[$id] ?? null) : null;

        $result = [];
        foreach ($sections as $section) {
            $type = $section->type;
            $config = $type->normalize($section->config);
            $state = $section->scheduleState();

            $sectionBanners = [];
            if ($type->bannerPlacement() !== null) {
                foreach ($section->items as $item) {
                    $banner = $banners->get($item->item_id);
                    if ($banner !== null && $banner->desktop_media_id !== null && $ref($banner->desktop_media_id) !== null) {
                        $sectionBanners[] = $this->banner($banner, $ref);
                    }
                }
                if ($sectionBanners === []) {
                    if (! $preview) {
                        continue;
                    }
                    $state = $state === 'live' ? 'empty' : $state;
                }
            }

            $catalogContent = $this->catalogContent($section, $type, $config);
            if ($catalogContent !== null && $this->isEmpty($catalogContent)) {
                if (! $preview) {
                    continue;
                }
                $state = $state === 'live' ? 'empty' : $state;
            }

            $data = [
                'id' => $section->id,
                'type' => $type->value,
                'title' => $section->title,
                'subtitle' => $section->subtitle,
                'config' => $this->publicConfig($type, $config, $ref),
            ];
            if ($type->bannerPlacement() !== null) {
                $data['banners'] = $sectionBanners;
            }
            $data += $catalogContent ?? [];
            if ($preview) {
                $data['state'] = $state;
            }
            $result[] = $data;
        }

        return ['sections' => $result];
    }

    /**
     * Products, categories or brands of a catalog section, from the online catalog, or the
     * posts of a blog section; null for other section types. Records that are not (or no longer) live or visible drop out.
     *
     * @param  array<string, mixed>  $config  normalized
     * @return array<string, mixed>|null
     */
    private function catalogContent(HomepageSection $section, SectionType $type, array $config): ?array
    {
        $manual = $type->manualItemLimits();
        $picked = fn () => $section->items->where('item_type', $manual['type'])->sortBy('sort_order')->pluck('item_id')->values()->all();

        return match ($type) {
            SectionType::ProductCarousel, SectionType::ProductGrid => ['products' => $config['source'] === 'manual'
                ? array_slice($this->catalog->productCards($picked()), 0, $config['limit'])
                : $this->catalog->sourceProductCards($config['source'], $config['category_id'], $config['limit'])],
            SectionType::ProductTabs => ['tabs' => array_values(array_filter(array_map(fn (array $tab) => [
                'label' => $tab['label'],
                'products' => $this->catalog->sourceProductCards($tab['source'], $tab['category_id'], $config['limit']),
            ], $config['tabs']), fn (array $tab) => $tab['products'] !== []))],
            SectionType::CategoryStrip => ['categories' => $this->catalog->categoryStrip($config['source'] === 'manual' ? $picked() : null, $config['limit'])],
            SectionType::BrandStrip => ['brands' => $this->catalog->brandStrip($config['source'] === 'manual' ? $picked() : null, $config['limit'])],
            SectionType::HotDeals => $this->hotDeals($config),
            // E11: the newest readable blog posts (public list rows).
            SectionType::BlogPosts => ['posts' => $this->blog->postCards(is_string($config['category_id']) ? $config['category_id'] : null, (int) $config['limit'])],
            default => null,
        };
    }

    /**
     * Products of the live countdown promotions (cards carry their promotion) and the
     * earliest end among them, which the section counts down to.
     *
     * @param  array<string, mixed>  $config  normalized
     * @return array{products: list<array<string, mixed>>, ends_at: ?string}
     */
    private function hotDeals(array $config): array
    {
        $products = $this->catalog->hotDealCards(is_string($config['promotion_id']) ? $config['promotion_id'] : null, (int) $config['limit']);
        $ends = array_values(array_filter(array_map(fn (array $card) => $card['promotion']['ends_at'] ?? null, $products)));
        usort($ends, fn (string $a, string $b) => strtotime($a) <=> strtotime($b));

        return ['products' => $products, 'ends_at' => $ends[0] ?? null];
    }

    /**
     * @param  array<string, mixed>  $content
     */
    private function isEmpty(array $content): bool
    {
        return array_key_exists('products', $content) ? $content['products'] === [] : reset($content) === [];
    }

    /**
     * @return array<string, mixed>
     */
    private function banner(Banner $b, callable $ref): array
    {
        return [
            'id' => $b->id,
            'kicker' => $b->kicker,
            'title' => $b->title,
            'subtitle' => $b->subtitle,
            'link_url' => $b->link_url,
            'button_label' => $b->button_label,
            'secondary_link_url' => $b->secondary_link_url,
            'secondary_button_label' => $b->secondary_button_label,
            'image' => $ref($b->desktop_media_id),
            'mobile_image' => $ref($b->mobile_media_id),
            'text_color' => $b->text_color,
            'text_position' => $b->text_position,
        ];
    }

    /**
     * Media ids in the config become media objects.
     *
     * @param  array<string, mixed>  $config  normalized
     * @return array<string, mixed>
     */
    private function publicConfig(SectionType $type, array $config, callable $ref): array
    {
        return match ($type) {
            SectionType::Testimonials => [
                ...$config,
                'items' => array_map(function (array $item) use ($ref) {
                    $item['avatar'] = $ref($item['avatar_media_id']);
                    unset($item['avatar_media_id']);

                    return $item;
                }, $config['items']),
            ],
            SectionType::Newsletter => (function () use ($config, $ref) {
                $config['image'] = $ref($config['image_media_id']);
                unset($config['image_media_id']);

                return $config;
            })(),
            default => $config,
        };
    }
}
