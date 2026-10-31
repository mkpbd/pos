<?php

namespace App\Modules\Promotions\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Model;

/**
 * A product, category or brand a product-scope promotion applies to. Rows are only ever
 * inserted and deleted per promotion (composite primary key).
 *
 * @property string $promotion_id
 * @property string $target_type
 * @property string $target_id
 */
#[Table(timestamps: false)]
#[Fillable(['organization_id', 'promotion_id', 'target_type', 'target_id'])]
class PromotionTarget extends Model
{
    use BelongsToOrganization;

    public $incrementing = false;

    protected $primaryKey = 'promotion_id';

    protected $keyType = 'string';
}
