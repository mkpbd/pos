<?php

namespace App\Modules\Storefront\Presentation\Http\Support;

use App\Modules\Cms\Application\Contracts\PageContent;
use App\Modules\OnlineCatalog\Application\Contracts\StorefrontCatalog;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Storefront\Application\Queries\StorefrontConfig;
use App\Modules\Storefront\Domain\Builder\BuilderJson;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;
use App\Modules\Storefront\Infrastructure\Models\BuilderVersion;
use App\Modules\Users\Application\Contracts\UserDirectory;

/**
 * API shapes of store builder documents and versions (B1).
 */
final class BuilderPresenter
{
    /**
     * B2: `path` on the store (`/`, `/p/<slug>`) and `preview_url` — the draft on the store's
     * primary domain (`<store_url><path>?preview=draft`), null without a domain.
     *
     * B4: `kind` page | header | footer | zone; `path` null for the header, footer and zones,
     * `/pages/<slug>` for a CMS page design; `cms_page` `{id, title, slug, status, template}` of
     * a CMS page design (null for other documents, and when the CMS page was deleted).
     * `preview_url` of the header and footer is the home page, of the listing zones `/shop`, of
     * the product zone the product changed last (null when nothing is on sale online).
     *
     * P1b: `zone` (the zone of a zone document, else null) and `target` (`{type: category|product,
     * id, name}` of a product zone's version, name null when the record is gone; else null). A
     * product zone's `preview_url` is a matching live product: the product changed last for the
     * all-products version, the product itself for a product version (when live), the product
     * changed last in the category or a subcategory for a category version (null when none).
     *
     * @param  string|false|null  $storeUrl  the primary store URL when already known (false: look it up)
     * @param  array<string, array<string, mixed>>|null  $cmsPages  CMS page summaries by id when already known
     * @param  array{names: array<string, array<string, string>>, slugs: array<string, ?string>}|null  $zones  P1b: target names and matching product slugs when already known (zoneContext())
     * @return array<string, mixed>
     */
    public static function summary(BuilderDocument $document, string|false|null $storeUrl = false, ?array $cmsPages = null, ?array $zones = null): array
    {
        $published = $document->publishedVersion;
        $storeUrl = $storeUrl === false ? self::storeUrl() : $storeUrl;
        $pageId = $document->cmsPageId();
        $cmsPage = null;
        if ($pageId !== null) {
            $cmsPages ??= app(PageContent::class)->summaries([$pageId]);
            $cmsPage = $cmsPages[$pageId] ?? null;
        }
        $zone = $document->zone();
        $target = $document->zoneTarget();
        if ($zone !== null && ($target !== null || in_array($zone, BuilderDocument::PRODUCT_ZONES, true))) {
            $zones ??= self::zoneContext([$document], $storeUrl !== null);
        }
        $path = $cmsPage !== null ? '/pages/'.$cmsPage['slug'] : $document->storePath();
        // B4: where the draft of a page part shows — header / footer on the home page, listing
        // zones on /shop, the product zones on a matching product (P1b; none: null).
        $productSlug = $zones['slugs'][$document->key] ?? null;
        $previewPath = $path ?? match (true) {
            in_array($document->key, [BuilderDocument::HEADER, BuilderDocument::FOOTER], true) => '/',
            in_array($zone, ['listing.top', 'listing.bottom'], true) => '/shop',
            in_array($zone, BuilderDocument::PRODUCT_ZONES, true) => $productSlug === null ? null : '/product/'.$productSlug,
            default => null,
        };
        $previewUrl = $storeUrl === null || $previewPath === null ? null : $storeUrl.$previewPath.'?preview=draft';
        // B8b: a popup's draft shows over the home page.
        $settings = $document->isPopup() ? ($document->draft['popup'] ?? null) : null;
        if ($document->isPopup()) {
            $previewUrl = $storeUrl === null ? null : $storeUrl.'/?preview=draft&popup='.$document->id;
        }

        return [
            'id' => $document->id,
            'kind' => $document->kind,
            'key' => $document->key,
            'title' => $document->title,
            'path' => $path,
            'cms_page' => $cmsPage,
            'preview_url' => $previewUrl,
            // P1b: the zone of a zone document; a product zone version's target {type, id, name|null}.
            'zone' => $zone,
            'target' => $target === null ? null : $target + ['name' => $zones['names'][$target['type']][$target['id']] ?? null],
            // B8b: popups' on / off switch, status (draft | off | scheduled | expired | live) and draft settings summary.
            'active' => $document->isPopup() ? $document->active : null,
            'status' => $document->popupStatus(),
            'popup' => $document->isPopup() ? [
                'layout' => $settings['layout'] ?? 'modal',
                'trigger' => $settings['trigger']['kind'] ?? 'on_load',
                'starts_at' => $settings['starts_at'] ?? null,
                'ends_at' => $settings['ends_at'] ?? null,
            ] : null,
            'schema_version' => $document->schema_version,
            'draft_revision' => $document->draft_revision,
            'has_unpublished_changes' => $published === null || self::canonical($published->content) !== self::canonical($document->draft),
            'draft_updated_at' => $document->draft_updated_at?->toIso8601String(),
            'published' => $published === null ? null : [
                'version_id' => $published->id,
                'number' => $published->number,
                'published_at' => $published->published_at?->toIso8601String(),
            ],
        ];
    }

