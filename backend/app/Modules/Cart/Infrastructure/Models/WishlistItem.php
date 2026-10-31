<?php

namespace App\Modules\Cart\Infrastructure\Models;

use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * @property string $id
 * @property string $wishlist_id
 * @property string $product_id
 * @property ?string $variant_id
 * @property ?CarbonImmutable $created_at
 */
#[Fillable(['wishlist_id', 'product_id', 'variant_id', 'created_at'])]
class WishlistItem extends Model
{
    use HasUuids;

    public const UPDATED_AT = null;

    protected function casts(): array
    {
        return [
            'created_at' => 'immutable_datetime',
        ];
    }
}
