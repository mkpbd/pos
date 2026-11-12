<?php

namespace App\Modules\Storefront\Application\Queries;

use App\Modules\Media\Application\Contracts\MediaLibrary;
use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Shared\Application\Contracts\StorefrontContentVersion;
use App\Modules\Shared\Application\Localization\LocaleContext;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\Translations;
use App\Modules\Storefront\Application\Builder\BuilderPages;
use App\Modules\Storefront\Domain\BannerPlacement;
use App\Modules\Storefront\Domain\MenuLocation;
use App\Modules\Storefront\Domain\ThemeSchema;
use App\Modules\Storefront\Infrastructure\Models\Banner;
use App\Modules\Storefront\Infrastructure\Models\Menu;
use Carbon\CarbonImmutable;

/**
 * Everything the storefront needs before it can draw a page: store identity, theme
 * (media ids resolved to URLs), the announcement if it is live now, the active menus
 * with their visible items as trees (MenuTrees), and the live popup banner (E11) or null.
 *
 * E12b: texts in the request's language (menu labels, announcement, popup; per-field
 * fallback to the base text) and the store's languages: `store.locales` (`["en"]` or
 * `["en","bn"]`), `store.default_locale`, `store.bangla_digits` and the resolved `locale`.
 * Cached per language. B1: `builder.home` — a published store builder home page exists.
 * B4: `builder.header`, `builder.footer` and `builder.zones` (render payloads or null).
 */
class StorefrontBootstrap
{
    public function __construct(
        private readonly StorefrontConfig $config,
        private readonly MediaLibrary $media,
        private readonly OrganizationDirectory $organizations,
        private readonly TenantContext $tenant,
        private readonly StorefrontContentVersion $version,
        private readonly ContentSchedule $schedule,
        private readonly LocaleContext $locale,
        private readonly BuilderPages $builder,
        private readonly MenuTrees $menuTrees,
    ) {}

    /**
     * Cached per organization content version until the next scheduled change (E12).
     *
     * @return array<string, mixed>
     */
    public function build(): array
    {
        return $this->version->remember(
            $this->tenant->requireOrganization(),
            'bootstrap',
            fn () => $this->compute(),
            fn () => self::earliest($this->schedule->nextChange(), $this->builder->partsNextChange()),
        );
    }

    /**
     * B3: the payload with another theme document (the staff draft preview) instead of the live
     * one; not cached. Custom CSS stays the live one (it is not part of the draft). B4: with
     * the builder header, footer and zones as drafted too (staff preview and canvas).
     *
     * @param  array<string, mixed>  $theme  normalized theme settings
     * @return array<string, mixed>
     */
    public function buildWithTheme(array $theme): array
    {
        return $this->compute($theme, true);
    }

