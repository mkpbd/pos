<?php

namespace App\Modules\Storefront\Presentation\Http\Controllers;

use App\Modules\Shared\Infrastructure\Http\Exports\ListExporter;
use App\Modules\Shared\Infrastructure\Http\Exports\RowSource;
use App\Modules\Shared\Infrastructure\Http\Queries\ListQuery;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Storefront\Application\Redirects\ManageStorefrontRedirects;
use App\Modules\Storefront\Application\Redirects\StorefrontRedirects;
use App\Modules\Storefront\Domain\RedirectPaths;
use App\Modules\Storefront\Infrastructure\Models\StorefrontRedirect;
use App\Modules\Storefront\Presentation\Http\Exports\RedirectsExport;
use App\Modules\Storefront\Presentation\Http\Support\RedirectPresenter;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Collection;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpFoundation\Response;

/**
 * B16: the store's redirects (storefront.manage) — old addresses answered with a 301 / 302.
 * Automatic ones are added when a page, post, product, category or brand gets a new address;
 * the merchant adds, edits and deletes their own (audited).
 */
class RedirectController
{
    /**
     * List redirects
     *
     * `?search=` (old or new address), `?source=auto|manual`, paginated (newest first):
     * `[{id, from_path, to_path, type: 301|302, source: auto|manual, hits, last_hit_at, created_at,
     * updated_at}]`. `?export=csv|xlsx|pdf` exports the filtered list.
     */
    public function index(Request $request, ListExporter $exports): Response
    {
        $filters = $request->validate([
            'search' => ['sometimes', 'nullable', 'string', 'max:200'],
            'source' => ['sometimes', 'nullable', Rule::in(StorefrontRedirect::SOURCES)],
        ]);
        $query = StorefrontRedirect::query()
            ->when(($filters['search'] ?? null) !== null && trim((string) $filters['search']) !== '', function (Builder $q) use ($filters) {
                $term = '%'.str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], mb_strtolower(trim((string) $filters['search']))).'%';
                $q->where(fn (Builder $w) => $w->whereRaw('lower(from_path) like ?', [$term])->orWhereRaw('lower(to_path) like ?', [$term]));
            })
            ->when(($filters['source'] ?? null) !== null, fn (Builder $q) => $q->where('source', $filters['source']))
            ->orderByDesc('created_at')->orderBy('id');

        if ($format = ListExporter::requested($request)) {
            return $exports->download($request, $format, RedirectsExport::class,
                RowSource::fromQuery($query, fn (Collection $rows) => $rows->map(fn (StorefrontRedirect $r) => RedirectPresenter::redirect($r))));
        }

        return ApiResponse::paginated($query->paginate(ListQuery::perPage($request)), fn (StorefrontRedirect $r) => new JsonResource(RedirectPresenter::redirect($r)));
    }

    /**
     * Add a redirect
     *
     * `{from_path, to_path, type?: 301|302}` → the redirect (201). `from_path`: an address of the
     * store (a full URL loses its host; stored lower case without query or trailing slash);
     * `to_path`: a store path or an http(s) URL. 422 VALIDATION_FAILED: from_path (invalid,
     * reserved store page, live page, already redirected), to_path (invalid, loop). A target that
     * is redirected itself is stored as the end of that chain.
     */
    public function store(Request $request, ManageStorefrontRedirects $redirects): JsonResponse
    {
        $data = $request->validate([
            'from_path' => ['required', 'string', 'max:2000'],
            'to_path' => ['required', 'string', 'max:2000'],
            'type' => ['sometimes', 'integer', Rule::in(StorefrontRedirect::TYPES)],
        ]);

        return ApiResponse::created(RedirectPresenter::redirect($redirects->save(new StorefrontRedirect, $data)));
    }

    /**
     * Change a redirect
     *
     * Any of `{from_path, to_path, type}` (the rules of adding one). An automatic redirect becomes
     * the merchant's own (`source: manual`).
     */
    public function update(Request $request, StorefrontRedirect $redirect, ManageStorefrontRedirects $redirects): JsonResponse
    {
        $data = $request->validate([
            'from_path' => ['sometimes', 'string', 'max:2000'],
            'to_path' => ['sometimes', 'string', 'max:2000'],
            'type' => ['sometimes', 'integer', Rule::in(StorefrontRedirect::TYPES)],
        ]);

        return ApiResponse::success(RedirectPresenter::redirect($redirects->save($redirect, $data)));
    }

    /**
     * Delete a redirect
     */
    public function destroy(StorefrontRedirect $redirect, ManageStorefrontRedirects $redirects): JsonResponse
    {
        $redirects->delete($redirect);

        return ApiResponse::noContent();
    }

    /**
     * Test an address
     *
     * `?path=` → `{path (normalized), redirect: the redirect | null, final_path: where visitors end
     * up | null, live: bool}`. A live page is never redirected (`live` true: the redirect, if
     * any, does not apply). Nothing is counted.
     */
    public function test(Request $request, StorefrontRedirects $redirects): JsonResponse
    {
        $data = $request->validate(['path' => ['required', 'string', 'max:2000']]);
        $path = RedirectPaths::from((string) $data['path']);
        if ($path === null) {
            throw ValidationException::withMessages(['path' => ['Enter an address of your store, such as /old-page.']]);
        }
        $redirect = $redirects->find($path);
        $live = $redirects->live($path);

        return ApiResponse::success([
            'path' => $path,
            'redirect' => $redirect === null ? null : RedirectPresenter::redirect($redirect),
            'final_path' => $redirect === null || $live ? null : $redirect->to_path,
            'live' => $live,
        ]);
    }
}
