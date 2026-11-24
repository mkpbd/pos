<?php

namespace App\Modules\Imports\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * @property int $id
 * @property string $import_id
 * @property string $phase validate | run
 * @property int $row
 * @property ?string $column
 * @property string $message
 * @property ?array<string, ?string> $values
 * @property Carbon $created_at
 */
#[Fillable(['import_id', 'organization_id', 'phase', 'row', 'column', 'message', 'values', 'created_at'])]
class ImportError extends Model
{
    use BelongsToOrganization;

    public const UPDATED_AT = null;

    protected function casts(): array
    {
        return [
            'row' => 'integer',
            'values' => 'array',
            'created_at' => 'datetime',
        ];
    }
}
