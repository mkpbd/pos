<?php

namespace App\Modules\Cms\Presentation\Http\Support;

use App\Modules\Cms\Infrastructure\Models\BlogCategory;
use App\Modules\Cms\Infrastructure\Models\BlogPost;
use App\Modules\Shared\Application\Support\TranslationInput;

/**
 * Admin output shapes of the blog. Public shapes come from BlogPostCards.
 */
final class BlogPresenter
{
    /**
     * @param  array{posts?: int, published?: int}  $counts
     * @return array<string, mixed>
     */
    public static function category(BlogCategory $c, array $counts = []): array
    {
        return [
            'id' => $c->id,
            'name' => $c->name,
            'slug' => $c->slug,
            'description' => $c->description,
            'sort_order' => $c->sort_order,
            'post_count' => $counts['posts'] ?? 0,
            'published_post_count' => $counts['published'] ?? 0,
            // E12b: {bn: {name, description}}.
            'translations' => TranslationInput::present($c->translations),
            'updated_at' => $c->updated_at?->toIso8601String(),
        ];
    }

    /**
     * @param  array<string, array<string, mixed>>  $refs  media refs by id
     * @param  array<string, string>  $names  author names by user id
     * @return array<string, mixed>
     */
    public static function post(BlogPost $p, array $refs, array $names, bool $withBody): array
    {
        $data = [
            'id' => $p->id,
            'slug' => $p->slug,
            'title' => $p->title,
            'excerpt' => $p->excerpt,
            'category_id' => $p->category_id,
            'category' => $p->category === null ? null : ['id' => $p->category->id, 'name' => $p->category->name, 'slug' => $p->category->slug],
            'author' => $p->author_user_id === null ? null : ['id' => $p->author_user_id, 'name' => $names[$p->author_user_id] ?? null],
            'status' => $p->status->value,
            'state' => $p->state(),
            'is_visible' => $p->isVisible(),
            'published_at' => $p->published_at?->toIso8601String(),
            'cover_media_id' => $p->cover_media_id,
            'cover' => $p->cover_media_id === null ? null : ($refs[$p->cover_media_id] ?? null),
            'reading_minutes' => $p->reading_minutes,
            'preview_url' => '/blog/'.$p->slug.'?preview=1',
            'created_at' => $p->created_at?->toIso8601String(),
            'updated_at' => $p->updated_at?->toIso8601String(),
        ];
        if ($withBody) {
            $data += [
                'body_html' => $p->body_html,
                'seo_title' => $p->seo_title,
                'seo_description' => $p->seo_description,
                // E12b: {bn: {title, excerpt, body_html, seo_title, seo_description}}.
                'translations' => TranslationInput::present($p->translations),
            ];
        }

        return $data;
    }
}
