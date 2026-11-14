<?php

namespace App\Modules\Storefront\Application\Actions;

use App\Modules\Media\Application\Contracts\MediaLibrary;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Support\TranslationInput;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Storefront\Application\Queries\CustomFonts;
use App\Modules\Storefront\Application\Queries\StorefrontConfig;
use App\Modules\Storefront\Domain\CustomCssPolicy;
use App\Modules\Storefront\Domain\ThemeSchema;
use App\Modules\Storefront\Infrastructure\Models\ThemeSettings;
use Illuminate\Support\Facades\DB;

class SaveTheme
{
    public function __construct(
        private readonly StorefrontConfig $config,
        private readonly MediaLibrary $media,
        private readonly AuditTrail $audit,
        private readonly CustomFonts $fonts,
    ) {}

    /**
     * Replaces the theme settings (missing keys take their defaults).
     *
     * @param  array<string, mixed>  $settings  validated
     */
    public function settings(array $settings): ThemeSettings
    {
        $settings = $this->prepare($settings);

        return DB::transaction(function () use ($settings) {
            $theme = $this->config->theme();
            $before = $theme->exists ? $theme->settings : [];
            $theme->settings = $settings;
            $theme->save();

            if ($before !== $settings) {
                $this->audit->record('storefront.theme_updated', $theme, ['settings' => $before], ['settings' => $settings]);
            }

            return $theme;
        });
    }

    /**
     * The stored form of a theme document: normalized (ThemeSchema), translations cleaned, every
     * media id checked against the library (`MEDIA_NOT_FOUND`). B3: theme drafts use it too.
     * B10: custom fonts must exist (`FONT_NOT_FOUND`, `details.font_ids` as `custom:<id>`).
     *
     * @param  array<string, mixed>  $settings  validated
     * @return array<string, mixed>
     */
    public function prepare(array $settings): array
    {
        $settings = ThemeSchema::normalize($settings);
        // E12b: the announcement's translations (the document is replaced, so are they).
        $settings['announcement']['translations'] = TranslationInput::apply(null, $settings['announcement']['translations'], ['text']);

        $ids = ThemeSchema::mediaIds($settings);
        $missing = array_values(array_diff($ids, $this->media->existing($ids)));
        if ($missing !== []) {
            throw new BusinessRuleViolation('MEDIA_NOT_FOUND', 'Some selected images no longer exist in the media library.', ['media_ids' => $missing]);
        }

        // B10: custom fonts (`custom:<id>`) must be the organization's own.
        $fontIds = ThemeSchema::customFontIds($settings);
        $missing = array_values(array_diff($fontIds, $this->fonts->existing($fontIds)));
        if ($missing !== []) {
            throw new BusinessRuleViolation('FONT_NOT_FOUND', 'Some selected fonts no longer exist. Choose another font.', [
                'font_ids' => array_map(fn (string $id) => ThemeSchema::CUSTOM_FONT_PREFIX.$id, $missing),
            ]);
        }

        return $settings;
    }

    public function customCss(?string $css): ThemeSettings
    {
        $css = $css === null || trim($css) === '' ? null : $css;
        if ($css !== null) {
            CustomCssPolicy::assertAllowed($css);
        }

        return DB::transaction(function () use ($css) {
            $theme = $this->config->theme();
            $before = $theme->custom_css;
            $theme->custom_css = $css;
            $theme->save();

            if ($before !== $css) {
                $this->audit->record('storefront.custom_css_updated', $theme, ['custom_css' => $before], ['custom_css' => $css]);
            }

            return $theme;
        });
    }
}
