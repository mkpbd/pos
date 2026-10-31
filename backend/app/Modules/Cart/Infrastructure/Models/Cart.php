<?php

namespace App\Modules\Cart\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * @property string $id
 * @property string $organization_id
 * @property ?string $customer_id
 * @property ?string $token_hash
 * @property ?CarbonImmutable $expires_at
 * @property ?string $converted_order_id the web order this cart became (never used again)
 * @property ?string $coupon_code the applied coupon (E8b), upper-case
 * @property ?CarbonImmutable $updated_at
 */
#[Fillable(['organization_id', 'customer_id', 'token_hash', 'expires_at', 'converted_order_id', 'coupon_code'])]
class Cart extends Model
{
    use BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return [
            'expires_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return HasMany<CartItem, $this>
     */
    public function items(): HasMany
    {
        return $this->hasMany(CartItem::class);
    }
}
