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

    private const HEX = ['string', 'regex:/^#[0-9a-fA-F]{6}$/'];

    public function rules(): array
    {
        return self::themeRules();
    }

    /**
     * The rules of a theme document, its keys under `$prefix` (B3: `settings.` for the draft).
     *
     * @return array<string, mixed>
     */
    public static function themeRules(string $prefix = ''): array
    {
        $p = $prefix;
        [$sizeMin, $sizeMax] = ThemeSchema::TYPE_SCALE['body_size'];
        $decimal = fn (string $key) => ['sometimes', 'numeric', 'between:'.implode(',', ThemeSchema::TYPE_SCALE[$key])];

        $rules = [
            "{$p}preset" => ['sometimes', Rule::in(ThemeSchema::PRESETS)],
            "{$p}colors" => ['sometimes', 'array'],
            "{$p}typography" => ['sometimes', 'array'],
            "{$p}typography.heading_font" => ['sometimes', Rule::in(ThemeSchema::HEADING_FONTS)],
            "{$p}typography.body_font" => ['sometimes', Rule::in(ThemeSchema::BODY_FONTS)],
            // B3: the type scale (ThemeSchema::TYPE_SCALE).
            "{$p}typography.body_size" => ['sometimes', 'integer', "between:{$sizeMin},{$sizeMax}"],
            "{$p}typography.heading_scale" => $decimal('heading_scale'),
            "{$p}typography.line_height" => $decimal('line_height'),
            "{$p}typography.heading_weight" => ['sometimes', 'integer', Rule::in(range(ThemeSchema::TYPE_SCALE['heading_weight'][0], ThemeSchema::TYPE_SCALE['heading_weight'][1], 100))],
            "{$p}typography.mobile_scale" => $decimal('mobile_scale'),
            "{$p}typography.letter_spacing" => $decimal('letter_spacing'),
            // B3: the store's saved colours (≤ 8, `#rrggbb` or `#rrggbbaa`).
            "{$p}palette" => ['sometimes', 'array', 'list', 'max:'.ThemeSchema::MAX_PALETTE],
            "{$p}palette.*" => ['array:name,hex'],
            "{$p}palette.*.name" => ['required', 'string', 'max:'.ThemeSchema::MAX_PALETTE_NAME],
            "{$p}palette.*.hex" => ['required', 'string', 'regex:/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/'],
            "{$p}shape" => ['sometimes', 'array'],
            "{$p}shape.button_style" => ['sometimes', Rule::in(ThemeSchema::BUTTON_STYLES)],
            "{$p}shape.card_radius" => ['sometimes', 'integer', 'between:0,24'],
            "{$p}layout" => ['sometimes', 'array'],
            "{$p}layout.container_width" => ['sometimes', 'integer', 'between:960,1440'],
            "{$p}layout.sticky_header" => ['sometimes', 'boolean'],
            "{$p}layout.header_style" => ['sometimes', Rule::in(ThemeSchema::HEADER_STYLES)],
            "{$p}layout.footer_style" => ['sometimes', Rule::in(ThemeSchema::FOOTER_STYLES)],
            "{$p}layout.card_style" => ['sometimes', Rule::in(ThemeSchema::CARD_STYLES)],
            "{$p}layout.hero_style" => ['sometimes', Rule::in(ThemeSchema::HERO_STYLES)],
            "{$p}layout.heading_case" => ['sometimes', Rule::in(ThemeSchema::HEADING_CASES)],
            "{$p}layout.top_bar" => ['sometimes', Rule::in(ThemeSchema::TOP_BARS)],
            // B4: products per row on listings, per device.
            "{$p}layout.listing_columns" => ['sometimes', 'array'],
            "{$p}layout.listing_columns.desktop" => ['sometimes', 'integer', Rule::in(ThemeSchema::LISTING_COLUMNS['desktop'])],
            "{$p}layout.listing_columns.tablet" => ['sometimes', 'integer', Rule::in(ThemeSchema::LISTING_COLUMNS['tablet'])],
            "{$p}layout.listing_columns.mobile" => ['sometimes', 'integer', Rule::in(ThemeSchema::LISTING_COLUMNS['mobile'])],
            // P1b: the product page layout.
            "{$p}layout.product" => ['sometimes', 'array'],
            "{$p}layout.product.gallery" => ['sometimes', Rule::in(ThemeSchema::PRODUCT_LAYOUT['gallery'])],
            "{$p}layout.product.thumbnails" => ['sometimes', Rule::in(ThemeSchema::PRODUCT_LAYOUT['thumbnails'])],
            "{$p}layout.product.sticky_summary" => ['sometimes', 'boolean'],
            "{$p}layout.product.details" => ['sometimes', Rule::in(ThemeSchema::PRODUCT_LAYOUT['details'])],
            "{$p}logo_media_id" => ['sometimes', 'nullable', 'uuid'],
            "{$p}favicon_media_id" => ['sometimes', 'nullable', 'uuid'],
            "{$p}announcement" => ['sometimes', 'array'],
            "{$p}announcement.enabled" => ['sometimes', 'boolean'],
            "{$p}announcement.text" => ['nullable', 'string', 'max:200', "required_if_accepted:{$p}announcement.enabled"],
            "{$p}announcement.link" => ['sometimes', 'nullable', new SafeLink],
            "{$p}announcement.background" => ['sometimes', ...self::HEX],
            "{$p}announcement.foreground" => ['sometimes', ...self::HEX],
            "{$p}announcement.starts_at" => ['sometimes', 'nullable', 'date'],
            "{$p}announcement.ends_at" => ['sometimes', 'nullable', 'date', "after:{$p}announcement.starts_at"],
            // E12b: {bn: {text}} (same limit as the text).
            ...TranslationInput::rules(self::ANNOUNCEMENT_TRANSLATIONS, "{$p}announcement.translations"),
            "{$p}footer" => ['sometimes', 'array'],
            "{$p}footer.about" => ['sometimes', 'nullable', 'string', 'max:500'],
            "{$p}footer.copyright" => ['sometimes', 'nullable', 'string', 'max:200'],
            "{$p}footer.contact" => ['sometimes', 'array'],
            "{$p}footer.contact.email" => ['sometimes', 'nullable', 'email', 'max:150'],
            "{$p}footer.contact.phone" => ['sometimes', 'nullable', 'string', 'max:32'],
            "{$p}footer.contact.address" => ['sometimes', 'nullable', 'string', 'max:255'],
            "{$p}footer.social" => ['sometimes', 'array'],
            "{$p}footer.payment_logo_media_ids" => ['sometimes', 'array', 'max:'.ThemeSchema::MAX_PAYMENT_LOGOS],
            "{$p}footer.payment_logo_media_ids.*" => ['uuid', 'distinct'],
        ];

        // B3: button, button text and link start as copies of primary / accent (ThemeSchema::DERIVED_COLORS).
        foreach ([...ThemeSchema::COLORS, ...array_keys(ThemeSchema::DERIVED_COLORS)] as $color) {
            $rules["{$p}colors.{$color}"] = ['sometimes', ...self::HEX];
        }
        // B3: null = automatic (ThemeSchema::AUTO_COLORS).
        foreach (ThemeSchema::AUTO_COLORS as $color) {
            $rules["{$p}colors.{$color}"] = ['sometimes', 'nullable', ...self::HEX];
        }
        foreach (ThemeSchema::SOCIAL_NETWORKS as $network) {
            $rules["{$p}footer.social.{$network}"] = ['sometimes', 'nullable', 'url:https', 'max:255'];
        }

        return $rules;
    }
}
