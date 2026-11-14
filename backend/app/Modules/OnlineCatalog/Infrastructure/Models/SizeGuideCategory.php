<?php

namespace App\Modules\OnlineCatalog\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\ChangesStorefrontContent;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;

/**
 * P1a: the size guide a category (and its subcategories) uses.
 *
 * @property string $size_guide_id
 * @property string $category_id
 */
#[Fillable(['organization_id', 'size_guide_id', 'category_id'])]
class SizeGuideCategory extends Model
{
    use BelongsToOrganization, ChangesStorefrontContent;

    public $incrementing = false;

    protected $primaryKey = 'category_id';

    protected $keyType = 'string';
}
