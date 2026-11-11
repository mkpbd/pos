<?php

namespace App\Modules\Storefront\Application\Builder;

use App\Modules\Storefront\Application\Queries\StorefrontBootstrap;
use App\Modules\Storefront\Application\Queries\StorefrontConfig;

/**
 * What the editor's canvas needs to draw the storefront (B2), for the signed-in staff
 * member's own organization — also while the store is closed or has no domain yet:
 *
 * - `bootstrap`: exactly the `/store/bootstrap` payload that staff member gets on the store
 *   (`preview` true while the store is closed), in the language asked for (`lang`, resolved
 *   like on the storefront);
 * - `store_url`: scheme and primary host of the store, or null without a domain;
 * - `locales`: the store's enabled languages.
 */
class BuilderCanvasContext
{
    public function __construct(
        private readonly StorefrontBootstrap $bootstrap,
        private readonly StorefrontConfig $config,
        private readonly BuilderPreviewLocale $locale,
    ) {}

    /**
     * @return array{bootstrap: array<string, mixed>, store_url: ?string, locales: list<string>}
     */
    public function build(mixed $lang): array
    {
        $bootstrap = $this->locale->using($lang, fn () => $this->bootstrap->build());

        return [
            'bootstrap' => $bootstrap + ['preview' => ! $this->config->settings()->is_enabled],
            'store_url' => $this->config->primaryUrl(),
            'locales' => $bootstrap['store']['locales'],
        ];
    }
}
