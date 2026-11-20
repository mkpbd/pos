<?php

namespace App\Modules\OnlineCatalog\Presentation\Http\Controllers;

use App\Modules\OnlineCatalog\Application\Ai\AiDraftsView;
use App\Modules\OnlineCatalog\Application\Ai\CreateAiDraftBatch;
use App\Modules\OnlineCatalog\Application\Ai\ReviewAiDrafts;
use App\Modules\OnlineCatalog\Domain\Ai\CatalogTextFields;
use App\Modules\OnlineCatalog\Infrastructure\Models\AiContentBatch;
use App\Modules\OnlineCatalog\Infrastructure\Models\AiContentDraft;
use App\Modules\OnlineCatalog\Presentation\Http\Requests\CreateAiDraftBatchRequest;
use App\Modules\Shared\Application\Support\StaffActor;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Validation\Rule;

/**
 * AI2a §2: AI drafts — many listing texts written at once and reviewed before saving.
 */
class AiDraftController
{
    /**
     * Start writing AI drafts
     *
     * `{subject, ids?: [uuid] | missing?: [description|seo|bangla], fields, languages, tone?,
     * length?, notes?}` → 201 batch. 422 BATCH_TOO_LARGE (more than 200 ids), 409 BATCH_RUNNING
     * (`details.batch_id`), 422 NOTHING_TO_WRITE, 422 AI_UNAVAILABLE (`reason: disabled`), 404
     * for another store's id. The drafts are written by a queued job (feature `catalog_drafts`).
     */
    public function store(CreateAiDraftBatchRequest $request, CreateAiDraftBatch $create, AiDraftsView $view): JsonResponse
    {
        return ApiResponse::created($view->presentBatch($create($request->validated(), StaffActor::id())));
    }

    /**
     * AI drafts batches
     *
     * Newest first, 20 per page, with progress and draft counts.
     */
    public function index(Request $request, AiDraftsView $view): JsonResponse
    {
        $request->validate(['page' => ['sometimes', 'integer', 'min:1']]);
        $page = AiContentBatch::query()->orderByDesc('created_at')->orderByDesc('id')->paginate(20);
        $items = $view->presentBatches($page->items());

        return ApiResponse::paginated($page->setCollection(collect($items)), fn (array $item) => new JsonResource($item));
    }

    public function show(string $batchId, AiDraftsView $view): JsonResponse
    {
        return ApiResponse::success($view->presentBatch(AiContentBatch::query()->findOrFail(strtolower($batchId))));
    }

    /**
     * Cancel an AI drafts batch
     *
     * Drafts already written stay. 409 BATCH_NOT_RUNNING when it is not queued or running.
     */
    public function cancel(string $batchId, ReviewAiDrafts $review, AiDraftsView $view): JsonResponse
    {
        return ApiResponse::success($view->presentBatch($review->cancel($batchId)));
    }

    /**
     * AI drafts
     *
     * `?status=&subject=&batch_id=&search=&page=&per_page=` (≤ 100, default 20), newest first:
     * each draft with its proposed and current texts per field (`changed` when the current text
     * is no longer the one the proposal was written from).
     */
    public function drafts(Request $request, AiDraftsView $view): JsonResponse
    {
        $filters = $request->validate([
            'status' => ['sometimes', 'nullable', Rule::in(AiContentDraft::STATUSES)],
            'subject' => ['sometimes', 'nullable', Rule::in(CatalogTextFields::SUBJECTS)],
            'batch_id' => ['sometimes', 'nullable', 'uuid'],
            'search' => ['sometimes', 'nullable', 'string', 'max:100'],
            'page' => ['sometimes', 'integer', 'min:1'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:100'],
        ]);
        $page = $view->drafts($filters, (int) ($filters['per_page'] ?? 20));
        $items = $view->presentDrafts($page->items());

        return ApiResponse::paginated($page->setCollection(collect($items)), fn (array $item) => new JsonResource($item));
    }

    /**
     * Approve an AI draft
     *
     * `{fields: {<field>: text}, force?: bool}` — saves only these fields (edited or not) through
     * the listing's save; never publishes. 409 DRAFT_STALE (`details.fields`) when a text changed
     * since the draft was written (send `force: true` to replace it), 409 DRAFT_NOT_PENDING.
     */
    public function approve(Request $request, string $draftId, ReviewAiDrafts $review, AiDraftsView $view): JsonResponse
    {
        $data = $request->validate([
            'fields' => ['required', 'array'],
            'force' => ['sometimes', 'boolean'],
        ]);

        return ApiResponse::success($view->presentDraft($review->approve($draftId, $data['fields'], (bool) ($data['force'] ?? false), StaffActor::id())));
    }

    public function reject(string $draftId, ReviewAiDrafts $review, AiDraftsView $view): JsonResponse
    {
        return ApiResponse::success($view->presentDraft($review->reject($draftId, StaffActor::id())));
    }

    /**
     * Approve many AI drafts
     *
     * `{ids: [uuid] (≤ 100)}` → `{approved: [id], skipped: [{id, reason: not_found | not_pending
     * | failed | stale | invalid}]}`. Proposals are saved unchanged; stale drafts are skipped and
     * marked `stale`.
     */
    public function approveMany(Request $request, ReviewAiDrafts $review): JsonResponse
    {
        $data = $request->validate([
            'ids' => ['required', 'array', 'list', 'min:1', 'max:'.ReviewAiDrafts::MAX_BULK],
            'ids.*' => ['required', 'uuid'],
        ]);

        return ApiResponse::success($review->approveMany($data['ids'], StaffActor::id()));
    }
}
