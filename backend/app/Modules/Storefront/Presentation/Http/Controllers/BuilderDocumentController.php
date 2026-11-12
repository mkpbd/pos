<?php

namespace App\Modules\Storefront\Presentation\Http\Controllers;

use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Storefront\Application\Builder\BuilderCanvasContext;
use App\Modules\Storefront\Application\Builder\BuilderPages;
use App\Modules\Storefront\Application\Builder\BuilderPreviewLocale;
use App\Modules\Storefront\Application\Builder\ManageBuilderDocuments;
use App\Modules\Storefront\Application\Builder\ResolveBuilderElements;
use App\Modules\Storefront\Domain\Builder\ElementRegistry;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;
use App\Modules\Storefront\Infrastructure\Models\BuilderVersion;
use App\Modules\Storefront\Presentation\Http\Requests\CreateBuilderDocumentRequest;
use App\Modules\Storefront\Presentation\Http\Requests\ResolveBuilderElementsRequest;
use App\Modules\Storefront\Presentation\Http\Requests\SaveBuilderDraftRequest;
use App\Modules\Storefront\Presentation\Http\Support\BuilderPresenter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Store builder documents (B1): pages with a draft, immutable published versions, discard
 * and restore; B2 adds rename, the editor's canvas context and the canvas resolver for unsaved
 * elements. Reading needs storefront.view, editing (and resolving) storefront.manage,
 * publishing also storefront.publish.
 */
class BuilderDocumentController
{
    /**
     * List builder documents
     *
     * Each with its draft revision, whether the draft differs from the live version, the
     * published version (or null), its `path` on the store (`/`, `/p/<slug>`) and
     * `preview_url` (the draft on the store's primary domain; null without a domain).
     */
    public function index(): JsonResponse
    {
        return ApiResponse::success(BuilderPresenter::summaries(BuilderDocument::query()->pages()->with('publishedVersion')->orderBy('key')->get()));
    }

    /**
     * Create a builder page
     *
     * `key`: `home` (once) or `landing:<slug>`; 409 DOCUMENT_EXISTS when taken. `from:
     * homepage` converts the current homepage sections into the draft.
     */
    public function store(CreateBuilderDocumentRequest $request, ManageBuilderDocuments $documents): JsonResponse
    {
        return ApiResponse::created(BuilderPresenter::document($documents->create($request->validated())->load('publishedVersion')));
    }

    /**
     * Show a builder document
     *
     * The summary with the draft as `content`.
     */
    public function show(BuilderDocument $document): JsonResponse
    {
        return ApiResponse::success(BuilderPresenter::document($document->load('publishedVersion')));
    }

    /**
     * Rename a builder document
     *
     * `{title}` (1–160 characters). Audited; the draft and the live page are unchanged.
     */
    public function rename(Request $request, BuilderDocument $document, ManageBuilderDocuments $documents): JsonResponse
    {
        $title = $request->validate(['title' => ['required', 'string', 'max:160']])['title'];

        return ApiResponse::success(BuilderPresenter::document($documents->rename($document, $title)->load('publishedVersion')));
    }

    /**
     * Save the draft
     *
     * The whole document with the revision it was edited from: normalized, sanitized and
     * reference-checked (422 DOCUMENT_INVALID with `details.errors[]` {path, node_id, message});
     * a stale revision is 409 DRAFT_CONFLICT with `details.revision`. Not live until published.
     */
    public function saveDraft(SaveBuilderDraftRequest $request, BuilderDocument $document, ManageBuilderDocuments $documents): JsonResponse
    {
        $saved = $documents->saveDraft($document, (int) $request->validated('revision'), (array) $request->validated('content'));

        return ApiResponse::success(BuilderPresenter::document($saved->load('publishedVersion')));
    }

