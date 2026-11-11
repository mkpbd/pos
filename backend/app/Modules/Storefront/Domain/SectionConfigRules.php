<?php

namespace App\Modules\Storefront\Domain;

use Closure;
use Illuminate\Validation\Rule;

/**
 * The value rules of a homepage section's `config`, per type — the one source shared by the
 * homepage section API (SaveHomepageSectionRequest) and the store builder's wrapped-section
 * elements (B1, BuilderDocumentSchema). Laravel validation rules over `config.*`; they need
 * no database.
 */
final class SectionConfigRules
{
    /** Types whose config must be sent when a section of the type is created. */
    private const CONFIG_REQUIRED = [SectionType::RichText, SectionType::FeaturesStrip, SectionType::Testimonials, SectionType::BannerGrid, SectionType::ProductTabs];

    public static function requiresConfig(SectionType $type): bool
    {
        return in_array($type, self::CONFIG_REQUIRED, true);
    }

    /**
     * A site path such as /sale or an http(s) URL (LinkTarget), as a validation rule.
     */
    public static function safeLink(): Closure
    {
        return function (string $attribute, mixed $value, Closure $fail): void {
            if (! is_string($value) || ! LinkTarget::isSafe($value)) {
                $fail('The :attribute must be a site path such as /sale or an http(s) URL.');
            }
        };
    }

    /**
     * @return array<string, mixed>
     */
    public static function for(SectionType $type): array
    {
        $hex = ['string', 'regex:/^#[0-9a-fA-F]{6}$/'];
        $optionalHex = ['sometimes', 'nullable', ...$hex];

        return match ($type) {
            SectionType::HeroSlider => [
                'config.autoplay_seconds' => ['sometimes', 'integer', Rule::in([0, ...range(3, 15)])],
                'config.height' => ['sometimes', Rule::in(['medium', 'large'])],
            ],
            SectionType::BannerGrid => [
                'config.layout' => ['required_with:config', Rule::in(SectionType::BANNER_GRID_LAYOUTS)],
            ],
            SectionType::RichText => [
                'config.body_html' => ['required_with:config', 'string', 'max:50000'],
                'config.alignment' => ['sometimes', Rule::in(['left', 'center'])],
                'config.width' => ['sometimes', Rule::in(['narrow', 'wide'])],
                'config.background' => $optionalHex,
            ],
            SectionType::FeaturesStrip => [
                'config.items' => ['required_with:config', 'array', 'min:1', 'max:'.SectionType::MAX_CONFIG_ITEMS['features_strip']],
                'config.items.*.icon' => ['required', Rule::in(SectionType::FEATURE_ICONS)],
                'config.items.*.title' => ['required', 'string', 'max:60'],
                'config.items.*.text' => ['sometimes', 'nullable', 'string', 'max:160'],
                'config.background' => $optionalHex,
            ],
            SectionType::Testimonials => [
                'config.items' => ['required_with:config', 'array', 'min:1', 'max:'.SectionType::MAX_CONFIG_ITEMS['testimonials']],
                'config.items.*.quote' => ['required', 'string', 'max:500'],
                'config.items.*.name' => ['required', 'string', 'max:80'],
                'config.items.*.role' => ['sometimes', 'nullable', 'string', 'max:80'],
                'config.items.*.rating' => ['sometimes', 'nullable', 'integer', 'between:1,5'],
                'config.items.*.avatar_media_id' => ['sometimes', 'nullable', 'uuid'],
                'config.background' => $optionalHex,
            ],
            SectionType::Newsletter => [
                'config.text' => ['sometimes', 'nullable', 'string', 'max:255'],
                'config.button_label' => ['sometimes', 'string', 'max:30'],
                'config.image_media_id' => ['sometimes', 'nullable', 'uuid'],
                'config.background' => ['sometimes', ...$hex],
                'config.foreground' => ['sometimes', ...$hex],
            ],
            SectionType::ProductCarousel, SectionType::ProductGrid => [
                'config.source' => ['sometimes', Rule::in(SectionType::PRODUCT_SOURCES)],
                'config.category_id' => ['required_if:config.source,category', 'nullable', 'uuid'],
                'config.limit' => ['sometimes', 'integer', 'between:'.implode(',', SectionType::LIMITS[$type->value])],
                'config.view_all_url' => ['sometimes', 'nullable', self::safeLink()],
                ...($type === SectionType::ProductGrid ? ['config.columns' => ['sometimes', 'integer', Rule::in(SectionType::GRID_COLUMNS)]] : []),
            ],
            SectionType::ProductTabs => [
                'config.tabs' => ['required_with:config', 'array', 'min:'.SectionType::TABS['min'], 'max:'.SectionType::TABS['max']],
                'config.tabs.*' => ['array'],
                'config.tabs.*.label' => ['required', 'string', 'max:40'],
                'config.tabs.*.source' => ['required', Rule::in(array_values(array_diff(SectionType::PRODUCT_SOURCES, ['manual'])))],
                'config.tabs.*.category_id' => ['required_if:config.tabs.*.source,category', 'nullable', 'uuid'],
                'config.limit' => ['sometimes', 'integer', 'between:'.implode(',', SectionType::LIMITS['product_tabs'])],
            ],
            SectionType::CategoryStrip => [
                'config.source' => ['sometimes', Rule::in(SectionType::CATEGORY_STRIP_SOURCES)],
                'config.limit' => ['sometimes', 'integer', 'between:'.implode(',', SectionType::LIMITS['category_strip'])],
            ],
            SectionType::BrandStrip => [
                'config.source' => ['sometimes', Rule::in(SectionType::BRAND_STRIP_SOURCES)],
                'config.limit' => ['sometimes', 'integer', 'between:'.implode(',', SectionType::LIMITS['brand_strip'])],
            ],
            SectionType::BlogPosts => [
                'config.category_id' => ['sometimes', 'nullable', 'uuid'],
                'config.limit' => ['sometimes', 'integer', 'between:'.implode(',', SectionType::LIMITS['blog_posts'])],
                'config.view_all_url' => ['sometimes', 'nullable', self::safeLink()],
            ],
            SectionType::HotDeals => [
                'config.promotion_id' => ['sometimes', 'nullable', 'uuid'],
                'config.limit' => ['sometimes', 'integer', 'between:'.implode(',', SectionType::LIMITS['hot_deals'])],
                'config.view_all_url' => ['sometimes', 'nullable', self::safeLink()],
            ],
        };
    }
}
