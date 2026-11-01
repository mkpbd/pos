<?php

namespace App\Modules\Cms\Infrastructure\Models;

use App\Modules\Cms\Domain\BlogPostStatus;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\ChangesStorefrontContent;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\TracksAuthor;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * @property string $id
 * @property string $organization_id
 * @property ?string $category_id
 * @property string $slug
 * @property string $title
 * @property ?string $excerpt
 * @property ?string $body_html
 * @property ?string $cover_media_id
 * @property ?string $author_user_id
 * @property BlogPostStatus $status
 * @property ?CarbonImmutable $published_at
 * @property ?string $seo_title
 * @property ?string $seo_description
 * @property int $reading_minutes
 * @property ?CarbonImmutable $created_at
 * @property ?CarbonImmutable $updated_at
 * @property ?BlogCategory $category
 */
#[Fillable(['organization_id', 'category_id', 'slug', 'title', 'excerpt', 'body_html', 'cover_media_id', 'author_user_id', 'status', 'published_at', 'seo_title', 'seo_description', 'reading_minutes'])]
class BlogPost extends Model
{
    use BelongsToOrganization, ChangesStorefrontContent, HasUuids, SoftDeletes, TracksAuthor;

    protected $attributes = [
        'status' => 'draft',
        'reading_minutes' => 1,
    ];

    protected function casts(): array
    {
        return [
            'status' => BlogPostStatus::class,
            'published_at' => 'immutable_datetime',
            'reading_minutes' => 'integer',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return BelongsTo<BlogCategory, $this>
     */
    public function category(): BelongsTo
    {
        return $this->belongsTo(BlogCategory::class, 'category_id');
    }

    /**
     * Posts visitors can read: published, and the publication time has come.
     *
     * @param  Builder<BlogPost>  $query
     */
    public function scopeVisible(Builder $query): void
    {
        $query->where('status', BlogPostStatus::Published)->whereNotNull('published_at')->where('published_at', '<=', now());
    }

    /**
     * `draft`, `scheduled` or `published` (staff list filter).
     *
     * @param  Builder<BlogPost>  $query
     */
    public function scopeInState(Builder $query, string $state): void
    {
        match ($state) {
            'draft' => $query->where('status', BlogPostStatus::Draft),
            'scheduled' => $query->where('status', BlogPostStatus::Published)->where('published_at', '>', now()),
            default => $query->visible(),
        };
    }

    public function state(): string
    {
        return $this->status->state($this->published_at);
    }

    public function isVisible(): bool
    {
        return $this->state() === 'published';
    }
}
