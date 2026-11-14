<?php

namespace App\Modules\Products\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\ChangesStorefrontContent;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * P1a: one product image of one value of the product's photo option, in order.
 *
 * @property string $id
 * @property string $product_id
 * @property string $option_name
 * @property string $option_value
 * @property string $image_id
 * @property int $sort_order
 */
#[Fillable(['organization_id', 'product_id', 'option_name', 'option_value', 'image_id', 'sort_order'])]
class ProductOptionImage extends Model
{
    use BelongsToOrganization, ChangesStorefrontContent, HasUuids;

    protected function casts(): array
    {
        return ['sort_order' => 'integer'];
    }
}
