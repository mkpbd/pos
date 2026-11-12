<?php

namespace App\Modules\Reviews\Application\Contracts;

/**
 * B8a: approved reviews as the store builder shows them (review wall, ratings chart), scoped to
 * the organization in the tenant context. Callers pass the products to look at (the store
 * builder: products on sale online), so a review of anything else never shows. Authors are
 * named publicly only (ReviewAuthor::publicName: first name and last initial).
 */
interface ReviewShowcase
{
    public const ORDERS = ['latest', 'top_rated'];

    /**
     * Approved reviews of the products rated at least `$minRating`, newest first (`latest`) or
     * best first, then newest (`top_rated`): `{id, product_id, author, rating, title, body,
     * created_at}` with `body` plain text cut to `$bodyMax` characters (an ellipsis when cut).
     *
     * @param  list<string>  $productIds
     * @param  'latest'|'top_rated'  $order
     * @return list<array{id: string, product_id: string, author: string, rating: int, title: ?string, body: string, created_at: string}>
     */
    public function approved(array $productIds, int $minRating, string $order, int $limit, int $bodyMax): array;

    /**
     * Approved reviews of the products per star rating: `{"1": n, …, "5": n}`.
     *
     * @param  list<string>  $productIds
     * @return array<string, int>
     */
    public function ratingCounts(array $productIds): array;
}
