<?php

namespace App\Modules\OnlineCatalog\Application\Queries;

use App\Modules\OnlineCatalog\Infrastructure\ReadModels\CatalogAssistantReadModel;
use App\Modules\OnlineCatalog\Infrastructure\ReadModels\CatalogReadModel;
use Carbon\CarbonImmutable;

/**
 * AI2a: bundle ideas — deterministic, from the nightly co-purchase scores (product_affinities):
 * live anchor products with their best TOP co-purchased live products that are not yet among the
 * anchor's hand-picked "frequently bought together". A pair's score is the number of orders and
 * sales (last 180 days) holding both products. No AI here.
 */
class BundleIdeas
{
    public const TOP = 3;

    public const PER_PAGE = 20;

    public function __construct(
        private readonly CatalogAssistantReadModel $reads,
        private readonly CatalogReadModel $catalog,
    ) {}

    /**
     * @return array{items: list<array<string, mixed>>, total: int, page: int, per_page: int, last_run: ?string, computed_at: ?string}
     */
    public function __invoke(?string $search, int $page): array
    {
        $organizationId = $this->catalog->organizationId();
        $run = $this->reads->lastAffinityRun($organizationId);
        $page = max(1, $page);
        $result = $this->reads->bundleIdeas($organizationId, $search, $page, self::PER_PAGE, self::TOP);

        $anchorIds = array_column($result['anchors'], 'id');
        $productIds = array_values(array_unique(array_merge($anchorIds, ...array_map(fn (array $a) => array_column($a['pairs'], 'id'), $result['anchors']))));
        $images = $this->catalog->images($productIds);
        $picks = $this->reads->frequentlyBoughtCounts($organizationId, $anchorIds);

        $items = array_map(fn (array $anchor) => [
            'anchor' => ['id' => $anchor['id'], 'name' => $anchor['name'], 'image_url' => $images[$anchor['id']][0]['url'] ?? null],
            'frequently_bought_count' => $picks[$anchor['id']] ?? 0,
            'products' => array_map(fn (array $pair) => [
                'id' => $pair['id'],
                'name' => $pair['name'],
                'image_url' => $images[$pair['id']][0]['url'] ?? null,
                'score' => $pair['score'],
                'orders_together' => $pair['score'],
            ], $anchor['pairs']),
        ], $result['anchors']);

        return [
            'items' => $items,
            'total' => $result['total'],
            'page' => $page,
            'per_page' => self::PER_PAGE,
            'last_run' => $run['local_date'] ?? null,
            'computed_at' => $run === null ? null : CarbonImmutable::parse($run['computed_at'])->toIso8601String(),
        ];
    }
}
