<?php

namespace App\Modules\Cms\Application\Contracts;

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
     * `$includeUnpublished`, for staff previews), or null. `image_url` is site-relative.
     *
     * @return array{title: string, seo_title: ?string, description: ?string, image_url: ?string, published_at: ?string}|null
     */
    public function postMeta(string $slug, bool $includeUnpublished = false): ?array;
}
