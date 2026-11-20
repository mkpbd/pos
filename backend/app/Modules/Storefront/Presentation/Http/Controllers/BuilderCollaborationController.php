<?php

namespace App\Modules\Storefront\Presentation\Http\Controllers;

use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Storefront\Application\Builder\Collaboration\BuilderActivity;
use App\Modules\Storefront\Application\Builder\Collaboration\BuilderComments;
use App\Modules\Storefront\Application\Builder\Collaboration\BuilderPresence;
use App\Modules\Storefront\Infrastructure\Models\BuilderComment;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;
use App\Modules\Storefront\Presentation\Http\Support\BuilderCommentPresenter;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * B16: working together in the store builder — presence and the edit lock (one editor at a time
 * per document; heartbeats, no websockets), comments pinned on the page and the page's activity
 * log. Reading, presence and comments need storefront.view; taking or asking for the lock
 * storefront.manage (taking it from someone whose lease is live: storefront.publish).
 */
class BuilderCollaborationController
{
    /**
     * Heartbeat (presence)
     *
     * `{editing: bool}` every ~20 s while the editor is open (and on focus). Returns `{viewers:
     * [{user {id, name}, editing, since, last_seen, is_me}], lock: null | {user {id, name},
     * acquired_at, expires_at}, mine, draft_revision, draft_updated_at, comments: {open,
     * updated_at}}`. A viewer is gone after 60 s without a heartbeat. `editing: true` from someone
     * with storefront.manage takes the lock when nobody else holds a live one (and renews it);
     * `editing: false` from the holder releases it; the lease ends 90 s after the holder's last
     * heartbeat. `viewers[].editing` is true for the lock holder only.
     */
    public function heartbeat(Request $request, BuilderDocument $document, BuilderPresence $presence): JsonResponse
    {
        $editing = (bool) $request->validate(['editing' => ['required', 'boolean']])['editing'];

        return $this->noStore(ApiResponse::success($presence->heartbeat($document, $editing, (bool) $request->user()?->can('storefront.manage'))));
    }

    /**
     * Leave (presence)
     *
     * The editor closed (fetch with `keepalive`): my entry goes and my lock is released. 204.
     */
    public function leave(BuilderDocument $document, BuilderPresence $presence): JsonResponse
    {
        $presence->leave($document);

        return ApiResponse::noContent();
    }

    /**
     * Take over editing
     *
     * Moves the lock to me. While someone else's lease is live this needs storefront.publish (403
     * TAKE_OVER_FORBIDDEN with `details.user`); after it expired anyone with storefront.manage
     * may. The previous editor gets a bell notification and their editor turns view-only on its
     * next heartbeat. Audited (`storefront.builder_lock_taken_over`). Returns the presence state.
     */
    public function takeOver(Request $request, BuilderDocument $document, BuilderPresence $presence): JsonResponse
    {
        return $this->noStore(ApiResponse::success($presence->takeOver($document, (bool) $request->user()?->can('storefront.publish'))));
    }

    /**
     * Ask to edit
     *
     * A bell notification for whoever holds the lock ("Rima asks to edit Eid sale"); 409
     * NOT_LOCKED when nobody else does. `{sent: false}` when you already asked within a minute.
     */
    public function requestEdit(BuilderDocument $document, BuilderPresence $presence): JsonResponse
    {
        return ApiResponse::success($presence->requestEdit($document));
    }

    /**
     * List comments
     *
     * `status` open (default) | resolved | all. Threads in pin order: `{id, number, node_id,
     * node_removed, anchor {x, y}|null, body, mentions [{id, name}], author {id, name}|null,
     * parent_id: null, resolved_at, resolved_by, created_at, updated_at, edited_at, can_edit,
     * can_delete, replies: [same fields, oldest first]}`; `meta.counts {open, resolved}`.
     */
    public function comments(Request $request, BuilderDocument $document, BuilderComments $comments): JsonResponse
    {
        $status = $request->validate(['status' => ['sometimes', Rule::in(BuilderComments::STATUSES)]])['status'] ?? 'open';

        return ApiResponse::success(
            BuilderCommentPresenter::threads($comments->threads($document, $status), $document, $this->viewer($request), $this->mayPublish($request)),
            meta: ['counts' => $comments->counts($document)],
        );
    }

    /**
     * Add a comment or a reply
     *
     * `{body (1–2000), node_id?, anchor? {x, y} (0–1 inside the node), parent_id?, mentions?:
     * uuid[]}`. `node_id` must be in the saved draft (422 NODE_NOT_FOUND); `parent_id` must be a
     * thread of this page (422 INVALID_PARENT; replies have no node or anchor). `@Name` in the
     * text and the ids picked from the autocomplete mention staff who can view the store builder
     * (others are ignored); they get a bell, and on a reply so do the thread's other
     * participants. 201 with the comment.
     */
    public function storeComment(Request $request, BuilderDocument $document, BuilderComments $comments): JsonResponse
    {
        $data = $request->validate([
            'body' => ['required', 'string', 'max:'.BuilderComment::BODY_MAX, 'regex:/\S/u'],
            'node_id' => ['sometimes', 'nullable', 'string', 'max:64'],
            'anchor' => ['sometimes', 'nullable', 'array:x,y'],
            'anchor.x' => ['required_with:anchor', 'numeric', 'between:0,1'],
            'anchor.y' => ['required_with:anchor', 'numeric', 'between:0,1'],
            'parent_id' => ['sometimes', 'nullable', 'uuid'],
            'mentions' => ['sometimes', 'nullable', 'array', 'max:50'],
            'mentions.*' => ['uuid'],
        ], ['body.regex' => 'Write a comment.']);
        $comment = $comments->post($document, $data);

        return ApiResponse::created(BuilderCommentPresenter::one($comment, $document, $this->viewer($request), $this->mayPublish($request)));
    }

