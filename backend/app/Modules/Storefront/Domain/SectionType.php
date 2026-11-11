<?php

namespace App\Modules\Storefront\Domain;

/**
 * Homepage section types and their configuration documents. Only types whose content and
 * link targets exist are offered: product, category and brand sections come from the online
 * catalog (E6; category tabs are product tabs with category sources), hot deals with a
 * countdown come with promotions (E8b), blog teasers with the blog (E11).
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
    case ProductCarousel = 'product_carousel';
    case ProductGrid = 'product_grid';
    case ProductTabs = 'product_tabs';
    case CategoryStrip = 'category_strip';
    case BrandStrip = 'brand_strip';
    case HotDeals = 'hot_deals';
    case BlogPosts = 'blog_posts';

    public const BANNER_GRID_LAYOUTS = ['2-col', '3-col', '3-col-split', '4-col'];

    /** Banners a banner-grid layout needs at least (the split layout exactly). */
    public const BANNER_GRID_MINIMUM = ['2-col' => 2, '3-col' => 3, '3-col-split' => 4, '4-col' => 4];

    /** Icons a features strip can use (rendered from the storefront's icon set). */
    public const FEATURE_ICONS = ['truck', 'shield-check', 'credit-card', 'headset', 'gift', 'rotate-ccw', 'badge-percent', 'clock', 'leaf', 'heart', 'star', 'store'];

    public const MAX_CONFIG_ITEMS = ['features_strip' => 6, 'testimonials' => 12];

    /** Where product sections take their products from; `manual` uses the section's items. */
    public const PRODUCT_SOURCES = ['manual', 'featured', 'new_arrivals', 'best_sellers', 'on_sale', 'category'];

    public const GRID_COLUMNS = [3, 4, 5];

    public const CATEGORY_STRIP_SOURCES = ['manual', 'top_level'];

    public const BRAND_STRIP_SOURCES = ['manual', 'all'];

    /** Bounds of `limit` per type. */
    public const LIMITS = [
        'product_carousel' => [4, 24],
        'product_grid' => [4, 24],
        'product_tabs' => [4, 12],
        'category_strip' => [4, 16],
        'brand_strip' => [4, 24],
        'hot_deals' => [4, 12],
        'blog_posts' => [3, 12],
    ];

    public const TABS = ['min' => 2, 'max' => 5];

    public function label(): string
    {
        return match ($this) {
            self::HeroSlider => 'Hero slider',
            self::BannerGrid => 'Banner grid',
            self::RichText => 'Text block',
            self::FeaturesStrip => 'Features strip',
            self::Testimonials => 'Testimonials',
            self::Newsletter => 'Newsletter sign-up',
            self::ProductCarousel => 'Product carousel',
            self::ProductGrid => 'Product grid',
            self::ProductTabs => 'Product tabs',
            self::CategoryStrip => 'Category strip',
            self::BrandStrip => 'Brand strip',
            self::HotDeals => 'Hot deals',
            self::BlogPosts => 'Blog posts',
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
            self::ProductCarousel => 'A sliding row of products: hand-picked, featured, new, best sellers, on sale or from a category.',
            self::ProductGrid => 'Products in a grid of three to five columns, from the same sources as the carousel.',
            self::ProductTabs => 'Two to five tabs of products, e.g. New arrivals / Best sellers / On sale, or one tab per category.',
            self::CategoryStrip => 'Category tiles with image and product count: hand-picked or the top level.',
            self::BrandStrip => 'A row of brand logos: hand-picked or every brand.',
            self::HotDeals => 'A countdown to the end of a flash sale with its products: one promotion or every running flash sale. Hidden when none is running.',
            self::BlogPosts => 'The newest blog posts, from every category or one. Hidden while there are none.',
        };
    }

    /**
     * Texts a section of this type can have translated (E12b), with the limits of their base
     * fields: the title and subtitle of every section, plus the text block's `body_html`
     * (rich text) and the newsletter's `text` and `button_label` from the config.
     *
     * @return array<string, list<string>>
     */
    public function translatable(): array
    {
        return ['title' => ['max:120'], 'subtitle' => ['max:255']] + match ($this) {
            self::RichText => ['body_html' => ['max:50000']],
            self::Newsletter => ['text' => ['max:255'], 'button_label' => ['max:30']],
            default => [],
        };
    }

    /**
     * Translatable fields kept in the config rather than in columns (E12b).
     *
     * @return list<string>
     */
    public function translatableConfigFields(): array
    {
        return array_values(array_diff(array_keys($this->translatable()), ['title', 'subtitle']));
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
     * Records a section of this type can hand-pick (`item_ids`, used when its source is
     * `manual`), or null.
     *
     * @return array{type: string, min: int, max: int}|null
     */
    public function manualItemLimits(): ?array
    {
        return match ($this) {
            self::ProductCarousel, self::ProductGrid => ['type' => 'product', 'min' => 1, 'max' => 24],
            self::CategoryStrip => ['type' => 'category', 'min' => 1, 'max' => 16],
            self::BrandStrip => ['type' => 'brand', 'min' => 1, 'max' => 24],
            default => null,
        };
    }

    /**
     * Whether a (normalized) config takes its records from the section's hand-picked items.
     *
     * @param  array<string, mixed>  $config
     */
    public function usesManualItems(array $config): bool
    {
        return $this->manualItemLimits() !== null && ($config['source'] ?? null) === 'manual';
    }

    /**
     * Category ids a (normalized) config refers to (category sources).
     *
     * @param  array<string, mixed>  $config
     * @return list<string>
     */
    public function categoryIds(array $config): array
    {
        $ids = match ($this) {
            self::ProductCarousel, self::ProductGrid => [$config['category_id'] ?? null],
            self::ProductTabs => array_column($config['tabs'] ?? [], 'category_id'),
            default => [],
        };

        return array_values(array_unique(array_filter($ids, 'is_string')));
    }

    /**
     * @return array{min: int, max: int}|null attached banners allowed, null when the type shows none
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
     * Banners a section of this type needs for a (normalized) config: a banner grid needs at
     * least as many as its layout has tiles (the split layout exactly four). Null when the
     * type shows no banners. Shared by the homepage API and the store builder (B1).
     *
     * @param  array<string, mixed>  $config
     * @return array{min: int, max: int}|null
     */
    public function bannerLimits(array $config): ?array
    {
        $limits = $this->itemLimits();
        if ($limits === null || $this !== self::BannerGrid) {
            return $limits;
        }
        $layout = $config['layout'] ?? null;

        return [
            'min' => self::BANNER_GRID_MINIMUM[$layout] ?? $limits['min'],
            'max' => $layout === '3-col-split' ? 4 : $limits['max'],
        ];
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
            self::ProductCarousel => ['source' => 'featured', 'category_id' => null, 'limit' => 8, 'view_all_url' => null],
            self::ProductGrid => ['source' => 'featured', 'category_id' => null, 'limit' => 8, 'columns' => 4, 'view_all_url' => null],
            self::ProductTabs => ['tabs' => [], 'limit' => 8],
            self::CategoryStrip => ['source' => 'top_level', 'limit' => 8],
            self::BrandStrip => ['source' => 'all', 'limit' => 12],
            // promotion_id null = every live countdown promotion ("flash sale").
            self::HotDeals => ['promotion_id' => null, 'limit' => 8, 'view_all_url' => null],
            // category_id null = every category.
            self::BlogPosts => ['category_id' => null, 'limit' => 3, 'view_all_url' => '/blog'],
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

        if ($this === self::ProductCarousel || $this === self::ProductGrid) {
            $result['category_id'] = $result['source'] === 'category' ? $result['category_id'] : null;
        }
        if ($this === self::ProductTabs) {
            $result['tabs'] = array_map(fn (array $t) => [
                'label' => $t['label'] ?? '',
                'source' => $t['source'] ?? 'featured',
                'category_id' => ($t['source'] ?? null) === 'category' ? ($t['category_id'] ?? null) : null,
            ], array_values(array_filter((array) $result['tabs'], 'is_array')));
        }
        foreach (['limit', 'columns'] as $key) {
            if (isset($result[$key]) && is_numeric($result[$key])) {
                $result[$key] = (int) $result[$key];
            }
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