    /**
     * Summaries of many documents (the store URL is looked up once).
     *
     * @param  iterable<BuilderDocument>  $documents
     * @return list<array<string, mixed>>
     */
    public static function summaries(iterable $documents): array
    {
        $storeUrl = self::storeUrl();
        $documents = collect($documents);
        $cmsPages = app(PageContent::class)->summaries($documents->map(fn (BuilderDocument $d) => $d->cmsPageId())->filter()->values()->all());
        $zones = self::zoneContext($documents->all(), $storeUrl !== null);

        return $documents->map(fn (BuilderDocument $d) => self::summary($d, $storeUrl, $cmsPages, $zones))->values()->all();
    }

    /**
     * P1b: for the product zone documents among these, the names of their targets (by type and
     * id; records that are gone are absent) and — when `$withSlugs` — the slug of a matching live
     * product per document key (null when none): the product changed last for an all-products
     * zone, the product itself for a product version, the product changed last in the category
     * or below it for a category version.
     *
     * @param  iterable<BuilderDocument>  $documents
     * @return array{names: array<string, array<string, string>>, slugs: array<string, ?string>}
     */
    public static function zoneContext(iterable $documents, bool $withSlugs = true): array
    {
        $catalog = app(StorefrontCatalog::class);
        $targets = [BuilderDocument::TARGET_CATEGORY => [], BuilderDocument::TARGET_PRODUCT => []];
        $productZones = [];
        foreach ($documents as $document) {
            $target = $document->zoneTarget();
            if ($target !== null) {
                $targets[$target['type']][] = $target['id'];
            }
            if (in_array($document->zone(), BuilderDocument::PRODUCT_ZONES, true)) {
                $productZones[] = $document;
            }
        }
        $names = [];
        foreach ($targets as $type => $ids) {
            $names[$type] = array_map(fn (array $s) => (string) $s['name'], $ids === [] ? [] : $catalog->itemSummaries($type, array_values(array_unique($ids))));
        }

        $slugs = [];
        if ($withSlugs && $productZones !== []) {
            $productSlugs = $targets[BuilderDocument::TARGET_PRODUCT] === [] ? []
                : array_map(fn (array $s) => $s['slug'], $catalog->productSummaries(array_values(array_unique($targets[BuilderDocument::TARGET_PRODUCT]))));
            $latest = [];
            foreach ($productZones as $document) {
                $target = $document->zoneTarget();
                $slugs[$document->key] = match ($target['type'] ?? null) {
                    BuilderDocument::TARGET_PRODUCT => $productSlugs[$target['id']] ?? null,
                    BuilderDocument::TARGET_CATEGORY => $latest[$target['id']] ??= $catalog->latestProductSlug($target['id']),
                    default => $latest[''] ??= $catalog->latestProductSlug(),
                };
            }
        }

        return ['names' => $names, 'slugs' => $slugs];
    }

