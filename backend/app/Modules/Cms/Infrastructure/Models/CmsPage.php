<?php

namespace App\Modules\Cms\Infrastructure\Models;

use App\Modules\Cms\Domain\PageStatus;
use App\Modules\Cms\Domain\PageTemplate;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\ChangesStorefrontContent;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\TracksAuthor;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * @property string $id
 * @property string $organization_id
 * @property string $slug
 * @property string $title
 * @property ?string $body_html
 * @property PageTemplate $template
 * @property PageStatus $status
 * @property ?CarbonImmutable $published_at
 * @property ?string $seo_title
 * @property ?string $seo_description
 * @property ?CarbonImmutable $updated_at
 */
#[Fillable(['organization_id', 'slug', 'title', 'body_html', 'template', 'status', 'published_at', 'seo_title', 'seo_description'])]
class CmsPage extends Model
{
    use BelongsToOrganization, ChangesStorefrontContent, HasUuids, SoftDeletes, TracksAuthor;

    protected $attributes = [
        'template' => 'default',
        'status' => 'draft',
    ];

    protected function casts(): array
    {
        return [
            'template' => PageTemplate::class,
            'status' => PageStatus::class,
            'published_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }

    /**
     * Pages visitors can open: published, and the publication time (if any) has come.
     *
     * @param  Builder<CmsPage>  $query
     */
    public function scopeVisible(Builder $query): void
    {
        $query->where('status', PageStatus::Published)
            ->where(fn (Builder $q) => $q->whereNull('published_at')->orWhere('published_at', '<=', now()));
    }

    public function isVisible(): bool
    {
        return $this->status === PageStatus::Published && ($this->published_at === null || $this->published_at->lte(now()));
    }
}
