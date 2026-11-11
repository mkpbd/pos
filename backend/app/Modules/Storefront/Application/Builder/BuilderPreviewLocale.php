<?php

namespace App\Modules\Storefront\Application\Builder;

use App\Modules\Shared\Application\Localization\LocaleContext;
use App\Modules\Storefront\Application\Queries\StorefrontConfig;

/**
 * Staff requests read in the base language; the builder's admin render (B1) can show a page
 * in any of the store's languages: `lang` resolved like on the storefront (unknown or
 * disabled → the store default) for the duration of the callback.
 */
class BuilderPreviewLocale
{
    public function __construct(
        private readonly LocaleContext $locale,
        private readonly StorefrontConfig $config,
    ) {}

    /**
     * @template T
     *
     * @param  callable(): T  $callback
     * @return T
     */
    public function using(mixed $lang, callable $callback): mixed
    {
        $settings = $this->config->settings();
        // Same fallbacks as ResolveStorefront.
        $bangla = (bool) ($settings->bangla_enabled ?? true);
        $default = (string) ($settings->default_locale ?? LocaleContext::BASE);
        $this->locale->configure($bangla, $default, LocaleContext::resolve($lang, $bangla, $default), (bool) ($settings->bangla_digits ?? false));

        try {
            return $callback();
        } finally {
            $this->locale->reset();
        }
    }
}
