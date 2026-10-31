<?php

namespace App\Modules\Storefront\Domain;

/**
 * Homepage section types and their configuration documents. Only types whose content and
 * link targets exist are offered: product, category and brand sections arrive with the
 * online catalog (E6), deal countdowns with promotions (E8), blog teasers with the blog (E11).
 *
 * Like ThemeSchema, defaults() defines each config's shape and normalize() fills gaps and
 * drops unknown keys; value validation lives with the HTTP request.
 */
enum SectionType: string
{
    case HeroSlider = 'hero_slider';
    case BannerGrid = 'banner_grid';
    case RichText = 'rich_text';
    case FeaturesStrip = 'features_strip';
    case Testimonials = 'testimonials';
    case Newsletter = 'newsletter';

    public const BANNER_GRID_LAYOUTS = ['2-col', '3-col', '3-col-split', '4-col'];

    /** Icons a features strip can use (rendered from the storefront's icon set). */
    public const FEATURE_ICONS = ['truck', 'shield-check', 'credit-card', 'headset', 'gift', 'rotate-ccw', 'badge-percent', 'clock', 'leaf', 'heart', 'star', 'store'];

    public const MAX_CONFIG_ITEMS = ['features_strip' => 6, 'testimonials' => 12];

    public function label(): string
    {
        return match ($this) {
            self::HeroSlider => 'Hero slider',
            self::BannerGrid => 'Banner grid',
            self::RichText => 'Text block',
            self::FeaturesStrip => 'Features strip',
            self::Testimonials => 'Testimonials',
            self::Newsletter => 'Newsletter sign-up',
        };
    }

    public function description(): string
    {
        return match ($this) {
            self::HeroSlider => 'Full-width slides with headline and buttons, from hero slider banners.',
            self::BannerGrid => 'Two to four promo tiles side by side, from homepage promo banners.',
            self::RichText => 'Formatted text: headings, paragraphs, lists, links and images.',
            self::FeaturesStrip => 'Icons with a short title and text, e.g. delivery, payment, returns.',
            self::Testimonials => 'Customer quotes with name, role and photo.',
            self::Newsletter => 'An e-mail sign-up form with double opt-in.',
        };
    }

    /**
     * The placement of the banners this type shows, or null when it has no items.
     */
    public function bannerPlacement(): ?BannerPlacement
    {
        return match ($this) {
            self::HeroSlider => BannerPlacement::HeroSlider,
            self::BannerGrid => BannerPlacement::HomePromo,
            default => null,
        };
    }

    /**
     * @return array{min: int, max: int}|null attached items allowed, null when the type has none
     */
    public function itemLimits(): ?array
    {
        return match ($this) {
            self::HeroSlider => ['min' => 1, 'max' => 10],
            self::BannerGrid => ['min' => 2, 'max' => 8],
            default => null,
        };
    }

    /**
     * @return array<string, mixed>
     */
    public function defaults(): array
    {
        return match ($this) {
            self::HeroSlider => ['autoplay_seconds' => 6, 'height' => 'large'],
            self::BannerGrid => ['layout' => '3-col'],
            self::RichText => ['body_html' => '', 'alignment' => 'left', 'width' => 'narrow', 'background' => null],
            self::FeaturesStrip => ['items' => [], 'background' => null],
            self::Testimonials => ['items' => [], 'background' => null],
            self::Newsletter => ['text' => null, 'button_label' => 'Subscribe', 'image_media_id' => null, 'background' => '#c2410c', 'foreground' => '#ffffff'],
        };
    }

    /**
     * @param  array<string, mixed>  $config
     * @return array<string, mixed>
     */
    public function normalize(array $config): array
    {
        $result = [];
        foreach ($this->defaults() as $key => $default) {
            $result[$key] = array_key_exists($key, $config) ? $config[$key] : $default;
        }

        if ($this === self::FeaturesStrip) {
            $result['items'] = array_map(fn (array $i) => [
                'icon' => $i['icon'] ?? 'star',
                'title' => $i['title'] ?? '',
                'text' => $i['text'] ?? null,
            ], array_values(array_filter((array) $result['items'], 'is_array')));
        }
        if ($this === self::Testimonials) {
            $result['items'] = array_map(fn (array $i) => [
                'quote' => $i['quote'] ?? '',
                'name' => $i['name'] ?? '',
                'role' => $i['role'] ?? null,
                'rating' => isset($i['rating']) ? (int) $i['rating'] : null,
                'avatar_media_id' => $i['avatar_media_id'] ?? null,
            ], array_values(array_filter((array) $result['items'], 'is_array')));
        }

        return $result;
    }

    /**
     * Media ids kept inside a (normalized) config.
     *
     * @param  array<string, mixed>  $config
     * @return list<string>
     */
    public function mediaIds(array $config): array
    {
        $ids = match ($this) {
            self::Testimonials => array_column($config['items'] ?? [], 'avatar_media_id'),
            self::Newsletter => [$config['image_media_id'] ?? null],
            default => [],
        };

        return array_values(array_unique(array_filter($ids, 'is_string')));
    }
}
