<?php

namespace App\Modules\Reviews\Application\Actions;

use App\Modules\Orders\Application\Contracts\PurchaseVerifier;
use App\Modules\Reviews\Domain\ReviewStatus;
use App\Modules\Reviews\Infrastructure\Models\Review;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;

/**
 * A customer's own reviews (E9). Writing one needs a delivered order line of the product
 * (asked through Orders' PurchaseVerifier) — REVIEW_NOT_ALLOWED otherwise — and there is one
 * review per customer and product (REVIEW_EXISTS). New and edited reviews wait for staff
 * (`pending`). Another customer's review is 404.
 */
class CustomerReviews
{
    public function __construct(private readonly PurchaseVerifier $purchases) {}

    /**
     * @param  array{product_id: string, rating: int, title?: ?string, body: string}  $data
     *
     * @throws BusinessRuleViolation REVIEW_EXISTS | REVIEW_NOT_ALLOWED
     */
    public function submit(string $customerId, array $data): Review
    {
        $productId = $data['product_id'];
        $exists = fn () => new BusinessRuleViolation('REVIEW_EXISTS', 'You already reviewed this product. You can edit your review instead.', [
            'review_id' => Review::query()->where('customer_id', $customerId)->where('product_id', $productId)->value('id'),
        ]);
        if (Review::query()->where('customer_id', $customerId)->where('product_id', $productId)->exists()) {
            throw $exists();
        }

        $lineId = $this->purchases->deliveredLine($customerId, $productId);
        if ($lineId === null) {
            throw new BusinessRuleViolation('REVIEW_NOT_ALLOWED', 'You can review a product once an order with it has been delivered to you.');
        }

        try {
            return DB::transaction(fn () => Review::query()->create([
                'product_id' => $productId,
                'customer_id' => $customerId,
                'order_line_id' => $lineId,
                'rating' => (int) $data['rating'],
                'title' => self::text($data['title'] ?? null),
                'body' => trim($data['body']),
                'status' => ReviewStatus::Pending,
            ]));
        } catch (UniqueConstraintViolationException) {
            // A parallel submit won.
            throw $exists();
        }
    }

    /**
     * Any subset of rating, title and body; the review goes back to pending.
     *
     * @param  array{rating?: int, title?: ?string, body?: string}  $data
     */
    public function update(string $customerId, string $reviewId, array $data): Review
    {
        return DB::transaction(function () use ($customerId, $reviewId, $data) {
            $review = $this->own($customerId, $reviewId, lock: true);
            $changes = [];
            if (array_key_exists('rating', $data)) {
                $changes['rating'] = (int) $data['rating'];
            }
            if (array_key_exists('title', $data)) {
                $changes['title'] = self::text($data['title']);
            }
            if (array_key_exists('body', $data)) {
                $changes['body'] = trim((string) $data['body']);
            }
            $review->update($changes + [
                'status' => ReviewStatus::Pending,
                'rejection_reason' => null,
                'moderated_by' => null,
                'moderated_at' => null,
            ]);

            return $review;
        });
    }

    public function delete(string $customerId, string $reviewId): void
    {
        DB::transaction(fn () => $this->own($customerId, $reviewId, lock: true)->delete());
    }

    /**
     * @throws ModelNotFoundException
     */
    public function own(string $customerId, string $reviewId, bool $lock = false): Review
    {
        /** @var Review */
        return Review::query()->where('customer_id', $customerId)->whereKey($reviewId)
            ->when($lock, fn ($q) => $q->lockForUpdate())
            ->firstOrFail();
    }

    private static function text(?string $value): ?string
    {
        $value = trim((string) $value);

        return $value === '' ? null : $value;
    }
}
