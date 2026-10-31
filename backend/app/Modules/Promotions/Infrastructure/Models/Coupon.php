<?php

namespace App\Modules\Promotions\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\TracksAuthor;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A code of a coupon promotion (stored upper-case, unique per organization).
 *
 * @property string $id
 * @property string $organization_id
 * @property string $promotion_id
 * @property string $code
 * @property ?int $usage_limit
 * @property int $used_count
 * @property bool $is_active
 * @property ?CarbonImmutable $created_at
 * @property-read Promotion $promotion
 */
#[Fillable(['promotion_id', 'code', 'usage_limit', 'is_active'])]
class Coupon extends Model
{
    use BelongsToOrganization, HasUuids, TracksAuthor;

    protected $attributes = [
        'used_count' => 0,
        'is_active' => true,
    ];

    protected function casts(): array
    {
        return [
            'usage_limit' => 'integer',
            'used_count' => 'integer',
            'is_active' => 'boolean',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return BelongsTo<Promotion, $this>
     */
    public function promotion(): BelongsTo
    {
        return $this->belongsTo(Promotion::class);
    }
}
