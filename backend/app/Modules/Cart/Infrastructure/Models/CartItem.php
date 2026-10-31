<?php

namespace App\Modules\Cart\Infrastructure\Models;

use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * A cart line: a variant and a quantity, nothing else (prices are always read live).
 *
 * @property string $id
 * @property string $cart_id
 * @property string $variant_id
 * @property string $quantity
 * @property ?CarbonImmutable $created_at
 */
#[Fillable(['cart_id', 'variant_id', 'quantity'])]
class CartItem extends Model
{
    use HasUuids;

    protected function casts(): array
    {
        return [
            'quantity' => 'decimal:3',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }
}
