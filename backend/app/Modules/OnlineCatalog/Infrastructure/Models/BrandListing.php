<?php

namespace App\Modules\OnlineCatalog\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\ChangesStorefrontContent;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\TracksAuthor;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * @property string $id
 * @property string $brand_id
 * @property string $slug
 * @property bool $is_visible
 * @property ?string $logo_media_id
 * @property ?string $description
 * @property ?string $seo_title
 * @property ?string $seo_description
 */
#[Fillable(['organization_id', 'brand_id', 'slug', 'is_visible', 'logo_media_id', 'description', 'seo_title', 'seo_description'])]
class BrandListing extends Model
{
    use BelongsToOrganization, ChangesStorefrontContent, HasUuids, TracksAuthor;

    protected $attributes = ['is_visible' => true];

    protected function casts(): array
    {
        return ['is_visible' => 'boolean'];
    }
}
