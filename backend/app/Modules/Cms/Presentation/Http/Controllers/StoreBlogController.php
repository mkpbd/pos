<?php

namespace App\Modules\Cms\Presentation\Http\Controllers;

use App\Modules\Cms\Application\Queries\BlogPostCards;
use App\Modules\Cms\Infrastructure\Models\BlogCategory;
use App\Modules\Cms\Infrastructure\Models\BlogPost;
use App\Modules\Shared\Application\Contracts\TenantUser;
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

    public const RELATED = 3;

    public function __construct(private readonly BlogPostCards $cards) {}

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
            'category' => $category === null ? null : ['name' => $category->name, 'slug' => $category->slug, 'description' => $category->description],
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
            ->map(fn (BlogCategory $c) => ['name' => $c->name, 'slug' => $c->slug, 'description' => $c->description, 'post_count' => (int) $counts[$c->id]])
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

        $related = $post->category_id === null ? collect() : BlogPost::query()->visible()->with('category')
            ->where('category_id', $post->category_id)->whereKeyNot($post->id)
            ->orderByDesc('published_at')->orderByDesc('id')->limit(self::RELATED)->get();

        $data = $this->cards->cards(collect([$post]))[0] + [
            'body_html' => $post->body_html,
            'seo_title' => $post->seo_title,
            'seo_description' => $post->seo_description,
            'prev' => $this->neighbour($post, older: true),
            'next' => $this->neighbour($post, older: false),
            'related' => $this->cards->cards($related),
            'preview' => $preview,
        ];
        if ($preview) {
            $data['state'] = $post->state();
        }

        $response = ApiResponse::success($data);

        return $preview ? $response->header('Cache-Control', 'no-store, private') : $response;
    }

    /**
     * The readable post published just before (older) or after (newer) this one.
     *
     * @return array{slug: string, title: string}|null
     */
    private function neighbour(BlogPost $post, bool $older): ?array
    {
        if ($post->published_at === null) {
            return null;
        }
        $at = $post->published_at;
        $found = BlogPost::query()->visible()->whereKeyNot($post->id)
            ->where(fn (Builder $q) => $older
                ? $q->where('published_at', '<', $at)->orWhere(fn (Builder $w) => $w->where('published_at', $at)->where('id', '<', $post->id))
                : $q->where('published_at', '>', $at)->orWhere(fn (Builder $w) => $w->where('published_at', $at)->where('id', '>', $post->id)))
            ->orderBy('published_at', $older ? 'desc' : 'asc')->orderBy('id', $older ? 'desc' : 'asc')
            ->first(['slug', 'title']);

        return $found === null ? null : ['slug' => $found->slug, 'title' => $found->title];
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