    /**
     * @param  array<string, mixed>|null  $override  theme settings instead of the live ones
     * @param  bool  $draftBuilder  B4: the builder parts' drafts instead of their published versions
     * @return array<string, mixed>
     */
    private function compute(?array $override = null, bool $draftBuilder = false): array
    {
        $settings = $this->config->settings();
        $theme = $this->config->theme();
        $t = $override ?? $theme->settings;
        $locale = $this->locale->current();

        $menus = $this->menuTrees->load(null);

        // E11: at most one popup — the first live one in sort order.
        $popup = Banner::query()->live()->where('placement', BannerPlacement::Popup)->orderBy('sort_order')->orderBy('created_at')->first();

        $mediaIds = ThemeSchema::mediaIds($t);
        if ($popup !== null) {
            array_push($mediaIds, ...array_filter([$popup->desktop_media_id, $popup->mobile_media_id]));
        }
        array_push($mediaIds, ...MenuTrees::mediaIds($menus));
        $refs = $this->media->refs(array_values(array_unique($mediaIds)));
        $ref = fn (?string $id) => $id !== null ? ($refs[$id] ?? null) : null;

        $trees = $this->menuTrees->trees($menus, $ref);
        $organization = $this->organizations->summary($this->tenant->requireOrganization());

        return [
            'store' => [
                'name' => $settings->site_name,
                'description' => $settings->meta_description,
                'currency' => $organization['base_currency'] ?? null,
                // Exclusive tax mode: the storefront shows prices "excl. VAT"; tax is added at checkout.
                'prices_include_tax' => ($organization['tax_mode'] ?? 'exclusive') === 'inclusive',
                // E12: false (staging) = every page is noindex; the SPA keeps that on navigation.
                'allow_indexing' => $settings->allow_indexing,
                // E12b: the languages shoppers can switch between, the default and digits.
                'locales' => $settings->bangla_enabled ? LocaleContext::SUPPORTED : [LocaleContext::EN],
                'default_locale' => $settings->bangla_enabled ? $settings->default_locale : LocaleContext::EN,
                'bangla_digits' => $settings->bangla_enabled && $settings->bangla_digits,
            ],
            // E12b: the language of this payload (and of the page the shell serves).
            'locale' => $locale,
            'theme' => [
                // T1: the look the theme started from; the layout carries the variants.
                'preset' => $t['preset'],
                'colors' => $t['colors'],
                'typography' => $t['typography'],
                'shape' => $t['shape'],
                'layout' => $t['layout'],
                'logo' => $ref($t['logo_media_id']),
                'favicon' => $ref($t['favicon_media_id']),
                'announcement' => $this->liveAnnouncement($t['announcement'], $locale),
                'footer' => [
                    'about' => $t['footer']['about'],
                    'copyright' => $t['footer']['copyright'],
                    'contact' => $t['footer']['contact'],
                    'social' => array_filter($t['footer']['social']),
                    'payment_logos' => array_values(array_filter(array_map($ref, $t['footer']['payment_logo_media_ids']))),
                ],
                'custom_css' => $theme->custom_css,
            ],
            'menus' => $menus
                ->mapWithKeys(fn (Menu $menu) => [$menu->location->value => [
                    'name' => $menu->name,
                    'items' => $trees[$menu->id],
                ]])
                ->sortKeysUsing(fn (string $a, string $b) => array_search(MenuLocation::from($a), MenuLocation::cases(), true) <=> array_search(MenuLocation::from($b), MenuLocation::cases(), true))
                ->all(),
            'popup' => $popup === null || $ref($popup->desktop_media_id) === null ? null : [
                'id' => $popup->id,
                'title' => Translations::pick($popup, 'title', $locale),
                'subtitle' => Translations::pick($popup, 'subtitle', $locale),
                'image' => $ref($popup->desktop_media_id),
                'mobile_image' => $ref($popup->mobile_media_id),
                'link_url' => $popup->link_url,
                'button_label' => Translations::pick($popup, 'button_label', $locale),
                'delay_seconds' => $popup->popup_delay_seconds ?? BannerPlacement::POPUP_DEFAULTS['popup_delay_seconds'],
                'frequency' => $popup->popup_frequency ?? BannerPlacement::POPUP_DEFAULTS['popup_frequency'],
                'updated_at' => $popup->updated_at?->toIso8601String(),
            ],
            // B1: `home` true once a builder home page is published (the SPA then renders it instead
            // of the legacy homepage sections). B4: the published (draft preview: drafted) builder
            // header, footer and shop / product zones as render payloads, null = classic rendering.
            'builder' => ['home' => $this->builder->hasPublishedHome()] + $this->builder->parts($draftBuilder),
        ];
    }

    private static function earliest(?CarbonImmutable ...$times): ?CarbonImmutable
    {
        $times = array_filter($times);
        usort($times, fn (CarbonImmutable $a, CarbonImmutable $b) => $a <=> $b);

        return $times[0] ?? null;
    }

    /**
     * @param  array<string, mixed>  $announcement  `translations` {bn: {text}} since E12b
     * @return array{text: string, link: ?string, background: string, foreground: string}|null
     */
    private function liveAnnouncement(array $announcement, string $locale): ?array
    {
        if (! $announcement['enabled'] || ! is_string($announcement['text']) || $announcement['text'] === '') {
            return null;
        }

        $now = CarbonImmutable::now();
        if (($announcement['starts_at'] && $now->lt(CarbonImmutable::parse($announcement['starts_at'])))
            || ($announcement['ends_at'] && $now->gte(CarbonImmutable::parse($announcement['ends_at'])))) {
            return null;
        }

        return [
            'text' => Translations::value($announcement['translations'] ?? null, 'text', $locale, $announcement['text']),
            'link' => $announcement['link'],
            'background' => $announcement['background'],
            'foreground' => $announcement['foreground'],
        ];
    }
}
