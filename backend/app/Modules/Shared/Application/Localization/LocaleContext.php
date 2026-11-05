<?php

namespace App\Modules\Shared\Application\Localization;

/**
 * Request-scoped storefront language (ADR-011, E12b).
 *
 * `en` is the base language: base columns hold it and it is always enabled. `bn` is enabled
 * per store (`storefront_settings.bangla_enabled`). The storefront middleware resolves the
 * current locale (API: `?lang=` only; HTML shell: `?lang=` > `lang` cookie > default);
 * everything else — staff requests, console, queued jobs — reads in the base language.
 * Public read models localize through it (Translations::pick) and the storefront cache keys
 * include it.
 */
final class LocaleContext
{
    public const EN = 'en';

    public const BN = 'bn';

    /** The language base columns are written in. */
    public const BASE = self::EN;

    public const SUPPORTED = [self::EN, self::BN];

    /** Locales a record can carry translations for (the base language needs none). */
    public const TRANSLATABLE = [self::BN];

    private string $locale = self::BASE;

    private string $default = self::BASE;

    /** @var list<string> */
    private array $enabled = [self::BASE];

    private bool $digits = false;

    /**
     * Sets the store's languages and the request's locale (already resolved with resolve()).
     */
    public function configure(bool $banglaEnabled, string $default, string $locale, bool $banglaDigits = false): void
    {
        $this->enabled = $banglaEnabled ? [self::EN, self::BN] : [self::EN];
        $this->default = in_array($default, $this->enabled, true) ? $default : self::BASE;
        $this->locale = in_array($locale, $this->enabled, true) ? $locale : $this->default;
        $this->digits = $banglaEnabled && $banglaDigits;
    }

    public function reset(): void
    {
        $this->configure(false, self::BASE, self::BASE);
    }

    /**
     * The locale a request asks for (a value of `lang`), or the store default when it is
     * missing, unknown or not enabled.
     */
    public static function resolve(mixed $requested, bool $banglaEnabled, string $default): string
    {
        $enabled = $banglaEnabled ? self::SUPPORTED : [self::EN];
        $default = in_array($default, $enabled, true) ? $default : self::BASE;
        $requested = is_string($requested) ? mb_strtolower(trim($requested)) : null;

        return in_array($requested, $enabled, true) ? $requested : $default;
    }

    public function current(): string
    {
        return $this->locale;
    }

    public function defaultLocale(): string
    {
        return $this->default;
    }

    /**
     * @return list<string>
     */
    public function enabled(): array
    {
        return $this->enabled;
    }

    public function banglaEnabled(): bool
    {
        return in_array(self::BN, $this->enabled, true);
    }

    public function banglaDigits(): bool
    {
        return $this->digits;
    }

    public function isBase(): bool
    {
        return $this->locale === self::BASE;
    }

    /**
     * Runs $callback reading in $locale (e.g. order snapshots in the base language).
     *
     * @template T
     *
     * @param  callable(): T  $callback
     * @return T
     */
    public function runAs(string $locale, callable $callback): mixed
    {
        $previous = $this->locale;
        $this->locale = in_array($locale, self::SUPPORTED, true) ? $locale : self::BASE;

        try {
            return $callback();
        } finally {
            $this->locale = $previous;
        }
    }

    /**
     * `bn_BD` / `en_US` for Open Graph.
     */
    public static function ogLocale(string $locale): string
    {
        return $locale === self::BN ? 'bn_BD' : 'en_US';
    }
}
