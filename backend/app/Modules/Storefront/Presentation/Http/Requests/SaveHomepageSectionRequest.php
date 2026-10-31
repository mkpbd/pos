<?php

namespace App\Modules\Storefront\Presentation\Http\Requests;

use App\Modules\Storefront\Domain\SectionType;
use App\Modules\Storefront\Infrastructure\Models\HomepageSection;
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

        $needsConfig = in_array($type, [SectionType::RichText, SectionType::FeaturesStrip, SectionType::Testimonials, SectionType::BannerGrid], true);
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
        };
    }
}
