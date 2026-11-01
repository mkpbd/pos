<?php

namespace App\Modules\Reviews\Infrastructure;

use App\Modules\OnlineCatalog\Application\Contracts\ProductRatings;
use App\Modules\Reviews\Application\Queries\ReviewQueries;

final class EloquentProductRatings implements ProductRatings
{
    public function __construct(private readonly ReviewQueries $reviews) {}

    public function summary(string $productId): ?array
    {
        $summary = $this->reviews->summary($productId);

        return $summary['count'] === 0 ? null : ['average' => (string) $summary['average'], 'count' => $summary['count']];
    }
}
