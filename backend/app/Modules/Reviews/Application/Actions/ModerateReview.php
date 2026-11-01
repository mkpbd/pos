<?php

namespace App\Modules\Reviews\Application\Actions;

use App\Modules\Reviews\Domain\ReviewStatus;
use App\Modules\Reviews\Infrastructure\Models\Review;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use Illuminate\Support\Facades\DB;

/**
 * Staff moderation of reviews (E9): approve (shown on the product page), reject (hidden,
 * optional reason the author sees), delete. Approving an approved review or rejecting a
 * rejected one changes nothing (idempotent). Every change is audited.
 */
class ModerateReview
{
    public function __construct(private readonly AuditTrail $audit) {}

    public function approve(Review $review, string $actorId): Review
    {
        return DB::transaction(function () use ($review, $actorId) {
            $locked = $this->lock($review);
            if ($locked->status === ReviewStatus::Approved) {
                return $locked;
            }
            $from = $locked->status;
            $locked->update([
                'status' => ReviewStatus::Approved,
                'rejection_reason' => null,
                'moderated_by' => $actorId,
                'moderated_at' => now(),
            ]);
            $this->audit->record('review.approved', $locked, ['status' => $from->value], ['status' => ReviewStatus::Approved->value]);

            return $locked;
        });
    }

    public function reject(Review $review, ?string $reason, string $actorId): Review
    {
        return DB::transaction(function () use ($review, $reason, $actorId) {
            $locked = $this->lock($review);
            if ($locked->status === ReviewStatus::Rejected) {
                return $locked;
            }
            $from = $locked->status;
            $locked->update([
                'status' => ReviewStatus::Rejected,
                'rejection_reason' => $reason,
                'moderated_by' => $actorId,
                'moderated_at' => now(),
            ]);
            $this->audit->record('review.rejected', $locked, ['status' => $from->value], ['status' => ReviewStatus::Rejected->value, 'reason' => $reason]);

            return $locked;
        });
    }

    public function delete(Review $review): void
    {
        DB::transaction(function () use ($review) {
            $locked = $this->lock($review);
            $this->audit->record('review.deleted', $locked, [
                'status' => $locked->status->value,
                'rating' => $locked->rating,
                'product_id' => $locked->product_id,
                'customer_id' => $locked->customer_id,
            ]);
            $locked->delete();
        });
    }

    private function lock(Review $review): Review
    {
        /** @var Review */
        return Review::query()->whereKey($review->id)->lockForUpdate()->firstOrFail();
    }
}
