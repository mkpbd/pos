<?php

namespace App\Modules\Social\Presentation\Http\Controllers;

use App\Modules\Shared\Infrastructure\Http\Queries\ListQuery;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Social\Application\Actions\SaveSocialPost;
use App\Modules\Social\Application\Actions\SocialPostWorkflow;
use App\Modules\Social\Domain\PostStatus;
use App\Modules\Social\Domain\PostTarget;
use App\Modules\Social\Infrastructure\Models\SocialPost;
use App\Modules\Social\Presentation\Http\Requests\SaveSocialPostRequest;
use App\Modules\Social\Presentation\Http\Support\SocialPresenter;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Validation\Rule;

/**
 * P2b: Facebook & Instagram posts.
 */
class SocialPostController
{
    public function __construct(private readonly SocialPresenter $presenter) {}

    /**
     * Social posts
     *
     * Filters `status`, `target` (facebook|instagram), `product_id`, `campaign_id`, `search`
     * (caption). Newest first. Rows: `{id, caption, targets, image_ids, media_ids, media: [{id, kind,
     * url}], link_url, product, campaign, status, scheduled_at, published_at, results: [{target,
     * status, remote_id, permalink, error: {code, message}|null, short_link: {code, url}|null,
     * published_at, sandbox}], allowed_actions, created_by, created_at, updated_at}`.
     */
    public function index(Request $request): JsonResponse
    {
        $request->validate([
            'status' => ['sometimes', Rule::in(PostStatus::values())],
            'target' => ['sometimes', Rule::in(PostTarget::values())],
            'product_id' => ['sometimes', 'uuid'],
            'campaign_id' => ['sometimes', 'uuid'],
            'search' => ['sometimes', 'nullable', 'string', 'max:100'],
        ]);
        $search = trim((string) $request->query('search', ''));
        $page = SocialPost::query()->with('results')
            ->when($request->query('status'), fn (Builder $q, string $v) => $q->where('status', $v))
            ->when($request->query('target'), fn (Builder $q, string $v) => $q->whereJsonContains('targets', $v))
            ->when($request->query('product_id'), fn (Builder $q, string $v) => $q->where('product_id', strtolower($v)))
            ->when($request->query('campaign_id'), fn (Builder $q, string $v) => $q->where('campaign_id', strtolower($v)))
            ->when($search !== '', fn (Builder $q) => $q->whereRaw("lower(caption) like ? escape '!'", ['%'.str_replace(['!', '%', '_'], ['!!', '!%', '!_'], mb_strtolower($search)).'%']))
            ->orderByDesc('created_at')->orderBy('id')
            ->paginate(ListQuery::perPage($request));
        $rows = array_column($this->presenter->posts($page->items()), null, 'id');

        return ApiResponse::paginated($page, fn (SocialPost $p) => new JsonResource($rows[$p->id]));
    }

    public function show(SocialPost $post): JsonResponse
    {
        return ApiResponse::success($this->presenter->post($post));
    }

    /**
     * Create a post
     *
     * `{caption (1–2200), targets: ["facebook", "instagram"], image_ids?: [product photo ids],
     * media_ids?: [media library ids] (together ≤ 10), link_url?: store path|null, product_id?,
     * campaign_id?, scheduled_at?: ISO 8601|null}` → 201. Without `scheduled_at` a draft; with one
     * (future, ≤ 1 year) scheduled — then it must be publishable (SOCIAL_NOT_CONNECTED,
     * INSTAGRAM_NOT_CONNECTED, INSTAGRAM_IMAGE_REQUIRED, INSTAGRAM_TOO_MANY_HASHTAGS, live:
     * MEDIA_NOT_PUBLIC, INSTAGRAM_JPEG_ONLY). A product post without a link links to the product.
     */
    public function store(SaveSocialPostRequest $request, SaveSocialPost $save): JsonResponse
    {
        return ApiResponse::created($this->presenter->post($save->create($request->attributesForSave())));
    }

    /**
     * Change a post
     *
     * Draft, scheduled or failed posts only (INVALID_STATUS_TRANSITION). `scheduled_at: null`
     * makes it a draft; a changed failed post starts over.
     */
    public function update(SaveSocialPostRequest $request, SocialPost $post, SaveSocialPost $save): JsonResponse
    {
        return ApiResponse::success($this->presenter->post($save->update($post, $request->attributesForSave())));
    }

    /**
     * Publish now
     *
     * Draft or scheduled → publishing (queued; with a synchronous queue the answer already has the
     * outcome). Same checks as scheduling. Audited.
     */
    public function publish(SocialPost $post, SocialPostWorkflow $workflow): JsonResponse
    {
        return ApiResponse::success($this->presenter->post($workflow->publish($post)));
    }

    /**
     * Cancel the schedule (scheduled → draft).
     */
    public function cancel(SocialPost $post, SocialPostWorkflow $workflow): JsonResponse
    {
        return ApiResponse::success($this->presenter->post($workflow->cancel($post)));
    }

    /**
     * Retry the failed targets
     *
     * Failed or partially published posts: only the failed targets are published again. Audited.
     */
    public function retry(SocialPost $post, SocialPostWorkflow $workflow): JsonResponse
    {
        return ApiResponse::success($this->presenter->post($workflow->retry($post)));
    }

    /**
     * Delete a post
     *
     * Draft, scheduled or failed posts only (nothing of it is on a network). Audited.
     */
    public function destroy(SocialPost $post, SocialPostWorkflow $workflow): JsonResponse
    {
        $workflow->delete($post);

        return ApiResponse::noContent();
    }
}
