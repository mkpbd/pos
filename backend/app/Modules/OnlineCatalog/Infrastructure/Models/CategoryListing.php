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
 * @property string $category_id
 * @property string $slug
 * @property bool $is_visible
 * @property ?string $image_media_id
 * @property ?string $banner_media_id
 * @property ?string $description_html
 * @property ?string $seo_title
 * @property ?string $seo_description
 * @property ?array<string, array<string, string>> $translations {"bn": {field: text}} (E12b)
 */
#[Fillable(['organization_id', 'category_id', 'slug', 'is_visible', 'image_media_id', 'banner_media_id', 'description_html', 'seo_title', 'seo_description', 'translations'])]
class CategoryListing extends Model
{
    use BelongsToOrganization, ChangesStorefrontContent, HasUuids, TracksAuthor;

    protected $attributes = ['is_visible' => true];

    protected function casts(): array
    {
        return ['is_visible' => 'boolean', 'translations' => 'array'];
    }
}
