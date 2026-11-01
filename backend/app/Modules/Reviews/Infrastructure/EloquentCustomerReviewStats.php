<?php

namespace App\Modules\Reviews\Infrastructure;

use App\Modules\Customers\Application\Contracts\CustomerReviewStats;
use App\Modules\Reviews\Domain\ReviewStatus;
use App\Modules\Reviews\Infrastructure\Models\Review;

/**
 * The customer's reviews for the admin customer card (E10b).
 */
class EloquentCustomerReviewStats implements CustomerReviewStats
{
    public function summary(string $customerId): array
    {
        $counts = Review::query()->where('customer_id', $customerId)->groupBy('status')
            ->selectRaw('status, count(*) as n')->toBase()->pluck('n', 'status');

        return ['count' => (int) $counts->sum(), 'pending' => (int) ($counts[ReviewStatus::Pending->value] ?? 0)];
    }
}
