<?php

namespace App\Modules\Cms\Presentation\Http\Controllers;

use App\Modules\Cms\Application\Queries\BlogPostCards;
use App\Modules\Cms\Application\Queries\BlogPostDetail;
use App\Modules\Cms\Infrastructure\Models\BlogCategory;
use App\Modules\Cms\Infrastructure\Models\BlogPost;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Domain\Translations;
use App\Modules\Shared\Infrastructure\Http\Responses\ApiResponse;
use App\Modules\Storefront\Presentation\Http\Middleware\ResolveStorefront;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The public blog of the storefront (organization from the host name).
 */
class StoreBlogController
{
    public const PER_PAGE = 9;

    public const RELATED = BlogPostDetail::RELATED;

    public function __construct(private readonly BlogPostCards $cards, private readonly BlogPostDetail $detail) {}

    /**
     * Blog posts
     *
     * Readable posts (published, publication time reached), newest first, 9 per page:
     * `[{slug, title, excerpt, cover, category: {name, slug} | null, author (first name),
     * published_at, reading_minutes}]`. `?category=<slug>` limits them to one category
     * (`meta.category` `{name, slug, description}`; 404 `NOT_FOUND` for unknown slugs).
     */
    public function index(Request $request): JsonResponse
    {
        $request->validate([
            'category' => ['sometimes', 'nullable', 'string', 'max:100'],
            'page' => ['sometimes', 'integer', 'min:1'],
        ]);

        $category = null;
        if ($request->filled('category')) {
            $category = BlogCategory::query()->whereRaw('lower(slug) = ?', [mb_strtolower((string) $request->query('category'))])->first();
            if ($category === null) {
                return ApiResponse::error('NOT_FOUND', 'This blog category does not exist.', 404);
            }
        }

        $page = BlogPost::query()->visible()->with('category')
            ->when($category !== null, fn (Builder $q) => $q->where('category_id', $category->id))
            ->orderByDesc('published_at')->orderByDesc('id')
            ->paginate(self::PER_PAGE);
        $items = collect($page->items());
        $cards = $items->isEmpty() ? [] : array_combine($items->pluck('id')->all(), $this->cards->cards($items));

        return ApiResponse::paginated($page, fn (BlogPost $p) => new JsonResource($cards[$p->id]), [
            'category' => $category === null ? null : ['slug' => $category->slug] + Translations::pickMany($category, ['name', 'description'], $this->cards->locale()),
        ]);
    }

    /**
     * Blog categories
     *
     * Categories with at least one readable post, in display order:
     * `[{name, slug, description, post_count}]`.
     */
    public function categories(): JsonResponse
    {
        $counts = BlogPost::query()->visible()->whereNotNull('category_id')->groupBy('category_id')
            ->selectRaw('category_id, COUNT(*) as aggregate')->pluck('aggregate', 'category_id');

        return ApiResponse::success(BlogCategory::query()->whereIn('id', $counts->keys()->all())->orderBy('sort_order')->orderBy('name')->get()
            ->map(fn (BlogCategory $c) => [
                'name' => Translations::pick($c, 'name', $this->cards->locale()),
                'slug' => $c->slug,
                'description' => Translations::pick($c, 'description', $this->cards->locale()),
                'post_count' => (int) $counts[$c->id],
            ])
            ->values()->all());
    }

    /**
     * Blog post
     *
     * A readable post by slug: the list row plus `body_html` (sanitized), `seo_title`,
     * `seo_description`, `prev` / `next` (`{slug, title}` of the older / newer post, or null),
     * `related` (up to 3 newest posts of the same category) and `preview`. Drafts, scheduled
     * and deleted posts are 404 — except with `?preview=1` for a signed-in staff member of
     * this store holding `cms.manage` (then `state` tells draft | scheduled | published).
     */
    public function show(Request $request, string $slug): JsonResponse
    {
        $preview = $request->boolean('preview') && $this->isStaff($request);
        $post = BlogPost::query()->with('category')
            ->when(! $preview, fn (Builder $q) => $q->visible())
            ->whereRaw('lower(slug) = ?', [mb_strtolower($slug)])
            ->first();
        if ($post === null) {
            return ApiResponse::error('NOT_FOUND', 'This blog post does not exist.', 404);
        }

        $response = ApiResponse::success($this->detail->detail($post, $preview));

        return $preview ? $response->header('Cache-Control', 'no-store, private') : $response;
    }

    private function isStaff(Request $request): bool
    {
        $user = $request->user();

        return $user instanceof TenantUser
            && $user->isActive()
            && $user->organizationId() === $request->attributes->get(ResolveStorefront::ATTRIBUTE)['organization_id']
            && $user->can('cms.manage');
    }
}
