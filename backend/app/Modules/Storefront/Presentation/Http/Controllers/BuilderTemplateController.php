<?php

namespace App\Modules\Storefront\Presentation\Http\Controllers;

use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Storefront\Application\Builder\ManageThemeDraft;
use App\Modules\Storefront\Application\Builder\PublishBuilderDrafts;
use App\Modules\Storefront\Application\Builder\Templates\ManageBuilderTemplates;
use App\Modules\Storefront\Application\Builder\Templates\StartFromDemo;
use App\Modules\Storefront\Domain\Builder\ElementRegistry;
use App\Modules\Storefront\Domain\ThemePresets;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;
use App\Modules\Storefront\Infrastructure\Models\BuilderTemplate;
use App\Modules\Storefront\Presentation\Http\Requests\SaveBuilderTemplateRequest;
use App\Modules\Storefront\Presentation\Http\Support\BuilderPresenter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * B5: store builder templates (built-in section / page / site templates and the organization's
 * own saved sections), "start from a demo look" and "publish all". Reading needs
 * storefront.view, applying / saving / deleting templates and starting from a demo
 * storefront.manage, publishing all also storefront.publish.
 */
class BuilderTemplateController
{
    /**
     * List templates
     *
     * The built-in templates then the organization's own (another organization's are never
     * listed), without content: `[{id, scope: section|page|site, preset: default|vegan|handmade|classic|kids|null,
     * category, name, description, thumbnail_url|null, preview_url|null (B7: a tall full-page image
     * of a site template), allowed_in: context[], requires: (banners | menus | promotions | blog |
     * products)[], source: builtin|mine, created_at|null}]`. The site templates come in the order the
     * demo looks are shown (kids, the original look, vegan, handmade, classic). Filters: `scope`,
     * `preset` (a preset key, or `none` for templates of no preset), `context` (page | cms |
     * header | footer | zone | popup — only templates usable there), `source` (builtin | mine).
     * B8b: scope `popup` — popup and bar templates (allowed_in `[popup]`), applied as a new popup
     * document (`POST /documents {kind: popup, title, template}`).
     */
    public function index(Request $request, ManageBuilderTemplates $templates): JsonResponse
    {
        $filters = $request->validate([
            'scope' => ['sometimes', 'nullable', Rule::in(['section', 'page', 'site', 'popup'])],
            'preset' => ['sometimes', 'nullable', Rule::in([...ThemePresets::KEYS, 'none'])],
            'context' => ['sometimes', 'nullable', Rule::in(ElementRegistry::CONTEXTS)],
            'source' => ['sometimes', 'nullable', Rule::in(['builtin', 'mine'])],
        ]);

        return ApiResponse::success($templates->list($filters));
    }

    /**
     * Apply a template
     *
     * `{context}` (page | cms | header | footer | zone) → `{template: {id, name, scope, source},
     * context, nodes: Section[], imported: {media, banners, banners_reused}}`: the template's
     * sections for the organization, with fresh node ids and valid in `context`, for the editor to
     * insert into its **draft** (nothing is saved into a document here). A built-in template's
     * photos are imported into the media library once (reused on later applies; `imported.media`
     * counts the new ones), its banners are created (or an identical one reused) and its menus are
     * the store's menus at those locations (left out when there is none). A site template returns
     * its part for the context (page → home, header, footer, zone → listing top). 404 for an
     * unknown or another organization's template, 422 TEMPLATE_NOT_ALLOWED for a context the
     * template is not made for, 422 DOCUMENT_INVALID when an own template refers to deleted
     * records. Audited (`storefront.builder_template_used`). B8b: `popup` — a popup template's
     * settings (null for other templates).
     */
    public function instantiate(Request $request, string $template, ManageBuilderTemplates $templates): JsonResponse
    {
        $context = $request->validate(['context' => ['required', Rule::in(ElementRegistry::CONTEXTS)]])['context'];

        return ApiResponse::success($templates->instantiate($template, $context));
    }

