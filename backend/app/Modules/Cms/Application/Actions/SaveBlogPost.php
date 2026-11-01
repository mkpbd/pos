<?php

namespace App\Modules\Cms\Application\Actions;

use App\Modules\Cms\Application\Contracts\BlogReferences;
use App\Modules\Cms\Domain\BlogPostStatus;
use App\Modules\Cms\Domain\ReadingTime;
use App\Modules\Cms\Infrastructure\Models\BlogCategory;
use App\Modules\Cms\Infrastructure\Models\BlogPost;
use App\Modules\Media\Application\Contracts\MediaLibrary;
use App\Modules\Shared\Application\Contracts\AuditTrail;
use App\Modules\Shared\Application\Contracts\HtmlSanitizer;
use App\Modules\Shared\Application\Support\Changes;
use App\Modules\Shared\Application\Support\Instants;
use App\Modules\Shared\Application\Support\StaffActor;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use Illuminate\Contracts\Container\Container;
use Illuminate\Support\Facades\DB;

/**
 * Creates, updates and deletes blog posts. The body is sanitized on every save (ADR-009)
 * and the reading time recomputed from its text; publishing without a date publishes now,
 * a future date schedules the post. The author is the staff user who created the post.
 */
class SaveBlogPost
{
    public function __construct(
        private readonly HtmlSanitizer $sanitizer,
        private readonly MediaLibrary $media,
        private readonly AuditTrail $audit,
        private readonly Container $container,
    ) {}

    /**
     * @param  array<string, mixed>  $attributes  validated
     * @param  string|null  $authorId  the author of a new post (default: the signed-in staff user)
     *
     * @throws BusinessRuleViolation CATEGORY_NOT_FOUND, MEDIA_NOT_FOUND
     */
    public function save(BlogPost $post, array $attributes, ?string $authorId = null): BlogPost
    {
        $attributes = Instants::normalize($attributes, ['published_at']);

        if (isset($attributes['category_id']) && ! BlogCategory::query()->whereKey($attributes['category_id'])->exists()) {
            throw new BusinessRuleViolation('CATEGORY_NOT_FOUND', 'The selected blog category no longer exists.', ['category_id' => $attributes['category_id']]);
        }
        if (isset($attributes['cover_media_id']) && $this->media->existing([$attributes['cover_media_id']]) === []) {
            throw new BusinessRuleViolation('MEDIA_NOT_FOUND', 'The selected cover image no longer exists in the media library.', ['media_ids' => [$attributes['cover_media_id']]]);
        }

        return DB::transaction(function () use ($post, $attributes, $authorId) {
            $creating = ! $post->exists;
            $before = $creating ? [] : $this->snapshot($post);

            if (array_key_exists('body_html', $attributes)) {
                $body = $attributes['body_html'] === null ? '' : $this->sanitizer->clean((string) $attributes['body_html']);
                $attributes['body_html'] = $body === '' ? null : $body;
            }
            if (isset($attributes['slug'])) {
                $attributes['slug'] = mb_strtolower($attributes['slug']);
            }
            foreach (['title', 'excerpt', 'seo_title', 'seo_description'] as $key) {
                if (array_key_exists($key, $attributes) && is_string($attributes[$key])) {
                    $attributes[$key] = trim($attributes[$key]) === '' && $key !== 'title' ? null : trim($attributes[$key]);
                }
            }

            $post->fill($attributes);
            if ($creating) {
                $post->author_user_id = $authorId ?? StaffActor::id();
            }
            if ($post->status === BlogPostStatus::Published && $post->published_at === null) {
                $post->published_at = now()->toImmutable();
            }
            $post->reading_minutes = ReadingTime::minutes($post->body_html);
            $post->save();

            [$old, $new] = Changes::between($before, $this->snapshot($post));
            if ($creating || $new !== []) {
                $this->audit->record($creating ? 'blog_post.created' : 'blog_post.updated', $post, $old, $new);
            }

            return $post;
        });
    }

    /**
     * @throws BusinessRuleViolation IN_USE
     */
    public function delete(BlogPost $post): void
    {
        /** @var iterable<BlogReferences> $references */
        $references = $this->container->tagged(BlogReferences::TAG);
        foreach ($references as $reference) {
            if ($reference->uses(BlogReferences::POST, $post->id)) {
                throw new BusinessRuleViolation('IN_USE', ucfirst($reference->describe()).' still links to this post. Remove the link first.');
            }
        }

        DB::transaction(function () use ($post) {
            $snapshot = $this->snapshot($post);
            // A deleted post lets go of its cover, so the image can leave the media library.
            $post->cover_media_id = null;
            $post->save();
            $post->delete();
            $this->audit->record('blog_post.deleted', $post, $snapshot);
        });
    }

    /**
     * @return array<string, mixed>
     */
    private function snapshot(BlogPost $post): array
    {
        return [
            'slug' => $post->slug,
            'title' => $post->title,
            'category_id' => $post->category_id,
            'excerpt' => $post->excerpt,
            'cover_media_id' => $post->cover_media_id,
            'status' => $post->status->value,
            'published_at' => $post->published_at?->toIso8601String(),
            'seo_title' => $post->seo_title,
            'seo_description' => $post->seo_description,
            // The body itself is too large for the audit log; record that it changed.
            'body_hash' => $post->body_html === null ? null : hash('xxh128', $post->body_html),
        ];
    }
}
