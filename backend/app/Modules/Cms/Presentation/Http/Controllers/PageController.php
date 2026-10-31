<?php

namespace App\Modules\Cms\Presentation\Http\Controllers;

use App\Modules\Cms\Application\Actions\SavePage;
use App\Modules\Cms\Domain\PageSlug;
use App\Modules\Cms\Domain\PageStatus;
use App\Modules\Cms\Domain\PageTemplate;
use App\Modules\Cms\Infrastructure\Models\CmsPage;
use App\Modules\Cms\Presentation\Http\Support\CmsPresenter;
use App\Modules\Shared\Infrastructure\Http\Queries\ListQuery;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Shared\Infrastructure\Validation\TenantUnique;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Validation\Rule;

class PageController
{
    /**
     * List content pages
     *
     * `?search=` matches title and slug; `?status=draft|published`. Bodies are omitted.
     */
    public function index(Request $request): JsonResponse
    {
        $request->validate(['status' => ['sometimes', Rule::enum(PageStatus::class)]]);

        return ApiResponse::paginated(
            ListQuery::paginate(
                CmsPage::query()->when($request->query('status'), fn (Builder $q, string $status) => $q->where('status', $status)),
                $request,
                ['title', 'slug', 'updated_at', 'created_at'],
                ['title', 'slug'],
                'title',
            ),
            fn (CmsPage $p) => new JsonResource(CmsPresenter::page($p, false)),
        );
    }

    public function show(CmsPage $page): JsonResponse
    {
        return ApiResponse::success(CmsPresenter::page($page, true));
    }

    /**
     * Create a page
     *
     * The body is sanitized (formatting, links, tables and images from the media library only).
     * Publishing without `published_at` publishes immediately; a future date schedules the page.
     */
    public function store(Request $request, SavePage $save): JsonResponse
    {
        return ApiResponse::created(CmsPresenter::page($save->save(new CmsPage, $request->validate($this->rules(null))), true));
    }

    public function update(Request $request, CmsPage $page, SavePage $save): JsonResponse
    {
        return ApiResponse::success(CmsPresenter::page($save->save($page, $request->validate($this->rules($page))), true));
    }

    public function destroy(CmsPage $page, SavePage $save): JsonResponse
    {
        $save->delete($page);

        return ApiResponse::noContent();
    }

    /**
     * @return array<string, mixed>
     */
    private function rules(?CmsPage $page): array
    {
        $required = $page === null ? 'required' : 'sometimes';

        return [
            'slug' => [$required, 'string', 'max:'.PageSlug::MAX_LENGTH, 'regex:'.PageSlug::PATTERN,
                (new TenantUnique('cms_pages', 'slug', $page?->id, softDeletes: true))->withMessage('Another page already uses this address.')],
            'title' => [$required, 'string', 'max:160'],
            'body_html' => ['sometimes', 'nullable', 'string', 'max:200000'],
            'template' => ['sometimes', Rule::enum(PageTemplate::class)],
            'status' => ['sometimes', Rule::enum(PageStatus::class)],
            'published_at' => ['sometimes', 'nullable', 'date'],
            'seo_title' => ['sometimes', 'nullable', 'string', 'max:160'],
            'seo_description' => ['sometimes', 'nullable', 'string', 'max:300'],
        ];
    }
}
