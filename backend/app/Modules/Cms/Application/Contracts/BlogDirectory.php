<?php

namespace App\Modules\Cms\Application\Contracts;

use Carbon\CarbonImmutable;
use DateTimeInterface;

/**
 * What other modules may ask about the blog (all scoped to the current organization).
 */
interface BlogDirectory
{
    /**
     * The subset of the given ids that exist and are not deleted. `$type` is
     * BlogReferences::CATEGORY or BlogReferences::POST (drafts included).
     *
     * @param  list<string>  $ids
     * @return list<string>
     */
    public function existing(string $type, array $ids): array;

    /**
     * Categories that are not deleted, keyed by id.
     *
     * @param  list<string>  $ids
     * @return array<string, array{id: string, slug: string, name: string}>
     */
    public function categories(array $ids): array;

    /**
     * Posts visitors can read now, keyed by id; drafts, scheduled and deleted posts are absent.
     *
     * @param  list<string>  $ids
     * @return array<string, array{id: string, slug: string, title: string}>
     */
    public function visiblePosts(array $ids): array;

    /**
     * Menu link targets: every category, and every post that is not deleted with its state.
     *
     * @return array{blog_categories: list<array{id: string, name: string, slug: string}>, blog_posts: list<array{id: string, slug: string, title: string, status: string, state: string, is_visible: bool}>}
     */
    public function linkTargets(): array;

    /**
     * The newest readable posts as public list rows (optionally of one category).
     *
     * @return list<array<string, mixed>>
     */
    public function postCards(?string $categoryId, int $limit): array;

    /**
     * Search metadata of a category by slug, or null.
     *
     * @return array{name: string, slug: string, description: ?string}|null
     */
    public function categoryMeta(string $slug): ?array;

    /**
     * Search metadata of a readable post by slug (any post that is not deleted with
     * `$includeUnpublished`, for staff previews), or null. `image_url` is site-relative;
     * `author` is the author's first name; `category` feeds the breadcrumbs (E12).
     *
     * @return array{slug: string, title: string, seo_title: ?string, description: ?string, image_url: ?string, published_at: ?string, updated_at: ?string, author: ?string, category: array{name: string, slug: string}|null}|null
     */
    public function postMeta(string $slug, bool $includeUnpublished = false): ?array;

    /**
     * The next instant a published post becomes readable (after now), or null (E12 caching).
     */
    public function nextPublicationAt(): ?CarbonImmutable;

    /**
     * Sitemap entries (E12): readable posts and the categories that are not deleted, by slug.
     *
     * @return array{posts: list<array{slug: string, updated_at: ?DateTimeInterface}>, categories: list<array{slug: string, updated_at: ?DateTimeInterface}>}
     */
    public function sitemapEntries(): array;
}
