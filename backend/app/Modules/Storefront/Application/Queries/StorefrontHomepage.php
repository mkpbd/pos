<?php

namespace App\Modules\Storefront\Application\Queries;

use App\Modules\Media\Application\Contracts\MediaLibrary;
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
    public function __construct(private readonly MediaLibrary $media) {}

    /**
     * @return array{sections: list<array<string, mixed>>}
     */
    public function build(bool $preview = false): array
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
            if ($preview) {
                $data['state'] = $state;
            }
            $result[] = $data;
        }

        return ['sections' => $result];
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