    /**
     * Publish the draft
     *
     * A new version (number max+1) goes live; audited, the storefront cache is refreshed.
     */
    public function publish(Request $request, BuilderDocument $document, ManageBuilderDocuments $documents): JsonResponse
    {
        $note = $request->validate(['note' => ['sometimes', 'nullable', 'string', 'max:160']])['note'] ?? null;

        return ApiResponse::success(BuilderPresenter::document($documents->publish($document, $note)->load('publishedVersion')));
    }

    /**
     * Discard the draft
     *
     * Back to the published content (409 NOTHING_PUBLISHED when never published).
     */
    public function discard(BuilderDocument $document, ManageBuilderDocuments $documents): JsonResponse
    {
        return ApiResponse::success(BuilderPresenter::document($documents->discard($document)->load('publishedVersion')));
    }

    /**
     * Version history
     *
     * Newest first.
     */
    public function versions(BuilderDocument $document): JsonResponse
    {
        return ApiResponse::success(BuilderPresenter::versions($document->versions()->orderByDesc('number')->get()));
    }

    /**
     * Restore a version
     *
     * Copies it into the draft; it goes live when published.
     */
    public function restore(BuilderDocument $document, BuilderVersion $version, ManageBuilderDocuments $documents): JsonResponse
    {
        return ApiResponse::success(BuilderPresenter::document($documents->restore($document, $version)->load('publishedVersion')));
    }

    /**
     * Delete a landing page
     *
     * With its versions. The home page cannot be deleted (422 CANNOT_DELETE_HOME).
     */
    public function destroy(BuilderDocument $document, ManageBuilderDocuments $documents): JsonResponse
    {
        $documents->delete($document);

        return ApiResponse::noContent();
    }

    /**
     * Element registry
     *
     * Element types (group, label, translatable props, default props, children), limits and
     * enums for the editor.
     */
    public function elements(): JsonResponse
    {
        return ApiResponse::success(ElementRegistry::metadata());
    }

    /**
     * Resolve unsaved elements for the canvas
     *
     * `{elements: [{id, type, title, subtitle, config, items, translations}] (≤ 60), media_ids:
     * uuid[] (≤ 200), locale?}`. Each wrapped-section element is validated on its own with the
     * draft-save rules; a valid one is resolved to its draft-render object (with `state`).
     * Returns `{data: {<element id>: …}, media: {<media id>: {url, srcset, width, height,
     * alt}}, errors: {<element or media id>: [{path, message, code?, ids?}]}}` — invalid
     * elements and unknown (or another organization's) media appear only in `errors`. 422
     * only for a malformed envelope.
     */
    public function resolve(ResolveBuilderElementsRequest $request, ResolveBuilderElements $resolve): JsonResponse
    {
        return ApiResponse::success($resolve($request->elements(), $request->mediaIds(), $request->validated('locale')));
    }

    /**
     * Canvas context
     *
     * `{bootstrap, theme_source, store_url, locales}`: the `/store/bootstrap` payload of the
     * signed-in staff member's organization (also while the store is closed or has no domain;
     * `lang` picks the language) with the **draft theme** (B3, `theme_source: "draft"`), the
     * primary store URL (null without a domain) and the enabled languages. `no-store`.
     */
    public function canvasContext(Request $request, BuilderCanvasContext $context): JsonResponse
    {
        return ApiResponse::success($context->build($request->query('lang')))->header('Cache-Control', 'no-store, private');
    }

    /**
     * Render a document
     *
     * The storefront render payload of the draft (default) or the published version (409
     * NOTHING_PUBLISHED when none), as the store would show it; `lang` picks the language.
     */
    public function render(Request $request, BuilderDocument $document, BuilderPages $pages, BuilderPreviewLocale $locale): JsonResponse
    {
        $source = $request->validate(['source' => ['sometimes', Rule::in(['draft', 'published'])]])['source'] ?? 'draft';

        $payload = $locale->using($request->query('lang'), fn () => $pages->renderDocument($document->load('publishedVersion'), $source));
        if ($payload === null) {
            throw new BusinessRuleViolation('NOTHING_PUBLISHED', 'This page has not been published yet.', [], 409);
        }

        return ApiResponse::success($payload);
    }
}
