<?php

namespace App\Modules\Promotions\Infrastructure\Models;

use App\Modules\Promotions\Domain\PromotionScope;
use App\Modules\Promotions\Domain\PromotionState;
use App\Modules\Promotions\Domain\PromotionTrigger;
use App\Modules\Promotions\Domain\PromotionType;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\ChangesStorefrontContent;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\TracksAuthor;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * @property string $id
 * @property string $organization_id
 * @property string $name
 * @property ?string $description
 * @property PromotionType $type
 * @property string $value
 * @property PromotionScope $scope
 * @property ?string $min_subtotal
 * @property ?string $max_discount
 * @property PromotionTrigger $trigger
 * @property ?CarbonImmutable $starts_at
 * @property ?CarbonImmutable $ends_at
 * @property bool $show_countdown
 * @property bool $is_active
 * @property ?int $usage_limit
 * @property ?int $usage_limit_per_customer
 * @property ?CarbonImmutable $created_at
 * @property ?CarbonImmutable $updated_at
 */
#[Fillable([
    'name', 'description', 'type', 'value', 'scope', 'min_subtotal', 'max_discount', 'trigger', 'starts_at', 'ends_at',
    'show_countdown', 'is_active', 'usage_limit', 'usage_limit_per_customer',
])]
class Promotion extends Model
{
    use BelongsToOrganization, ChangesStorefrontContent, HasUuids, TracksAuthor;

    protected $attributes = [
        'value' => '0.00',
        'show_countdown' => false,
        'is_active' => true,
    ];

    protected function casts(): array
    {
        return [
            'type' => PromotionType::class,
            'scope' => PromotionScope::class,
            'trigger' => PromotionTrigger::class,
            'value' => 'decimal:2',
            'min_subtotal' => 'decimal:2',
            'max_discount' => 'decimal:2',
            'starts_at' => 'immutable_datetime',
            'ends_at' => 'immutable_datetime',
            'show_countdown' => 'boolean',
            'is_active' => 'boolean',
            'usage_limit' => 'integer',
            'usage_limit_per_customer' => 'integer',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }

    public function state(): PromotionState
    {
        return PromotionState::of($this->is_active, $this->starts_at, $this->ends_at, CarbonImmutable::now());
    }

    /**
     * @return HasMany<PromotionTarget, $this>
     */
    public function targets(): HasMany
    {
        return $this->hasMany(PromotionTarget::class);
    }

    /**
     * @return HasMany<Coupon, $this>
     */
    public function coupons(): HasMany
    {
        return $this->hasMany(Coupon::class);
    }

    /**
     * @return HasMany<PromotionRedemption, $this>
     */
    public function redemptions(): HasMany
    {
        return $this->hasMany(PromotionRedemption::class);
    }
}
