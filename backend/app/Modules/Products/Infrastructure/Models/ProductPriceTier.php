<?php

namespace App\Modules\Products\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * ST2c: a quantity break — from `min_quantity` base units per line the unit price is `price`.
 *
 * @property string $id
 * @property string $variant_id
 * @property string $min_quantity
 * @property string $price
 */
#[Fillable(['organization_id', 'variant_id', 'min_quantity', 'price'])]
class ProductPriceTier extends Model
{
    use BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return ['min_quantity' => 'decimal:3', 'price' => 'decimal:2'];
    }
}
