<?php

namespace App\Modules\Storefront\Presentation\Http\Controllers;

use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Storefront\Application\Builder\BuilderPreviewLocale;
use App\Modules\Storefront\Application\Builder\Publishing\BuilderReviews;
use App\Modules\Storefront\Application\Builder\Publishing\BuilderSnapshots;
use App\Modules\Storefront\Infrastructure\Models\BuilderReview;
use App\Modules\Storefront\Presentation\Http\Support\BuilderPresenter;
use App\Modules\Storefront\Presentation\Http\Support\BuilderPublishingPresenter;
use App\Modules\Storefront\Presentation\Http\Support\PublishAtRules;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * B11: reviews of builder pages — the inbox and a review (storefront.manage), approve & publish
 * (now or later) and send back (storefront.publish), withdraw (the submitter or a publisher).
 */
class BuilderReviewController
{
    /**
     * Reviews
     *
     * `status` pending (default) | approved | sent_back | withdrawn | all; `document_id` narrows to
     * one page. Newest first, at most 200 → `[review]`.
     */
    public function index(Request $request): JsonResponse
    {
        $data = $request->validate([
            'status' => ['sometimes', Rule::in([...BuilderReview::STATUSES, 'all'])],
            'document_id' => ['sometimes', 'uuid'],
        ]);
        $status = $data['status'] ?? BuilderReview::PENDING;
        $reviews = BuilderReview::query()
            ->with(['document', 'version:id,number', 'schedule.version:id,number'])
            ->when($status !== 'all', fn ($q) => $q->where('status', $status))
            ->when(isset($data['document_id']), fn ($q) => $q->where('document_id', strtolower($data['document_id'])))
            ->orderByDesc('created_at')->orderByDesc('id')->limit(200)->get();

        return ApiResponse::success(BuilderPublishingPresenter::reviews($reviews));
    }

    /**
     * Open a review
     *
     * `{review, document: <summary>, render: <the snapshot's render payload, draft rules>,
     * changes: <compare live → snapshot>}`; `lang` picks the language of the render.
     */
    public function show(Request $request, BuilderReview $review, BuilderSnapshots $snapshots, BuilderPreviewLocale $locale): JsonResponse
    {
        $review->load(['document.publishedVersion', 'version:id,number', 'schedule.version:id,number']);
        $document = $review->document;
        $label = ['kind' => 'review', 'id' => $review->id, 'number' => null, 'name' => null];

        return ApiResponse::success([
            'review' => BuilderPublishingPresenter::reviews([$review])[0],
            'document' => BuilderPresenter::summary($document),
            'render' => $locale->using($request->query('lang'), fn () => $snapshots->render($document, $review->content, null, $label)),
            'changes' => $snapshots->compareWithLive($document, $review->content, $label),
        ])->header('Cache-Control', 'no-store, private');
    }

    /**
     * Approve & publish
     *
     * `{publish_at?, note?}` — without `publish_at` the snapshot goes live now (a version `via`
     * review; references deleted since: 422 DOCUMENT_INVALID, nothing changes); with it, it is
     * scheduled (replacing the page's pending schedule). `note` (≤ 160) is the version's note
     * (default: the review's note). `cancel_schedule` (bool, default false; publishing now only)
     * also cancels the page's pending schedule. 409 REVIEW_NOT_PENDING. → `{review, document:
     * <summary>}`.
     */
    public function approve(Request $request, BuilderReview $review, BuilderReviews $reviews): JsonResponse
    {
        $data = $request->validate(PublishAtRules::rules(false) + ['cancel_schedule' => ['sometimes', 'boolean']], PublishAtRules::messages());
        $publishAt = isset($data['publish_at']) ? CarbonImmutable::parse($data['publish_at']) : null;
        $review = $reviews->approve($review, $publishAt, $data['note'] ?? null, (bool) ($data['cancel_schedule'] ?? false));

        return $this->decided($review);
    }

    /**
     * Send back
     *
     * `{comment}` (required, ≤ 1000) — the submitter is notified. 409 REVIEW_NOT_PENDING. →
     * `{review, document}`.
     */
    public function sendBack(Request $request, BuilderReview $review, BuilderReviews $reviews): JsonResponse
    {
        $data = $request->validate(['comment' => ['required', 'string', 'max:'.BuilderReviews::COMMENT_MAX]], [
            'comment.required' => 'Write what needs to change.',
        ]);

        return $this->decided($reviews->sendBack($review, $data['comment']));
    }

    /**
     * Withdraw a review
     *
     * The submitter, or someone with storefront.publish (others: 403 REVIEW_NOT_YOURS). 409
     * REVIEW_NOT_PENDING. → `{review, document}`.
     */
    public function withdraw(Request $request, BuilderReview $review, BuilderReviews $reviews): JsonResponse
    {
        return $this->decided($reviews->withdraw($review, (bool) $request->user()?->can('storefront.publish')));
    }

    private function decided(BuilderReview $review): JsonResponse
    {
        $review = $review->fresh(['document.publishedVersion', 'version:id,number', 'schedule.version:id,number']);

        return ApiResponse::success([
            'review' => BuilderPublishingPresenter::reviews([$review])[0],
            'document' => BuilderPresenter::summary($review->document),
        ]);
    }
}
