<?php

namespace App\Modules\Orders\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * BD1b: a mobile number that cannot order with cash on delivery from the shop.
 *
 * @property string $id
 * @property string $organization_id
 * @property string $phone normalised 01XXXXXXXXX
 * @property ?string $reason
 * @property ?string $created_by
 * @property CarbonImmutable $created_at
 */
#[Table('blocked_phones', timestamps: false)]
#[Fillable(['organization_id', 'phone', 'reason', 'created_by', 'created_at'])]
class BlockedPhone extends Model
{
    use BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return ['created_at' => 'immutable_datetime'];
    }
}
