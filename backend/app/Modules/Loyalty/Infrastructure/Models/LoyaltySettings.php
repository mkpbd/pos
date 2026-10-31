<?php

namespace App\Modules\Loyalty\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * @property string $id
 * @property bool $is_enabled
 * @property string $spend_amount
 * @property int $points_per_spend
 * @property string $point_value
 * @property int $min_redeem_points
 * @property ?string $updated_by
 */
#[Fillable(['organization_id', 'is_enabled', 'spend_amount', 'points_per_spend', 'point_value', 'min_redeem_points', 'updated_by'])]
class LoyaltySettings extends Model
{
    use BelongsToOrganization, HasUuids;

    protected $table = 'loyalty_settings';

    protected $attributes = [
        'is_enabled' => false,
        'spend_amount' => '100.00',
        'points_per_spend' => 1,
        'point_value' => '1.00',
        'min_redeem_points' => 0,
    ];

    protected function casts(): array
    {
        return [
            'is_enabled' => 'boolean',
            'spend_amount' => 'decimal:2',
            'points_per_spend' => 'integer',
            'point_value' => 'decimal:2',
            'min_redeem_points' => 'integer',
        ];
    }
}
