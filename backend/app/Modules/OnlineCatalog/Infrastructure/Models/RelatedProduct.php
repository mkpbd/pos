<?php

namespace App\Modules\OnlineCatalog\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;

/**
 * @property string $product_id
 * @property string $related_product_id
 * @property string $kind related | frequently_bought
 * @property int $sort_order
 */
#[Fillable(['organization_id', 'product_id', 'related_product_id', 'kind', 'sort_order'])]
class RelatedProduct extends Model
{
    use BelongsToOrganization;

    public const KINDS = ['related', 'frequently_bought'];

    public const MAX_PER_KIND = 12;

    public $incrementing = false;

    protected $primaryKey = null;

    protected function casts(): array
    {
        return ['sort_order' => 'integer'];
    }
}