    /**
     * P1b: `{id, slug, name, price, image_url}` of the live product a product zone document is
     * previewed on (zoneContext()), or null — for the editor's canvas.
     *
     * @return array{id: string, slug: string, name: string, price: string, image_url: ?string}|null
     */
    public static function previewProduct(BuilderDocument $document): ?array
    {
        if (! in_array($document->zone(), BuilderDocument::PRODUCT_ZONES, true)) {
            return null;
        }
        $catalog = app(StorefrontCatalog::class);
        $slug = self::zoneContext([$document])['slugs'][$document->key] ?? null;
        $id = $slug === null ? null : $catalog->liveProductId($slug);
        $card = $id === null ? null : ($catalog->productCards([$id])[0] ?? null);

        return $card === null ? null : [
            'id' => (string) $card['id'],
            'slug' => (string) $card['slug'],
            'name' => (string) $card['name'],
            'price' => (string) $card['price'],
            'image_url' => $card['image']['url'] ?? null,
        ];
    }

    /**
     * The organization's primary store URL (scheme and host), or null without a domain.
     */
    public static function storeUrl(): ?string
    {
        return app(StorefrontConfig::class)->primaryUrl();
    }

    /**
     * The summary with the draft as `content`.
     *
     * @return array<string, mixed>
     */
    public static function document(BuilderDocument $document): array
    {
        return self::summary($document) + ['content' => BuilderJson::present($document->draft)];
    }

    /**
     * B5: the theme draft in "start from a demo" / "publish all" results: `{draft_revision,
     * has_unpublished_changes, preset, published: {version_id, number, published_at}|null,
     * preview_url}`.
     *
     * @param  array{document: ?BuilderDocument, settings: array<string, mixed>, has_unpublished_changes: bool}  $state  ManageThemeDraft::state()
     * @return array<string, mixed>
     */
    public static function themeSummary(array $state): array
    {
        $document = $state['document'];
        $published = $document?->publishedVersion;
        $storeUrl = self::storeUrl();

        return [
            'draft_revision' => $document->draft_revision ?? 0,
            'has_unpublished_changes' => $state['has_unpublished_changes'],
            'preset' => $state['settings']['preset'] ?? null,
            'published' => $published === null ? null : [
                'version_id' => $published->id,
                'number' => $published->number,
                'published_at' => $published->published_at?->toIso8601String(),
            ],
            'preview_url' => $storeUrl === null ? null : $storeUrl.'/?preview=draft',
        ];
    }

    /**
     * Newest first.
     *
     * @param  iterable<BuilderVersion>  $versions
     * @return list<array<string, mixed>>
     */
    public static function versions(iterable $versions): array
    {
        $versions = collect($versions);
        $names = app(UserDirectory::class)->names(
            app(TenantContext::class)->requireOrganization(),
            $versions->pluck('created_by')->filter()->unique()->values()->all(),
        );

        return $versions->map(fn (BuilderVersion $v) => [
            'id' => $v->id,
            'number' => $v->number,
            'note' => $v->note,
            'published_at' => $v->published_at?->toIso8601String(),
            'created_by' => $v->created_by === null ? null : ['id' => $v->created_by, 'name' => $names[$v->created_by] ?? null],
            'created_at' => $v->created_at?->toIso8601String(),
        ])->values()->all();
    }

    /**
     * Maps sorted by key at every level, so stored JSON (jsonb reorders keys) compares by value.
     */
    private static function canonical(mixed $value): mixed
    {
        if (! is_array($value)) {
            return $value;
        }
        $value = array_map(fn ($v) => self::canonical($v), $value);
        if (! array_is_list($value)) {
            ksort($value);
        }

        return $value;
    }
}
