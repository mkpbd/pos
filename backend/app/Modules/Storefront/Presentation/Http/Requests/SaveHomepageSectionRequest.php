<?php

namespace App\Modules\Storefront\Presentation\Http\Requests;

use App\Modules\Shared\Application\Support\TranslationInput;
use App\Modules\Storefront\Domain\SectionType;
use App\Modules\Storefront\Infrastructure\Models\HomepageSection;
use App\Modules\Storefront\Presentation\Http\Rules\SafeLink;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * A homepage section. The config rules depend on the section's type, which is given on
 * creation and fixed afterwards. On update, a sent `config` replaces the whole config.
 */
class SaveHomepageSectionRequest extends FormRequest
{
    public function rules(): array
    {
        $section = $this->route('section');
        $creating = ! $section instanceof HomepageSection;
        $type = $creating ? SectionType::tryFrom((string) $this->input('type')) : $section->type;

        $rules = [
            'type' => $creating ? ['required', Rule::enum(SectionType::class)] : ['prohibited'],
            'title' => ['sometimes', 'nullable', 'string', 'max:120'],
            'subtitle' => ['sometimes', 'nullable', 'string', 'max:255'],
            'is_enabled' => ['sometimes', 'boolean'],
            'starts_at' => ['sometimes', 'nullable', 'date'],
            'ends_at' => ['sometimes', 'nullable', 'date'],
        ];

        if ($type === null) {
            return $rules;
        }

        if ($type->itemLimits() !== null) {
            $rules['banner_ids'] = [$creating ? 'required' : 'sometimes', 'array', 'max:'.$type->itemLimits()['max']];
            $rules['banner_ids.*'] = ['uuid', 'distinct'];
        } else {
            $rules['banner_ids'] = ['prohibited'];
        }

        // Hand-picked products, categories or brands (used when the config's source is `manual`).
        if (($manual = $type->manualItemLimits()) !== null) {
            $rules['item_ids'] = ['sometimes', 'array', 'max:'.$manual['max']];
            $rules['item_ids.*'] = ['uuid', 'distinct'];
        } else {
            $rules['item_ids'] = ['prohibited'];
        }

        // E12b: {bn: {title, subtitle, …the type's config texts}}.
        $rules += TranslationInput::rules($type->translatable());

        $needsConfig = in_array($type, [SectionType::RichText, SectionType::FeaturesStrip, SectionType::Testimonials, SectionType::BannerGrid, SectionType::ProductTabs], true);
        $rules['config'] = [$creating && $needsConfig ? 'required' : 'sometimes', 'array'];

        return $rules + $this->configRules($type);
    }

    public function messages(): array
    {
        return ['type.prohibited' => 'A section\'s type cannot change. Add a new section instead.'];
    }

    /**
     * @return array<string, mixed>
     */
    private function configRules(SectionType $type): array
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
                'config.view_all_url' => ['sometimes', 'nullable', new SafeLink],
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
                'config.view_all_url' => ['sometimes', 'nullable', new SafeLink],
            ],
            SectionType::HotDeals => [
                'config.promotion_id' => ['sometimes', 'nullable', 'uuid'],
                'config.limit' => ['sometimes', 'integer', 'between:'.implode(',', SectionType::LIMITS['hot_deals'])],
                'config.view_all_url' => ['sometimes', 'nullable', new SafeLink],
            ],
        };
    }
}
