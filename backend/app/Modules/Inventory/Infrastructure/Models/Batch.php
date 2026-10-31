<?php

namespace App\Modules\Inventory\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * @property string $id
 * @property string $variant_id
 * @property string $batch_number
 * @property ?Carbon $manufactured_on
 * @property ?Carbon $expires_on
 */
#[Fillable(['organization_id', 'variant_id', 'batch_number', 'manufactured_on', 'expires_on'])]
class Batch extends Model
{
    use BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return [
            'manufactured_on' => 'date',
            'expires_on' => 'date',
        ];
    }
}
