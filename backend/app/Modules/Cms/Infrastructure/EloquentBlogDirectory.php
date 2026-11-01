<?php

namespace App\Modules\Cms\Infrastructure;

use App\Modules\Cms\Application\Contracts\BlogDirectory;
use App\Modules\Cms\Application\Contracts\BlogReferences;
use App\Modules\Cms\Application\Queries\BlogPostCards;
use App\Modules\Cms\Infrastructure\Models\BlogCategory;
use App\Modules\Cms\Infrastructure\Models\BlogPost;
use App\Modules\Media\Application\Contracts\MediaLibrary;
use InvalidArgumentException;

class EloquentBlogDirectory implements BlogDirectory
{
    public function __construct(
        private readonly BlogPostCards $cards,
        private readonly MediaLibrary $media,
    ) {}

    public function existing(string $type, array $ids): array
    {
        if ($ids === []) {
            return [];
        }
        $query = match ($type) {
            BlogReferences::CATEGORY => BlogCategory::query(),
            BlogReferences::POST => BlogPost::query(),
            default => throw new InvalidArgumentException("Unknown blog record type [{$type}]."),
        };

        return $query->whereIn('id', array_values(array_unique($ids)))->pluck('id')->all();
    }

    public function categories(array $ids): array
    {
        if ($ids === []) {
            return [];
        }

        return BlogCategory::query()->whereIn('id', array_values(array_unique($ids)))->get(['id', 'slug', 'name'])
            ->mapWithKeys(fn (BlogCategory $c) => [$c->id => ['id' => $c->id, 'slug' => $c->slug, 'name' => $c->name]])
            ->all();
    }

    public function visiblePosts(array $ids): array
    {
        if ($ids === []) {
            return [];
        }

        return BlogPost::query()->visible()->whereIn('id', array_values(array_unique($ids)))->get(['id', 'slug', 'title'])
            ->mapWithKeys(fn (BlogPost $p) => [$p->id => ['id' => $p->id, 'slug' => $p->slug, 'title' => $p->title]])
            ->all();
    }

    public function linkTargets(): array
    {
        return [
            'blog_categories' => BlogCategory::query()->orderBy('sort_order')->orderBy('name')->get(['id', 'name', 'slug'])
                ->map(fn (BlogCategory $c) => ['id' => $c->id, 'name' => $c->name, 'slug' => $c->slug])->all(),
            'blog_posts' => BlogPost::query()->orderBy('title')->get(['id', 'slug', 'title', 'status', 'published_at'])
                ->map(fn (BlogPost $p) => [
                    'id' => $p->id,
                    'slug' => $p->slug,
                    'title' => $p->title,
                    'status' => $p->status->value,
                    'state' => $p->state(),
                    'is_visible' => $p->isVisible(),
                ])->all(),
        ];
    }

    public function postCards(?string $categoryId, int $limit): array
    {
        return $this->cards->cards(BlogPost::query()->visible()->with('category')
            ->when($categoryId !== null, fn ($q) => $q->where('category_id', $categoryId))
            ->orderByDesc('published_at')->orderByDesc('id')
            ->limit(max(1, $limit))->get());
    }

    public function categoryMeta(string $slug): ?array
    {
        $category = BlogCategory::query()->whereRaw('lower(slug) = ?', [mb_strtolower($slug)])->first();

        return $category === null ? null : ['name' => $category->name, 'slug' => $category->slug, 'description' => $category->description];
    }

    public function postMeta(string $slug, bool $includeUnpublished = false): ?array
    {
        $post = BlogPost::query()->when(! $includeUnpublished, fn ($q) => $q->visible())
            ->whereRaw('lower(slug) = ?', [mb_strtolower($slug)])->first();
        if ($post === null) {
            return null;
        }
        $cover = $post->cover_media_id === null ? null : ($this->media->refs([$post->cover_media_id])[$post->cover_media_id] ?? null);

        return [
            'title' => $post->title,
            'seo_title' => $post->seo_title,
            'description' => $post->seo_description ?? $post->excerpt,
            'image_url' => $cover['url'] ?? null,
            'published_at' => $post->published_at?->toIso8601String(),
        ];
    }
}
