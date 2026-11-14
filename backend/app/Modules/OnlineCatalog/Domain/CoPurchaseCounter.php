<?php

namespace App\Modules\OnlineCatalog\Domain;

/**
 * P1b: counts how often two products were bought together. Each basket (an order or a sale,
 * its distinct products) adds one to every pair it contains; a pair's score is the number of
 * baskets holding both. Baskets of more than MAX_BASKET products are skipped: bulk purchases say
 * little about what goes together and would cost a square of their size. The result keeps pairs
 * scoring at least MIN_SCORE, in both directions, the best MAX_PER_PRODUCT for each product
 * (score, then product id, so equal scores always come in the same order). Pure.
 */
final class CoPurchaseCounter
{
    public const MIN_SCORE = 2;

    public const MAX_PER_PRODUCT = 20;

    public const MAX_BASKET = 30;

    /** @var array<string, array<string, int>> pair counts, the lower id first */
    private array $pairs = [];

    /**
     * @param  list<string>  $productIds
     */
    public function add(array $productIds): void
    {
        $ids = array_values(array_unique(array_map('strval', $productIds)));
        $count = count($ids);
        if ($count < 2 || $count > self::MAX_BASKET) {
            return;
        }
        sort($ids, SORT_STRING);
        for ($i = 0; $i < $count - 1; $i++) {
            for ($j = $i + 1; $j < $count; $j++) {
                $this->pairs[$ids[$i]][$ids[$j]] = ($this->pairs[$ids[$i]][$ids[$j]] ?? 0) + 1;
            }
        }
    }

    /**
     * @return list<array{product_id: string, related_product_id: string, score: int}>
     */
    public function affinities(): array
    {
        $byProduct = [];
        foreach ($this->pairs as $a => $partners) {
            foreach ($partners as $b => $score) {
                if ($score >= self::MIN_SCORE) {
                    $byProduct[(string) $a][(string) $b] = $score;
                    $byProduct[(string) $b][(string) $a] = $score;
                }
            }
        }
        ksort($byProduct, SORT_STRING);

        $rows = [];
        foreach ($byProduct as $productId => $related) {
            $ids = array_map('strval', array_keys($related));
            usort($ids, fn (string $x, string $y) => [$related[$y], $x] <=> [$related[$x], $y]);
            foreach (array_slice($ids, 0, self::MAX_PER_PRODUCT) as $relatedId) {
                $rows[] = ['product_id' => (string) $productId, 'related_product_id' => $relatedId, 'score' => $related[$relatedId]];
            }
        }

        return $rows;
    }
}
