<?php

namespace App\Modules\Storefront\Presentation\Http\Requests;

use App\Modules\Shared\Application\Support\TranslationInput;
use App\Modules\Storefront\Domain\ThemeSchema;
use App\Modules\Storefront\Presentation\Http\Rules\SafeLink;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * The whole theme document. Omitted keys take their defaults (ThemeSchema).
 */
class SaveThemeRequest extends FormRequest
{
    public const ANNOUNCEMENT_TRANSLATIONS = ['text' => ['max:200']];

    public function rules(): array
    {
        $hex = ['string', 'regex:/^#[0-9a-fA-F]{6}$/'];

        $rules = [
            'preset' => ['sometimes', Rule::in(ThemeSchema::PRESETS)],
            'colors' => ['sometimes', 'array'],
            'typography' => ['sometimes', 'array'],
            'typography.heading_font' => ['sometimes', Rule::in(ThemeSchema::HEADING_FONTS)],
            'typography.body_font' => ['sometimes', Rule::in(ThemeSchema::BODY_FONTS)],
            'shape' => ['sometimes', 'array'],
            'shape.button_style' => ['sometimes', Rule::in(ThemeSchema::BUTTON_STYLES)],
            'shape.card_radius' => ['sometimes', 'integer', 'between:0,24'],
            'layout' => ['sometimes', 'array'],
            'layout.container_width' => ['sometimes', 'integer', 'between:960,1440'],
            'layout.sticky_header' => ['sometimes', 'boolean'],
            'layout.header_style' => ['sometimes', Rule::in(ThemeSchema::HEADER_STYLES)],
            'layout.footer_style' => ['sometimes', Rule::in(ThemeSchema::FOOTER_STYLES)],
            'layout.card_style' => ['sometimes', Rule::in(ThemeSchema::CARD_STYLES)],
            'layout.hero_style' => ['sometimes', Rule::in(ThemeSchema::HERO_STYLES)],
            'layout.heading_case' => ['sometimes', Rule::in(ThemeSchema::HEADING_CASES)],
            'layout.top_bar' => ['sometimes', Rule::in(ThemeSchema::TOP_BARS)],
            'logo_media_id' => ['sometimes', 'nullable', 'uuid'],
            'favicon_media_id' => ['sometimes', 'nullable', 'uuid'],
            'announcement' => ['sometimes', 'array'],
            'announcement.enabled' => ['sometimes', 'boolean'],
            'announcement.text' => ['nullable', 'string', 'max:200', 'required_if_accepted:announcement.enabled'],
            'announcement.link' => ['sometimes', 'nullable', new SafeLink],
            'announcement.background' => ['sometimes', ...$hex],
            'announcement.foreground' => ['sometimes', ...$hex],
            'announcement.starts_at' => ['sometimes', 'nullable', 'date'],
            'announcement.ends_at' => ['sometimes', 'nullable', 'date', 'after:announcement.starts_at'],
            // E12b: {bn: {text}} (same limit as the text).
            ...TranslationInput::rules(self::ANNOUNCEMENT_TRANSLATIONS, 'announcement.translations'),
            'footer' => ['sometimes', 'array'],
            'footer.about' => ['sometimes', 'nullable', 'string', 'max:500'],
            'footer.copyright' => ['sometimes', 'nullable', 'string', 'max:200'],
            'footer.contact' => ['sometimes', 'array'],
            'footer.contact.email' => ['sometimes', 'nullable', 'email', 'max:150'],
            'footer.contact.phone' => ['sometimes', 'nullable', 'string', 'max:32'],
            'footer.contact.address' => ['sometimes', 'nullable', 'string', 'max:255'],
            'footer.social' => ['sometimes', 'array'],
            'footer.payment_logo_media_ids' => ['sometimes', 'array', 'max:'.ThemeSchema::MAX_PAYMENT_LOGOS],
            'footer.payment_logo_media_ids.*' => ['uuid', 'distinct'],
        ];

        foreach (ThemeSchema::COLORS as $color) {
            $rules["colors.{$color}"] = ['sometimes', ...$hex];
        }
        foreach (ThemeSchema::SOCIAL_NETWORKS as $network) {
            $rules["footer.social.{$network}"] = ['sometimes', 'nullable', 'url:https', 'max:255'];
        }

        return $rules;
    }
}
