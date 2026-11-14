<?php

namespace App\Modules\Reviews;

use App\Modules\Customers\Application\Contracts\CustomerReviewStats;
use App\Modules\OnlineCatalog\Application\Contracts\ProductQuestionCounts;
use App\Modules\OnlineCatalog\Application\Contracts\ProductRatings;
use App\Modules\Orders\Application\Contracts\OrderLineReviews;
use App\Modules\Reviews\Application\Contracts\ReviewShowcase;
use App\Modules\Reviews\Application\Events\ProductQuestionAnswered;
use App\Modules\Reviews\Application\Events\ProductQuestionAsked;
use App\Modules\Reviews\Infrastructure\EloquentCustomerReviewStats;
use App\Modules\Reviews\Infrastructure\EloquentOrderLineReviews;
use App\Modules\Reviews\Infrastructure\EloquentProductQuestionCounts;
use App\Modules\Reviews\Infrastructure\EloquentProductRatings;
use App\Modules\Reviews\Infrastructure\EloquentReviewShowcase;
use App\Modules\Reviews\Infrastructure\Notifications\SendProductQuestionNotifications;
use App\Modules\Shared\Infrastructure\Providers\ModuleServiceProvider;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\RateLimiter;

/**
 * Product reviews (E9): customers with a delivered order line of a product review it
 * (verified purchase, asked through Orders' `PurchaseVerifier`), staff approve or reject,
 * and the product page shows approved reviews with the rating summary. Implements
 * OnlineCatalog's `ProductRatings` and Orders' `OrderLineReviews`. P1b: shoppers' questions
 * about products (guests too), answered and published by staff; implements OnlineCatalog's
 * `ProductQuestionCounts`.
 */
class ReviewsServiceProvider extends ModuleServiceProvider
{
    public function register(): void
    {
        $this->app->bind(ProductRatings::class, EloquentProductRatings::class);
        $this->app->bind(OrderLineReviews::class, EloquentOrderLineReviews::class);
        // E10b: review counts on the admin customer card.
        $this->app->bind(CustomerReviewStats::class, EloquentCustomerReviewStats::class);
        // B8a: the store builder's review wall and ratings chart.
        $this->app->bind(ReviewShowcase::class, EloquentReviewShowcase::class);
        // P1b: published question counts on the product page.
        $this->app->bind(ProductQuestionCounts::class, EloquentProductQuestionCounts::class);
    }

    public function boot(): void
    {
        parent::boot();

        // New reviews per customer: POS_REVIEW_RATE_LIMIT per hour (default 5).
        RateLimiter::for('reviews', fn (Request $request) => Limit::perHour((int) config('pos.review_rate_limit'))
            ->by('reviews:'.(Auth::guard('customer')->id() ?? 'ip:'.$request->ip())));
        // P1b: shopper questions per visitor: POS_QUESTION_RATE_LIMIT per hour (default 5).
        RateLimiter::for('product-questions', fn (Request $request) => Limit::perHour(max(1, (int) config('pos.question_rate_limit', 5)))->by('product-questions:'.$request->ip()));

        // P1b: staff hear about new questions; askers get the answer by e-mail (queued, after commit).
        Event::listen(ProductQuestionAsked::class, [SendProductQuestionNotifications::class, 'asked']);
        Event::listen(ProductQuestionAnswered::class, [SendProductQuestionNotifications::class, 'answered']);
    }

    protected function permissions(): array
    {
        return [
            'reviews.view' => 'View product reviews and shoppers\' product questions',
            'reviews.moderate' => 'Approve, reject and delete product reviews; answer, publish, reject and delete product questions',
        ];
    }
}
