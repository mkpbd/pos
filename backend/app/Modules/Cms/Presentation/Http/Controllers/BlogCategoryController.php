<?php

namespace App\Modules\Cms\Presentation\Http\Controllers;

use App\Modules\Cms\Application\Actions\ManageBlogCategories;
use App\Modules\Cms\Domain\PageSlug;
use App\Modules\Cms\Infrastructure\Models\BlogCategory;
use App\Modules\Cms\Infrastructure\Models\BlogPost;
use App\Modules\Cms\Presentation\Http\Support\BlogPresenter;
use App\Modules\Shared\Application\Support\TranslationInput;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Shared\Infrastructure\Validation\TenantUnique;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

class BlogCategoryController
{
    /**
     * List blog categories
     *
     * Every category in display order with `post_count` (posts that are not deleted) and
     * `published_post_count` (posts readable now).
     */
    public function index(): JsonResponse
    {
        $categories = BlogCategory::query()->orderBy('sort_order')->orderBy('name')->get();
        $counts = $this->counts();

        return ApiResponse::success($categories->map(fn (BlogCategory $c) => BlogPresenter::category($c, $counts[$c->id] ?? []))->all());
    }

    /**
     * Create a blog category
     *
     * `{name (≤ 80), slug? (lower-case letters, digits and hyphens, ≤ 100; from the name when
     * left out), description? (≤ 300), sort_order?}`. New categories go last.
     */
    public function store(Request $request, ManageBlogCategories $categories): JsonResponse
    {
        if (! $request->filled('slug') && is_string($request->input('name'))) {
            $request->merge(['slug' => Str::limit(Str::slug($request->input('name')), PageSlug::MAX_LENGTH, '')]);
        }
        $category = $categories->save(new BlogCategory, $request->validate($this->rules(null)));

        return ApiResponse::created(BlogPresenter::category($category, $this->counts()[$category->id] ?? []));
    }

    public function update(Request $request, BlogCategory $blogCategory, ManageBlogCategories $categories): JsonResponse
    {
        $category = $categories->save($blogCategory, $request->validate($this->rules($blogCategory)));

        return ApiResponse::success(BlogPresenter::category($category, $this->counts()[$category->id] ?? []));
    }

    /**
     * Reorder blog categories
     *
     * `{ids}`: every category id exactly once, in the new order (`ORDER_MISMATCH` otherwise).
     */
    public function reorder(Request $request, ManageBlogCategories $categories): JsonResponse
    {
        $data = $request->validate([
            'ids' => ['present', 'array', 'max:'.ManageBlogCategories::MAX_CATEGORIES],
            'ids.*' => ['uuid', 'distinct'],
        ]);
        $categories->reorder($data['ids']);

        return $this->index();
    }

    /**
     * Delete a blog category
     *
     * Its posts become uncategorised. `IN_USE` while a menu or a homepage section links to it.
     */
    public function destroy(BlogCategory $blogCategory, ManageBlogCategories $categories): JsonResponse
    {
        $categories->delete($blogCategory);

        return ApiResponse::noContent();
    }

    /**
     * @return array<string, mixed>
     */
    private function rules(?BlogCategory $category): array
    {
        $required = $category === null ? 'required' : 'sometimes';

        return [
            'name' => [$required, 'string', 'max:80', 'regex:/\S/'],
            'slug' => [$required, 'string', 'max:'.PageSlug::MAX_LENGTH, 'regex:'.PageSlug::PATTERN,
                (new TenantUnique('blog_categories', 'slug', $category?->id, softDeletes: true))->withMessage('Another blog category already uses this address.')],
            'description' => ['sometimes', 'nullable', 'string', 'max:300'],
            'sort_order' => ['sometimes', 'integer', 'between:0,32767'],
            // E12b: {bn: {name, description}} (partial; blank removes).
            ...TranslationInput::rules(ManageBlogCategories::TRANSLATABLE),
        ];
    }

    /**
     * @return array<string, array{posts: int, published: int}>
     */
    private function counts(): array
    {
        $all = BlogPost::query()->whereNotNull('category_id')->groupBy('category_id')->selectRaw('category_id, COUNT(*) as aggregate')->pluck('aggregate', 'category_id');
        $published = BlogPost::query()->visible()->whereNotNull('category_id')->groupBy('category_id')->selectRaw('category_id, COUNT(*) as aggregate')->pluck('aggregate', 'category_id');

        $counts = [];
        foreach ($all as $id => $count) {
            $counts[$id] = ['posts' => (int) $count, 'published' => (int) ($published[$id] ?? 0)];
        }

        return $counts;
    }
}
