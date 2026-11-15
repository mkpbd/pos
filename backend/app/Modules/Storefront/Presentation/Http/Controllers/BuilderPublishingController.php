<?php

namespace App\Modules\Storefront\Presentation\Http\Controllers;

use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Storefront\Application\Builder\BuilderPreviewLocale;
use App\Modules\Storefront\Application\Builder\Publishing\BuilderCheckpoints;
use App\Modules\Storefront\Application\Builder\Publishing\BuilderPublishSchedules;
use App\Modules\Storefront\Application\Builder\Publishing\BuilderReviews;
use App\Modules\Storefront\Application\Builder\Publishing\BuilderSnapshots;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;
use App\Modules\Storefront\Infrastructure\Models\BuilderVersion;
use App\Modules\Storefront\Presentation\Http\Support\BuilderPresenter;
use App\Modules\Storefront\Presentation\Http\Support\BuilderPublishingPresenter;
use App\Modules\Storefront\Presentation\Http\Support\PublishAtRules;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * B11: publishing a builder document later, draft checkpoints and named versions, a version's
 * render and the change list between two snapshots, and submitting the draft for review. Reading
 * needs storefront.view; checkpoints, names and submitting storefront.manage; scheduling also
 * storefront.publish.
 */
class BuilderPublishingController
{
    /**
     * Publish later
     *
     * `{publish_at, note?}` — `publish_at` an ISO date-time in the future, at most a year ahead;
     * `note` ≤ 160 (becomes the version's note). Snapshots the current draft: that snapshot goes
     * live at `publish_at` even when the draft changes later. Replaces the document's pending
     * schedule. Returns the document (with `schedule`). 422 DOCUMENT_EMPTY.
     */
    public function schedule(Request $request, BuilderDocument $document, BuilderPublishSchedules $schedules): JsonResponse
    {
        $data = $request->validate(PublishAtRules::rules(true), PublishAtRules::messages());
        $schedules->schedule($document, CarbonImmutable::parse($data['publish_at']), $data['note'] ?? null);

        return ApiResponse::success(BuilderPresenter::document($document->fresh()->load('publishedVersion')));
    }

    /**
     * Cancel publish later
     *
     * Cancels the pending schedule (409 NOTHING_SCHEDULED when none). Returns the document.
     */
    public function cancelSchedule(BuilderDocument $document, BuilderPublishSchedules $schedules): JsonResponse
    {
        $schedules->cancel($document);

        return ApiResponse::success(BuilderPresenter::document($document->fresh()->load('publishedVersion')));
    }

    /**
     * Save a named copy of the draft
     *
     * `{name?}` (≤ 80) — a draft checkpoint (not published; restore it like a version). At most
     * 20 per document: the oldest unnamed one is replaced; 422 CHECKPOINT_LIMIT when all have
     * names. → 201 the version item (`kind: checkpoint`).
     */
    public function checkpoint(Request $request, BuilderDocument $document, BuilderCheckpoints $checkpoints): JsonResponse
    {
        $data = $request->validate(['name' => ['sometimes', 'nullable', 'string', 'max:'.BuilderCheckpoints::NAME_MAX]]);
        $checkpoint = $checkpoints->save($document, $data['name'] ?? null);

        return ApiResponse::created(BuilderPublishingPresenter::versions([$checkpoint])[0]);
    }

    /**
     * Name a version or checkpoint
     *
     * `{name}` (≤ 80; null or empty clears it). Audited.
     */
    public function renameVersion(Request $request, BuilderDocument $document, BuilderVersion $version, BuilderCheckpoints $checkpoints): JsonResponse
    {
        $data = $request->validate(['name' => ['present', 'nullable', 'string', 'max:'.BuilderCheckpoints::NAME_MAX]]);

        return ApiResponse::success(BuilderPublishingPresenter::versions([$checkpoints->rename($document, $version, $data['name'])])[0]);
    }

    /**
     * Delete a checkpoint
     *
     * Checkpoints only (a published version: 409 VERSION_NOT_DELETABLE). → 204.
     */
    public function deleteVersion(BuilderDocument $document, BuilderVersion $version, BuilderCheckpoints $checkpoints): JsonResponse
    {
        $checkpoints->delete($document, $version);

        return ApiResponse::noContent();
    }

    /**
     * Render a version or checkpoint
     *
     * The render payload of that snapshot as the canvas needs it (draft rules: hidden and
     * scheduled nodes with `state`, global sections' drafts) plus `snapshot {kind, id, number,
     * name}`; `lang` picks the language.
     */
    public function renderVersion(Request $request, BuilderDocument $document, BuilderVersion $version, BuilderSnapshots $snapshots, BuilderPreviewLocale $locale): JsonResponse
    {
        return ApiResponse::success($locale->using($request->query('lang'), fn () => $snapshots->renderVersion($document, $version)))
            ->header('Cache-Control', 'no-store, private');
    }

    /**
     * Compare two snapshots
     *
     * `from`, `to`: `draft`, `live` or a version / checkpoint id of the document (default `live`
     * → `draft`). → `{from: {kind, id, number, name}, to: {…}, added: [{id, type, kind, parent_id,
     * label}], removed: […], changed: [{node_id, type, fields: [{field, before, after}]}], moved:
     * [node id], device_moved: [{id, device: tablet|mobile}]}` — a changed style is the field
     * `style` with null values; page settings changes have `node_id` null and `type` `document`;
     * B12: `device_moved` lists nodes moved in a tablet / phone order of their own. 404
     * VERSION_NOT_FOUND.
     */
    public function compare(Request $request, BuilderDocument $document, BuilderSnapshots $snapshots): JsonResponse
    {
        $token = ['sometimes', 'string', 'regex:/^(draft|live|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/'];
        $data = $request->validate(['from' => $token, 'to' => $token]);

        return ApiResponse::success($snapshots->compare($document->load('publishedVersion'), $data['from'] ?? 'live', $data['to'] ?? 'draft'));
    }

    /**
     * Submit for review
     *
     * `{note?}` (≤ 500). Snapshots the draft for someone who may publish (bell notification to
     * them); replaces the document's pending review. 422 DOCUMENT_EMPTY. → 201 the review.
     */
    public function submitReview(Request $request, BuilderDocument $document, BuilderReviews $reviews): JsonResponse
    {
        $data = $request->validate(['note' => ['sometimes', 'nullable', 'string', 'max:'.BuilderReviews::NOTE_MAX]]);
        $review = $reviews->submit($document, $data['note'] ?? null);

        return ApiResponse::created(BuilderPublishingPresenter::reviews([$review->load('document')])[0]);
    }
}
