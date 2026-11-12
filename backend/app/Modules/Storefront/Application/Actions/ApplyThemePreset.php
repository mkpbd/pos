<?php

namespace App\Modules\Storefront\Application\Actions;

use App\Modules\Storefront\Application\Queries\StorefrontConfig;
use App\Modules\Storefront\Domain\ThemePresets;
use App\Modules\Storefront\Infrastructure\Models\ThemeSettings;

/**
 * T1: puts a preset's colours, fonts, shape and layout over the current theme and saves it
 * like any theme edit (media check, audit, storefront cache bust). Logo, favicon,
 * announcement, footer content and the palette are kept.
 *
 * B3: this writes the live theme directly and is used by seeding (the demo stores). The admin
 * API applies presets to the theme draft instead (ManageThemeDraft::applyPreset).
 */
class ApplyThemePreset
{
    public function __construct(
        private readonly StorefrontConfig $config,
        private readonly SaveTheme $save,
    ) {}

    public function __invoke(string $preset): ThemeSettings
    {
        return $this->save->settings(ThemePresets::apply($preset, $this->config->theme()->settings));
    }
}
