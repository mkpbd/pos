<?php

namespace App\Modules\Imports\Infrastructure\Models;

use App\Modules\Imports\Domain\ImportStatus;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * ST1: one uploaded file of one import type and what happened to its rows.
 *
 * @property string $id
 * @property string $organization_id
 * @property ?string $branch_id
 * @property string $type
 * @property ImportStatus $status
 * @property string $file_name
 * @property string $file_format
 * @property int $file_size
 * @property array<string, mixed> $options
 * @property int $rows_total
 * @property int $rows_valid
 * @property int $rows_error
 * @property int $to_create
 * @property int $to_update
 * @property int $to_skip
 * @property int $created
 * @property int $updated
 * @property int $skipped
 * @property int $failed_rows
 * @property int $error_count
 * @property ?list<int> $error_rows
 * @property ?string $message
 * @property ?string $created_by
 * @property ?Carbon $validated_at
 * @property ?Carbon $started_at
 * @property ?Carbon $finished_at
 * @property ?Carbon $file_deleted_at
 * @property Carbon $created_at
 */
#[Fillable([
    'organization_id', 'branch_id', 'type', 'status', 'file_name', 'file_format', 'file_size', 'options',
    'rows_total', 'rows_valid', 'rows_error', 'to_create', 'to_update', 'to_skip', 'created', 'updated',
    'skipped', 'failed_rows', 'error_count', 'error_rows', 'message', 'created_by', 'validated_at', 'started_at',
    'finished_at', 'file_deleted_at',
])]
class Import extends Model
{
    use BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return [
            'status' => ImportStatus::class,
            'options' => 'array',
            'file_size' => 'integer',
            'rows_total' => 'integer',
            'rows_valid' => 'integer',
            'rows_error' => 'integer',
            'to_create' => 'integer',
            'to_update' => 'integer',
            'to_skip' => 'integer',
            'created' => 'integer',
            'updated' => 'integer',
            'skipped' => 'integer',
            'failed_rows' => 'integer',
            'error_count' => 'integer',
            'error_rows' => 'array',
            'validated_at' => 'datetime',
            'started_at' => 'datetime',
            'finished_at' => 'datetime',
            'file_deleted_at' => 'datetime',
        ];
    }

    /**
     * Path on the imports disk.
     */
    public function filePath(): string
    {
        return "imports/{$this->organization_id}/{$this->id}.{$this->file_format}";
    }

    /**
     * @return HasMany<ImportError, $this>
     */
    public function errors(): HasMany
    {
        return $this->hasMany(ImportError::class);
    }
}
