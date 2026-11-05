<?php

namespace App\Modules\Cms\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\ChangesStorefrontContent;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\TracksAuthor;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * @property string $id
 * @property string $organization_id
 * @property string $name
 * @property string $slug
 * @property ?string $description
 * @property int $sort_order
 * @property ?CarbonImmutable $updated_at
 * @property ?array<string, array<string, string>> $translations {"bn": {field: text}} (E12b)
 */
#[Fillable(['organization_id', 'name', 'slug', 'description', 'sort_order', 'translations'])]
class BlogCategory extends Model
{
    use BelongsToOrganization, ChangesStorefrontContent, HasUuids, SoftDeletes, TracksAuthor;

    protected $attributes = ['sort_order' => 0];

    protected function casts(): array
    {
        return [
            'sort_order' => 'integer',
            'updated_at' => 'immutable_datetime',
            'translations' => 'array',
        ];
    }

    /**
     * @return HasMany<BlogPost, $this>
     */
    public function posts(): HasMany
    {
        return $this->hasMany(BlogPost::class, 'category_id');
    }
}
