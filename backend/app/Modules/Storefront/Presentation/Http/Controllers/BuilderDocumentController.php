<?php

namespace App\Modules\Storefront\Presentation\Http\Controllers;

use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Storefront\Application\Builder\BuilderCanvasContext;
use App\Modules\Storefront\Application\Builder\BuilderPages;
use App\Modules\Storefront\Application\Builder\BuilderPreviewLocale;
use App\Modules\Storefront\Application\Builder\EditBuilderBanner;
use App\Modules\Storefront\Application\Builder\ManageBuilderDocuments;
use App\Modules\Storefront\Application\Builder\ResolveBuilderElements;
use App\Modules\Storefront\Domain\Builder\ElementRegistry;
use App\Modules\Storefront\Infrastructure\Models\Banner;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;
use App\Modules\Storefront\Infrastructure\Models\BuilderVersion;
use App\Modules\Storefront\Presentation\Http\Requests\BannerRules;
use App\Modules\Storefront\Presentation\Http\Requests\CreateBuilderDocumentRequest;
use App\Modules\Storefront\Presentation\Http\Requests\ResolveBuilderElementsRequest;
use App\Modules\Storefront\Presentation\Http\Requests\SaveBuilderDraftRequest;
use App\Modules\Storefront\Presentation\Http\Support\BuilderPresenter;
use App\Modules\Storefront\Presentation\Http\Support\ContentPresenter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

/**
 * Store builder documents (B1): pages with a draft, immutable published versions, discard
 * and restore; B2 adds rename, the editor's canvas context and the canvas resolver for unsaved
 * elements. Reading needs storefront.view, editing (and resolving) storefront.manage,
 * publishing also storefront.publish. B4: CMS page designs, the header, the footer and the
 * shop / product zones are documents too; custom HTML needs storefront.custom_html.
 */
class BuilderDocumentController
{
    /**
     * List builder documents
     *
     * Each with its draft revision, whether the draft differs from the live version, the
     * published version (or null), its `path` on the store (`/`, `/p/<slug>`, B4: `/pages/<slug>`
     * for a CMS page design, null for the header, footer and zones), `cms_page` (`{id, title,
     * slug, status, template}` of a CMS page design, else null) and `preview_url` (the draft on
     * the store's primary domain; null without a domain or path).
     */
    public function index(): JsonResponse
    {
        return ApiResponse::success(BuilderPresenter::summaries(BuilderDocument::query()->builder()->with('publishedVersion')->orderBy('kind')->orderBy('key')->get()));
    }

    /**
     * Create a builder document
     *
     * `kind` + `key`: page — `home` (once), `landing:<slug>` or (B4) `cms:<content page id>`;
     * header — `header`; footer — `footer`; zone — `zone:listing.top`, `zone:listing.bottom`,
     * `zone:product.after`. One per key (409 DOCUMENT_EXISTS). `from`: `blank`, `homepage`
     * (home: the current homepage sections), `cms` (a content page: its title, body and FAQ list
     * or contact form; 422 CMS_PAGE_NOT_FOUND for an unknown page), `current` (header / footer:
     * today's default layout with the store's menus). B8b: popup — `{kind: popup, title,
     * template?}` (no key: the server makes `popup:<uuid>`; blank with the default settings, or a
     * built-in popup template), created switched off.
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
     * Rename a builder document / switch a popup on or off
     *
     * `{title?, active?}` (at least one). `title` (1–160 characters) renames; audited, the draft
     * and the live page are unchanged. B8b: `active` switches a popup on or off (not versioned):
     * needs storefront.publish (403), popups only (422 NOT_A_POPUP), switching on needs a
     * published version (422 POPUP_NOT_PUBLISHED); audited.
     */
    public function rename(Request $request, BuilderDocument $document, ManageBuilderDocuments $documents): JsonResponse
    {
        $data = $request->validate([
            'title' => ['required_without:active', 'string', 'max:160'],
            'active' => ['sometimes', 'boolean'],
        ]);
        if (array_key_exists('active', $data)) {
            Gate::authorize('storefront.publish');
            $document = $documents->setActive($document, (bool) $data['active']);
        }
        if (array_key_exists('title', $data)) {
            $document = $documents->rename($document, $data['title']);
        }

        return ApiResponse::success(BuilderPresenter::document($document->load('publishedVersion')));
    }

    /**
     * Save the draft
     *
     * The whole document with the revision it was edited from: normalized, sanitized and
     * reference-checked (422 DOCUMENT_INVALID with `details.errors[]` {path, node_id, message});
     * a stale revision is 409 DRAFT_CONFLICT with `details.revision`. Not live until published.
     *
     * B4: elements not allowed in the document's kind are 422 (`code: ELEMENT_NOT_ALLOWED`).
     * Adding a custom HTML element or changing its HTML needs storefront.custom_html: 403
     * CUSTOM_HTML_FORBIDDEN with `details.errors[]` {path, node_id, message, code}.
     */
    public function saveDraft(SaveBuilderDraftRequest $request, BuilderDocument $document, ManageBuilderDocuments $documents): JsonResponse
    {
        $saved = $documents->saveDraft(
            $document,
            (int) $request->validated('revision'),
            (array) $request->validated('content'),
            (bool) $request->user()?->can('storefront.custom_html'),
        );

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
     * Delete a builder document
     *
     * With its versions: a landing page, or (B4) a CMS page design, the header, the footer or a
     * zone — the store goes back to the classic rendering. The home page cannot be deleted (422
     * CANNOT_DELETE_HOME).
     */
    public function destroy(BuilderDocument $document, ManageBuilderDocuments $documents): JsonResponse
    {
        $documents->delete($document);

        return ApiResponse::noContent();
    }

    /**
     * Element registry
     *
     * Element types (group, label, translatable props, default props, children; B4: `allowed_in`
     * — the document contexts page | cms | header | footer | zone — and `has_data`), limits and
     * enums for the editor (B4: `enums.icons`, the storefront icon names).
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
     *
     * B4: also the data elements `countdown`, `discount`, `promo_card`, `menu`, `faq_list` and
     * `contact_form` as `{id, type, props, translations}`, validated with the draft-save rules
     * (in any context the type is allowed in; organization-owned promotion / product / menu ids)
     * and resolved to their draft-render `data[id]` (an expired countdown or a discount whose
     * promotion is not running keeps its data with `state`; contact_form has no data). A
     * promoted product that is not on sale online is an error (PRODUCT_UNAVAILABLE).
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

    /**
     * Edit a banner of the page
     *
     * The banner update fields (validated like `PATCH /storefront/banners/{banner}`; `placement`
     * is ignored). Copy-on-write: when only this document's draft shows the banner it is
     * updated in place (`replaced: null`); when a homepage section, another document's draft,
     * any published version (this document's own too) or a saved template uses it, a new banner
     * with the submitted values is created (same placement, the name suffixed with the document
     * title) and `replaced: {old_id, new_id}` tells the editor to swap the id in its draft — the
     * live store doesn't change until that draft is published. Popups: 422
     * BANNER_NOT_EDITABLE_HERE. Audited.
     */
    public function editBanner(Request $request, BuilderDocument $document, Banner $banner, EditBuilderBanner $edit): JsonResponse
    {
        $result = $edit->edit($document, $banner, $request->validate(BannerRules::rules(false)));

        return ApiResponse::success([
            'banner' => ContentPresenter::banner($result['banner']),
            'replaced' => $result['replaced'],
        ]);
    }
}
