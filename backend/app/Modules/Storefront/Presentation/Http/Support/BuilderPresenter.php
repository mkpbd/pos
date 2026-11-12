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
     * @param  string|false|null  $storeUrl  the primary store URL when already known (false: look it up)
     * @param  array<string, array<string, mixed>>|null  $cmsPages  CMS page summaries by id when already known
     * @return array<string, mixed>
     */
    public static function summary(BuilderDocument $document, string|false|null $storeUrl = false, ?array $cmsPages = null): array
    {
        $published = $document->publishedVersion;
        $storeUrl = $storeUrl === false ? self::storeUrl() : $storeUrl;
        $pageId = $document->cmsPageId();
        $cmsPage = null;
        if ($pageId !== null) {
            $cmsPages ??= app(PageContent::class)->summaries([$pageId]);
            $cmsPage = $cmsPages[$pageId] ?? null;
        }
        $path = $cmsPage !== null ? '/pages/'.$cmsPage['slug'] : $document->storePath();
        // B4: where the draft of a page part shows — header / footer on the home page, listing
        // zones on /shop, the product zone on the product changed last (none: null).
        $previewPath = $path ?? match ($document->key) {
            BuilderDocument::HEADER, BuilderDocument::FOOTER => '/',
            BuilderDocument::ZONE_PREFIX.'listing.top', BuilderDocument::ZONE_PREFIX.'listing.bottom' => '/shop',
            BuilderDocument::ZONE_PREFIX.'product.after' => $storeUrl === null ? null : self::latestProductPath(),
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

        return $documents->map(fn (BuilderDocument $d) => self::summary($d, $storeUrl, $cmsPages))->values()->all();
    }

    /**
     * B4: `/product/<slug>` of the live product whose listing changed last, or null.
     */
    private static function latestProductPath(): ?string
    {
        $slug = app(StorefrontCatalog::class)->latestProductSlug();

        return $slug === null ? null : '/product/'.$slug;
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
