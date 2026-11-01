<?php

namespace App\Modules\OnlineCatalog\Infrastructure\Models;

use App\Modules\OnlineCatalog\Domain\ListingState;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\ChangesStorefrontContent;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\TracksAuthor;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * @property string $id
 * @property string $organization_id
 * @property string $product_id
 * @property string $slug
 * @property bool $is_published
 * @property ?CarbonImmutable $published_at
 * @property ?CarbonImmutable $unpublished_at
 * @property bool $is_featured
 * @property ?CarbonImmutable $is_new_until
 * @property ?string $short_description
 * @property ?string $description_html
 * @property list<array{label: string, value: string}> $specifications
 * @property ?string $seo_title
 * @property ?string $seo_description
 * @property int $sort_weight
 * @property ?CarbonImmutable $created_at
 */
#[Fillable([
    'organization_id', 'product_id', 'slug', 'is_published', 'published_at', 'unpublished_at', 'is_featured',
    'is_new_until', 'short_description', 'description_html', 'specifications', 'seo_title', 'seo_description', 'sort_weight',
])]
class ProductListing extends Model
{
    use BelongsToOrganization, ChangesStorefrontContent, HasUuids, TracksAuthor;

    protected $attributes = [
        'is_published' => false,
        'is_featured' => false,
        'specifications' => '[]',
        'sort_weight' => 0,
    ];

    protected function casts(): array
    {
        return [
            'is_published' => 'boolean',
            'published_at' => 'immutable_datetime',
            'unpublished_at' => 'immutable_datetime',
            'is_featured' => 'boolean',
            'is_new_until' => 'immutable_date',
            'specifications' => 'array',
            'sort_weight' => 'integer',
            'created_at' => 'immutable_datetime',
        ];
    }

    public function state(): ListingState
    {
        return ListingState::of($this->is_published, $this->published_at, $this->unpublished_at, CarbonImmutable::now());
    }
}
