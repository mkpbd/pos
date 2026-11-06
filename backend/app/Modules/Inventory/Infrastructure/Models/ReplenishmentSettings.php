<?php

namespace App\Modules\Inventory\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\TracksAuthor;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * The organization's replenishment settings (SC1). At most one row; missing = defaults.
 *
 * @property string $id
 * @property ?string $source_store_id
 * @property int $coverage_days
 * @property int $velocity_days
 * @property int $safety_days
 */
#[Fillable(['organization_id', 'source_store_id', 'coverage_days', 'velocity_days', 'safety_days'])]
class ReplenishmentSettings extends Model
{
    use BelongsToOrganization, HasUuids, TracksAuthor;

    public const DEFAULTS = ['source_store_id' => null, 'coverage_days' => 14, 'velocity_days' => 30, 'safety_days' => 3];

    protected $table = 'replenishment_settings';

    protected function casts(): array
    {
        return [
            'coverage_days' => 'integer',
            'velocity_days' => 'integer',
            'safety_days' => 'integer',
        ];
    }
}
