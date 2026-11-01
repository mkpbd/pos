<?php

namespace App\Modules\Reviews;

use App\Modules\Customers\Application\Contracts\CustomerReviewStats;
use App\Modules\OnlineCatalog\Application\Contracts\ProductRatings;
use App\Modules\Orders\Application\Contracts\OrderLineReviews;
use App\Modules\Reviews\Infrastructure\EloquentCustomerReviewStats;
use App\Modules\Reviews\Infrastructure\EloquentOrderLineReviews;
use App\Modules\Reviews\Infrastructure\EloquentProductRatings;
use App\Modules\Shared\Infrastructure\Providers\ModuleServiceProvider;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\RateLimiter;

/**
 * Product reviews (E9): customers with a delivered order line of a product review it
 * (verified purchase, asked through Orders' `PurchaseVerifier`), staff approve or reject,
 * and the product page shows approved reviews with the rating summary. Implements
 * OnlineCatalog's `ProductRatings` and Orders' `OrderLineReviews`.
 */
class ReviewsServiceProvider extends ModuleServiceProvider
{
    public function register(): void
    {
        $this->app->bind(ProductRatings::class, EloquentProductRatings::class);
        $this->app->bind(OrderLineReviews::class, EloquentOrderLineReviews::class);
        // E10b: review counts on the admin customer card.
        $this->app->bind(CustomerReviewStats::class, EloquentCustomerReviewStats::class);
    }

    public function boot(): void
    {
        parent::boot();

        // New reviews per customer: POS_REVIEW_RATE_LIMIT per hour (default 5).
        RateLimiter::for('reviews', fn (Request $request) => Limit::perHour((int) config('pos.review_rate_limit'))
            ->by('reviews:'.(Auth::guard('customer')->id() ?? 'ip:'.$request->ip())));
    }

    protected function permissions(): array
    {
        return [
            'reviews.view' => 'View product reviews',
            'reviews.moderate' => 'Approve, reject and delete product reviews',
        ];
    }
}
