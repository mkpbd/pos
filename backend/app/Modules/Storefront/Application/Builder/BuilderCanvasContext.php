<?php

namespace App\Modules\Storefront\Application\Builder;

use App\Modules\Storefront\Application\Queries\StorefrontBootstrap;
use App\Modules\Storefront\Application\Queries\StorefrontConfig;

/**
 * What the editor's canvas needs to draw the storefront (B2), for the signed-in staff
 * member's own organization — also while the store is closed or has no domain yet:
 *
 * - `bootstrap`: the `/store/bootstrap` payload that staff member gets on the store
 *   (`preview` true while the store is closed), in the language asked for (`lang`, resolved
 *   like on the storefront) — B3: with the **draft** theme, as `/store/bootstrap?preview=draft`;
 * - `theme_source`: `draft` (B3);
 * - `store_url`: scheme and primary host of the store, or null without a domain;
 * - `locales`: the store's enabled languages.
 */
class BuilderCanvasContext
{
    public function __construct(
        private readonly StorefrontBootstrap $bootstrap,
        private readonly StorefrontConfig $config,
        private readonly BuilderPreviewLocale $locale,
        private readonly ManageThemeDraft $theme,
    ) {}

    /**
     * @return array{bootstrap: array<string, mixed>, theme_source: 'draft', store_url: ?string, locales: list<string>}
     */
    public function build(mixed $lang): array
    {
        $theme = $this->theme->settings();
        $bootstrap = $this->locale->using($lang, fn () => $this->bootstrap->buildWithTheme($theme));

        return [
            // P2a: the canvas shows pages directly, so no domain entry page.
            'bootstrap' => $bootstrap + ['preview' => ! $this->config->settings()->is_enabled, 'entry_path' => null],
            'theme_source' => 'draft',
            'store_url' => $this->config->primaryUrl(),
            'locales' => $bootstrap['store']['locales'],
        ];
    }
}