    /**
     * Edit a comment
     *
     * `{body}` — the author only (403 COMMENT_NOT_YOURS), within 15 minutes of posting (422
     * COMMENT_EDIT_CLOSED). Newly mentioned staff get a bell.
     */
    public function updateComment(Request $request, BuilderDocument $document, BuilderComment $comment, BuilderComments $comments): JsonResponse
    {
        $body = $request->validate([
            'body' => ['required', 'string', 'max:'.BuilderComment::BODY_MAX, 'regex:/\S/u'],
        ], ['body.regex' => 'Write a comment.'])['body'];

        return ApiResponse::success(BuilderCommentPresenter::one($comments->edit($document, $comment, $body), $document, $this->viewer($request), $this->mayPublish($request)));
    }

    /**
     * Resolve a comment thread
     *
     * Threads only (422 NOT_A_THREAD). Audited. Returns the thread.
     */
    public function resolveComment(Request $request, BuilderDocument $document, BuilderComment $comment, BuilderComments $comments): JsonResponse
    {
        return ApiResponse::success(BuilderCommentPresenter::one($comments->resolve($document, $comment, true), $document, $this->viewer($request), $this->mayPublish($request)));
    }

    /**
     * Reopen a comment thread
     *
     * Threads only (422 NOT_A_THREAD). Audited. Returns the thread.
     */
    public function reopenComment(Request $request, BuilderDocument $document, BuilderComment $comment, BuilderComments $comments): JsonResponse
    {
        return ApiResponse::success(BuilderCommentPresenter::one($comments->resolve($document, $comment, false), $document, $this->viewer($request), $this->mayPublish($request)));
    }

    /**
     * Delete a comment
     *
     * The author or someone who may publish (403 COMMENT_NOT_YOURS); a thread goes with its
     * replies. Audited. 204.
     */
    public function destroyComment(Request $request, BuilderDocument $document, BuilderComment $comment, BuilderComments $comments): JsonResponse
    {
        $comments->delete($document, $comment, $this->mayPublish($request));

        return ApiResponse::noContent();
    }

    /**
     * People to mention
     *
     * `q` (part of a name). Active staff of the organization who can view the store builder,
     * `[{id, name}]` by name, at most 20.
     */
    public function mentionable(Request $request, BuilderComments $comments, TenantContext $tenant): JsonResponse
    {
        $query = $request->validate(['q' => ['sometimes', 'nullable', 'string', 'max:80']])['q'] ?? null;

        return ApiResponse::success($comments->mentionable($tenant->requireOrganization(), $query));
    }

    /**
     * Activity log
     *
     * Newest first: `[{id, at, user {id, name}|null, action, summary, details}]` — the page's
     * audit entries (`action` without the `storefront.builder_` prefix: created, renamed,
     * published {version_id, version_number, note, via}, unpublished, discarded, restored
     * {version_id, version_number | name}, checkpoint_saved, publish_scheduled, schedule_cancelled,
     * schedule_failed, review_submitted / approved / sent_back / withdrawn, experiment_*,
     * lock_taken_over, comment_resolved / reopened / deleted …) and edit sessions (`edited`:
     * {started_at, ended_at, saves}; saves less than 15 minutes apart are one session).
     * `before` (exclusive) pages back; `meta.next_before` is null on the last page. `limit` 1–50
     * (30).
     */
    public function activity(Request $request, BuilderDocument $document, BuilderActivity $activity): JsonResponse
    {
        $data = $request->validate([
            'before' => ['sometimes', 'nullable', 'date'],
            'limit' => ['sometimes', 'integer', 'min:1', 'max:'.BuilderActivity::PAGE_MAX],
        ]);
        $page = $activity->page(
            $document,
            isset($data['before']) ? CarbonImmutable::parse($data['before']) : null,
            (int) ($data['limit'] ?? BuilderActivity::PAGE),
        );

        return $this->noStore(ApiResponse::success($page['items'], meta: ['next_before' => $page['next_before']]));
    }

    private function viewer(Request $request): ?string
    {
        $id = $request->user()?->getAuthIdentifier();

        return $id === null ? null : (string) $id;
    }

    private function mayPublish(Request $request): bool
    {
        return (bool) $request->user()?->can('storefront.publish');
    }

    private function noStore(JsonResponse $response): JsonResponse
    {
        return $response->header('Cache-Control', 'no-store, private');
    }
}