    /**
     * Save a section as a template
     *
     * `{name (≤ 120), description? (≤ 300), scope: "section", context, section: Section}`: the
     * section is validated in `context` like a draft (422 DOCUMENT_INVALID); its references stay
     * the organization's own media and banners. At most 100 templates per organization (422
     * TEMPLATE_LIMIT_REACHED), 256 KB each (422 TEMPLATE_TOO_LARGE). Returns the listed shape
     * (`source: mine`, `allowed_in` = every context the section is valid in).
     */
    public function store(SaveBuilderTemplateRequest $request, ManageBuilderTemplates $templates): JsonResponse
    {
        return ApiResponse::created($templates->summary($templates->save($request->validated())));
    }

    /**
     * Delete an own template
     *
     * Built-in templates and other organizations' templates: 404.
     */
    public function destroy(BuilderTemplate $template, ManageBuilderTemplates $templates): JsonResponse
    {
        $templates->delete($template);

        return ApiResponse::noContent();
    }

    /**
     * Start from a demo look
     *
     * `{include?: {theme, home, header, footer, listing_top}}` (each true by default) applies the
     * preset's site template (default — B7: the original look —, vegan, handmade, classic, kids) to
     * **drafts only**: the theme draft gets
     * the preset (logo, palette and content kept), and the home page, header, footer and the
     * listing-top zone get the template's design as their draft — created, or the existing draft
     * replaced (published versions untouched; open editors get 409 DRAFT_CONFLICT). Photos are
     * imported, banners created, menus resolved as when applying a template. Nothing goes live
     * until published. Returns `{preset, documents: [document summary], theme: {draft_revision,
     * has_unpublished_changes, preset, published, preview_url}|null, imported: {media, banners,
     * banners_reused}}`. Needs storefront.manage, not storefront.publish.
     */
    public function startFromDemo(Request $request, string $preset, StartFromDemo $start, ManageThemeDraft $theme): JsonResponse
    {
        $include = $request->validate([
            'include' => ['sometimes', 'array:theme,home,header,footer,listing_top'],
            'include.*' => ['boolean'],
        ])['include'] ?? [];
        $result = $start($preset, array_map(fn ($v) => (bool) $v, $include));

        return ApiResponse::success([
            'preset' => $preset,
            'documents' => BuilderPresenter::summaries(collect($result['documents'])->map(fn (BuilderDocument $d) => $d->load('publishedVersion'))),
            'theme' => $result['theme'] ? BuilderPresenter::themeSummary($theme->state()) : null,
            'imported' => $result['imported'],
        ]);
    }

    /**
     * Publish several drafts at once
     *
     * `{documents: uuid[] (≤ 50), theme?: bool, note?}`: publishes the listed builder documents'
     * drafts and (with `theme`) the theme draft in one transaction — each gets a new version, as
     * with its own publish; all or nothing (`DOCUMENT_EMPTY` for an empty page). Unknown or
     * another organization's documents: 422 DOCUMENTS_NOT_FOUND. Nothing chosen: 422
     * NOTHING_TO_PUBLISH. Returns `{documents: [document summary], theme: {…}|null}`. Audited.
     */
    public function publishAll(Request $request, PublishBuilderDrafts $publish, ManageThemeDraft $theme): JsonResponse
    {
        $data = $request->validate([
            'documents' => ['present', 'array', 'max:'.PublishBuilderDrafts::MAX_DOCUMENTS],
            'documents.*' => ['uuid', 'distinct'],
            'theme' => ['sometimes', 'boolean'],
            'note' => ['sometimes', 'nullable', 'string', 'max:160'],
        ]);
        $result = $publish($data['documents'], (bool) ($data['theme'] ?? false), $data['note'] ?? null);

        return ApiResponse::success([
            'documents' => BuilderPresenter::summaries(collect($result['documents'])->map(fn (BuilderDocument $d) => $d->load('publishedVersion'))),
            'theme' => $result['theme'] === null ? null : BuilderPresenter::themeSummary($theme->state()),
        ]);
    }
}
