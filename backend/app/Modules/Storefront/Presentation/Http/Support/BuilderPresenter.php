<?php

namespace App\Modules\Storefront\Presentation\Http\Support;

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
     * @param  string|false|null  $storeUrl  the primary store URL when already known (false: look it up)
     * @return array<string, mixed>
     */
    public static function summary(BuilderDocument $document, string|false|null $storeUrl = false): array
    {
        $published = $document->publishedVersion;
        $storeUrl = $storeUrl === false ? self::storeUrl() : $storeUrl;
        $path = $document->storePath();

        return [
            'id' => $document->id,
            'kind' => $document->kind,
            'key' => $document->key,
            'title' => $document->title,
            'path' => $path,
            'preview_url' => $storeUrl === null || $path === null ? null : $storeUrl.$path.'?preview=draft',
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

        return collect($documents)->map(fn (BuilderDocument $d) => self::summary($d, $storeUrl))->values()->all();
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
