<?php

namespace App\Modules\Cms\Application\Contracts;

/**
 * What other modules may ask about content pages (all scoped to the current organization).
 */
interface PageDirectory
{
    /**
     * Pages visitors can open now, keyed by id; unknown, draft, scheduled or deleted ids are absent.
     *
     * @param  list<string>  $ids
     * @return array<string, array{id: string, slug: string, title: string}>
     */
    public function visible(array $ids): array;

    /**
     * A visible page by slug, with its search metadata, or null.
     *
     * @return array{id: string, slug: string, title: string, seo_title: ?string, seo_description: ?string}|null
     */
    public function visibleBySlug(string $slug): ?array;

    /**
     * Every page that is not deleted (drafts included), for link pickers.
     *
     * @return list<array{id: string, slug: string, title: string, status: string}>
     */
    public function all(): array;
}
