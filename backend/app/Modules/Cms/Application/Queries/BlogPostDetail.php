<?php

namespace App\Modules\Cms\Application\Queries;

use App\Modules\Cms\Infrastructure\Models\BlogPost;
use App\Modules\Shared\Domain\Translations;
use Illuminate\Database\Eloquent\Builder;

/**
 * A blog post as the storefront shows it (GET /store/blog/{slug}): the list row plus
 * `body_html`, `seo_title`, `seo_description`, `prev` / `next` (older / newer readable post),
 * `related` (up to 3 newest readable posts of the same category) and `preview` (+ `state` in a
 * preview). B14: also the store builder's sample post (BlogDirectory::postSample).
 */
class BlogPostDetail
{
    public const RELATED = 3;

    public function __construct(private readonly BlogPostCards $cards) {}

    /**
     * @return array<string, mixed>
     */
    public function detail(BlogPost $post, bool $preview = false): array
    {
        $post->loadMissing('category');
        $related = $post->category_id === null ? collect() : BlogPost::query()->visible()->with('category')
            ->where('category_id', $post->category_id)->whereKeyNot($post->id)
            ->orderByDesc('published_at')->orderByDesc('id')->limit(self::RELATED)->get();

        $data = $this->cards->cards(collect([$post]))[0] + [
            'body_html' => Translations::pick($post, 'body_html', $this->cards->locale()),
            'seo_title' => Translations::pick($post, 'seo_title', $this->cards->locale()),
            'seo_description' => Translations::pick($post, 'seo_description', $this->cards->locale()),
            'prev' => $this->neighbour($post, older: true),
            'next' => $this->neighbour($post, older: false),
            'related' => $this->cards->cards($related),
            'preview' => $preview,
        ];
        if ($preview) {
            $data['state'] = $post->state();
        }

        return $data;
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
            ->first(['slug', 'title', 'translations']);

        return $found === null ? null : ['slug' => $found->slug, 'title' => Translations::pick($found, 'title', $this->cards->locale())];
    }
}
