<?php

namespace App\Modules\Storefront\Presentation\Http\Controllers;

use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Storefront\Application\Builder\Portability\ChangeLandingAddress;
use App\Modules\Storefront\Application\Builder\Portability\ExportBuilderDocument;
use App\Modules\Storefront\Application\Builder\Portability\ImportBuilderDocument;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;
use App\Modules\Storefront\Presentation\Http\Support\BuilderPresenter;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * B16: builder pages as files (download a copy, import into this store) and a landing page's
 * new address (storefront.manage).
 */
class BuilderPortabilityController
{
    /**
     * Download a page as a file
     *
     * The draft as a `pos-builder-page` file (version 1; the JSON body itself, not the API
     * envelope) with `Content-Disposition: attachment; filename="<address or title>.json"`:
     * `{format, version, exported_at, source: {store}, document: {kind, key_kind, key, title,
     * context, schema_version, content}, media: [{ref, name, alt, mime, width, height, sha256,
     * data}], references: {products, categories, brands, banners, menus, blog_categories,
     * promotions}}` — ids replaced by `@ref:<type>:<n>`, global sections inlined, campaign rules
     * left out. 422 EXPORT_TOO_LARGE above 25 MB of pictures; 422 EXPORT_NOT_SUPPORTED for the
     * theme.
     */
    public function export(BuilderDocument $document, ExportBuilderDocument $export): JsonResponse
    {
        ['filename' => $filename, 'body' => $body] = $export($document);

        return response()->json($body, 200, [
            'Content-Disposition' => 'attachment; filename="'.$filename.'"',
            'Cache-Control' => 'no-store, private',
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    /**
     * Import a page file
     *
     * Multipart: `file` (≤ 30 MB), `target` new | replace. new: `title`, `key`
     * (`landing:<slug>`) — a new campaign page (201). replace: `document_id`, `revision` — the
     * draft of that document (same kind) is replaced (200). Never published. →
     * `{created_document: summary, mapped: {media, products, categories, brands, banners, menus,
     * blog_categories, promotions}, missing: [{type, name}], dropped_elements: [{type, count}]}`.
     * 422 IMPORT_INVALID (`details.reason`), IMPORT_TOO_LARGE, IMPORT_KIND_MISMATCH; 409
     * DOCUMENT_EXISTS / DRAFT_CONFLICT; 423 DOCUMENT_LOCKED.
     */
    public function import(Request $request, ImportBuilderDocument $import): JsonResponse
    {
        $data = $request->validate([
            'file' => ['required', 'file'],
            'target' => ['required', Rule::in(['new', 'replace'])],
            'title' => ['required_if:target,new', 'nullable', 'string', 'max:160'],
            'key' => ['required_if:target,new', 'nullable', 'string', 'regex:/^landing:[a-z0-9-]{2,60}$/', Rule::notIn(['landing:home'])],
            'document_id' => ['required_if:target,replace', 'nullable', 'uuid'],
            'revision' => ['required_if:target,replace', 'nullable', 'integer', 'min:0'],
        ], [
            'key.regex' => 'The address is "landing:" followed by 2–60 lower-case letters, digits and dashes.',
            'key.not_in' => 'The address "home" is reserved for the home page.',
        ]);
        $result = $import($request->file('file'), $data, (bool) $request->user()?->can('storefront.custom_html'));

        $body = [
            'created_document' => BuilderPresenter::summary($result['document']->load('publishedVersion')),
            'mapped' => $result['mapped'],
            'missing' => $result['missing'],
            'dropped_elements' => $result['dropped_elements'],
        ];

        return $result['created'] ? ApiResponse::created($body) : ApiResponse::success($body);
    }

    /**
     * Change a landing page's address
     *
     * `{slug}` (2–60 lower-case letters, digits and dashes; not `home`) → the document summary.
     * A published page gets an automatic 301 from its old address. 422 NOT_A_LANDING_PAGE, 409
     * DOCUMENT_EXISTS, 423 DOCUMENT_LOCKED.
     */
    public function changeAddress(Request $request, BuilderDocument $document, ChangeLandingAddress $change): JsonResponse
    {
        $data = $request->validate([
            'slug' => ['required', 'string', 'regex:/^[a-z0-9-]{2,60}$/', Rule::notIn(['home'])],
        ], [
            'slug.regex' => 'Use 2–60 lower-case letters, digits and dashes.',
            'slug.not_in' => 'The address "home" is reserved for the home page.',
        ]);

        return ApiResponse::success(BuilderPresenter::summary($change($document, $data['slug'])->load('publishedVersion')));
    }
}
