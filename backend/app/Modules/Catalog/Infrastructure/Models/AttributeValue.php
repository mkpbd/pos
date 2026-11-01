<?php

namespace App\Modules\Catalog\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\ChangesStorefrontContent;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * @property string $id
 * @property string $attribute_id
 * @property string $value
 * @property ?string $swatch_hex
 * @property int $sort_order
 */
#[Fillable(['organization_id', 'attribute_id', 'value', 'swatch_hex', 'sort_order'])]
class AttributeValue extends Model
{
    use BelongsToOrganization, ChangesStorefrontContent, HasUuids;

    protected function casts(): array
    {
        return ['sort_order' => 'integer'];
    }
}
