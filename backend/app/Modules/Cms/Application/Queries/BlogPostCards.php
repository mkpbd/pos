<?php

namespace App\Modules\Cms\Application\Queries;

use App\Modules\Cms\Infrastructure\Models\BlogPost;
use App\Modules\Media\Application\Contracts\MediaLibrary;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Users\Application\Contracts\UserDirectory;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;
use Illuminate\Support\Collection;

/**
 * Public rows of blog posts (the blog index, category pages, related posts and the homepage
 * teaser): `{slug, title, excerpt, cover, category: {name, slug} | null, author (first
 * name), published_at, reading_minutes}`. Expects `category` loaded or loads it.
 */
class BlogPostCards
{
    public function __construct(
        private readonly MediaLibrary $media,
        private readonly UserDirectory $users,
        private readonly TenantContext $tenant,
    ) {}

    /**
     * @param  Collection<int, BlogPost>  $posts
     * @return list<array<string, mixed>>
     */
    public function cards(Collection $posts): array
    {
        if ($posts->isEmpty()) {
            return [];
        }
        $posts = (new EloquentCollection($posts->all()))->loadMissing('category');
        $refs = $this->media->refs($posts->pluck('cover_media_id')->filter()->unique()->values()->all());
        $names = $this->authorNames($posts);

        return $posts->map(fn (BlogPost $p) => $this->card($p, $refs, $names))->values()->all();
    }

    /**
     * @param  Collection<int, BlogPost>  $posts
     * @return array<string, string> author first names by user id
     */
    public function authorNames(Collection $posts): array
    {
        $ids = $posts->pluck('author_user_id')->filter()->unique()->values()->all();
        if ($ids === []) {
            return [];
        }

        return array_map(fn (string $name) => self::firstName($name), $this->users->names($this->tenant->requireOrganization(), $ids));
    }

    /**
     * @param  array<string, array<string, mixed>>  $refs  media refs by id
     * @param  array<string, string>  $names  author first names by id
     * @return array<string, mixed>
     */
    public function card(BlogPost $p, array $refs, array $names): array
    {
        return [
            'slug' => $p->slug,
            'title' => $p->title,
            'excerpt' => $p->excerpt,
            'cover' => $p->cover_media_id === null ? null : ($refs[$p->cover_media_id] ?? null),
            'category' => $p->category === null ? null : ['name' => $p->category->name, 'slug' => $p->category->slug],
            'author' => $p->author_user_id === null ? null : ($names[$p->author_user_id] ?? null),
            'published_at' => $p->published_at?->toIso8601String(),
            'reading_minutes' => $p->reading_minutes,
        ];
    }

    public static function firstName(string $name): string
    {
        $parts = preg_split('/\s+/u', trim($name), 2, PREG_SPLIT_NO_EMPTY) ?: [];

        return $parts[0] ?? $name;
    }
}
