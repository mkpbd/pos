<?php

namespace App\Modules\Cms\Presentation\Http\Controllers;

use App\Modules\Cms\Application\Actions\SaveBlogPost;
use App\Modules\Cms\Domain\BlogPostStatus;
use App\Modules\Cms\Domain\PageSlug;
use App\Modules\Cms\Infrastructure\Models\BlogPost;
use App\Modules\Cms\Presentation\Http\Support\BlogPresenter;
use App\Modules\Media\Application\Contracts\MediaLibrary;
use App\Modules\Shared\Application\Support\TranslationInput;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Infrastructure\Http\Queries\ListQuery;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Shared\Infrastructure\Validation\TenantUnique;
use App\Modules\Users\Application\Contracts\UserDirectory;
use Closure;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

class BlogPostController
{
    public function __construct(
        private readonly MediaLibrary $media,
        private readonly UserDirectory $users,
        private readonly TenantContext $tenant,
    ) {}

    /**
     * List blog posts
     *
     * `?status=draft|scheduled|published` (derived state), `?category_id=<uuid>|none`,
     * `?search=` (title, slug), `?sort=` (title, published_at, updated_at, created_at; default
     * `-updated_at`), `?page=`, `?per_page=`. Bodies are omitted. `meta.status_counts`:
     * `{all, draft, scheduled, published}` for the search and category without `status`.
     */
    public function index(Request $request): JsonResponse
    {
        $request->validate([
            'status' => ['sometimes', 'nullable', Rule::in(BlogPostStatus::STATES)],
            'category_id' => ['sometimes', 'nullable', function (string $attribute, mixed $value, Closure $fail) {
                if ($value !== 'none' && ! (is_string($value) && Str::isUuid($value))) {
                    $fail('Choose a category or "none".');
                }
            }],
        ]);

        $base = fn () => BlogPost::query()
            ->when($request->query('category_id'), fn (Builder $q, string $id) => $id === 'none' ? $q->whereNull('category_id') : $q->where('category_id', $id))
            ->when(trim((string) $request->query('search', '')) !== '', function (Builder $q) use ($request) {
                $term = '%'.addcslashes(trim((string) $request->query('search')), '%_\\').'%';
                $q->where(fn (Builder $w) => $w->whereLike('title', $term)->orWhereLike('slug', $term));
            });

        $counts = ['all' => $base()->count()];
        foreach (BlogPostStatus::STATES as $state) {
            $counts[$state] = $base()->inState($state)->count();
        }

        $page = ListQuery::paginate(
            BlogPost::query()->with('category')
                ->when($request->query('status'), fn (Builder $q, string $state) => $q->inState($state))
                ->when($request->query('category_id'), fn (Builder $q, string $id) => $id === 'none' ? $q->whereNull('category_id') : $q->where('category_id', $id)),
            $request,
            ['title', 'published_at', 'updated_at', 'created_at'],
            ['title', 'slug'],
            '-updated_at',
        );
        $posts = collect($page->items());
        [$refs, $names] = $this->lookups($posts);

        return ApiResponse::paginated($page, fn (BlogPost $p) => new JsonResource(BlogPresenter::post($p, $refs, $names, false)), ['status_counts' => $counts]);
    }

    /**
     * Blog post
     *
     * The list row plus `body_html`, `seo_title` and `seo_description`.
     */
    public function show(BlogPost $blogPost): JsonResponse
    {
        return ApiResponse::success($this->present($blogPost));
    }

    /**
     * Create a blog post
     *
     * `{title (≤ 160), slug (lower-case letters, digits, hyphens, ≤ 100, unique), category_id?,
     * excerpt? (≤ 300), body_html? (sanitized), cover_media_id?, status? draft|published,
     * published_at? (ISO 8601 with offset; future = scheduled), seo_title? (≤ 70),
     * seo_description? (≤ 160)}`. Publishing without `published_at` publishes now. The author
     * is the signed-in user; `reading_minutes` is computed from the body.
     * `CATEGORY_NOT_FOUND`, `MEDIA_NOT_FOUND`.
     */
    public function store(Request $request, SaveBlogPost $save): JsonResponse
    {
        return ApiResponse::created($this->present($save->save(new BlogPost, $request->validate($this->rules(null)))));
    }

    public function update(Request $request, BlogPost $blogPost, SaveBlogPost $save): JsonResponse
    {
        return ApiResponse::success($this->present($save->save($blogPost, $request->validate($this->rules($blogPost)))));
    }

    /**
     * Delete a blog post
     *
     * `IN_USE` while a menu links to it.
     */
    public function destroy(BlogPost $blogPost, SaveBlogPost $save): JsonResponse
    {
        $save->delete($blogPost);

        return ApiResponse::noContent();
    }

    /**
     * @return array<string, mixed>
     */
    private function present(BlogPost $post): array
    {
        $post->load('category');
        [$refs, $names] = $this->lookups(collect([$post]));

        return BlogPresenter::post($post, $refs, $names, true);
    }

    /**
     * @param  Collection<int, BlogPost>  $posts
     * @return array{array<string, array<string, mixed>>, array<string, string>}
     */
    private function lookups(Collection $posts): array
    {
        $mediaIds = $posts->pluck('cover_media_id')->filter()->unique()->values()->all();
        $userIds = $posts->pluck('author_user_id')->filter()->unique()->values()->all();

        return [
            $this->media->refs($mediaIds),
            $userIds === [] ? [] : $this->users->names($this->tenant->requireOrganization(), $userIds),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    private function rules(?BlogPost $post): array
    {
        $required = $post === null ? 'required' : 'sometimes';

        return [
            // "categories" is the address of the public category list (/store/blog/categories).
            'slug' => [$required, 'string', 'max:'.PageSlug::MAX_LENGTH, 'regex:'.PageSlug::PATTERN, Rule::notIn(['categories']),
                (new TenantUnique('blog_posts', 'slug', $post?->id, softDeletes: true))->withMessage('Another blog post already uses this address.')],
            'title' => [$required, 'string', 'max:160', 'regex:/\S/'],
            'category_id' => ['sometimes', 'nullable', 'uuid'],
            'excerpt' => ['sometimes', 'nullable', 'string', 'max:300'],
            'body_html' => ['sometimes', 'nullable', 'string', 'max:200000'],
            'cover_media_id' => ['sometimes', 'nullable', 'uuid'],
            'status' => ['sometimes', Rule::enum(BlogPostStatus::class)],
            'published_at' => ['sometimes', 'nullable', 'date'],
            'seo_title' => ['sometimes', 'nullable', 'string', 'max:70'],
            'seo_description' => ['sometimes', 'nullable', 'string', 'max:160'],
            // E12b: {bn: {title, excerpt, body_html, seo_title, seo_description}} (partial; blank removes).
            ...TranslationInput::rules(SaveBlogPost::TRANSLATABLE),
        ];
    }
}
