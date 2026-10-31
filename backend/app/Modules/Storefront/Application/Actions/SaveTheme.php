<?php

namespace App\Modules\Storefront\Application\Actions;

use App\Modules\Media\Application\Contracts\MediaLibrary;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
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
    ) {}

    /**
     * Replaces the theme settings (missing keys take their defaults).
     *
     * @param  array<string, mixed>  $settings  validated
     */
    public function settings(array $settings): ThemeSettings
    {
        $settings = ThemeSchema::normalize($settings);

        $ids = ThemeSchema::mediaIds($settings);
        $missing = array_values(array_diff($ids, $this->media->existing($ids)));
        if ($missing !== []) {
            throw new BusinessRuleViolation('MEDIA_NOT_FOUND', 'Some selected images no longer exist in the media library.', ['media_ids' => $missing]);
        }

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
