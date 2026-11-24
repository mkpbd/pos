<?php

namespace App\Modules\System\Infrastructure\Models;

use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * G1b: one database backup run (pg_dump) and its latest restore check. Install-wide, not tenant data.
 *
 * @property string $id
 * @property CarbonImmutable $started_at
 * @property ?CarbonImmutable $finished_at
 * @property string $status running | succeeded | failed
 * @property ?string $file_name
 * @property ?int $size_bytes
 * @property ?string $sha256
 * @property ?string $error
 * @property ?string $offsite_status skipped | succeeded | failed
 * @property ?string $offsite_error
 * @property ?CarbonImmutable $verified_at
 * @property ?string $verify_status passed | failed
 * @property ?string $verify_error
 * @property ?string $verify_mode list | restore
 * @property string $triggered_by schedule | user
 * @property ?string $user_id
 * @property ?CarbonImmutable $file_deleted_at
 * @property ?CarbonImmutable $created_at
 */
#[Table('system_backups')]
#[Fillable([
    'started_at', 'finished_at', 'status', 'file_name', 'size_bytes', 'sha256', 'error', 'offsite_status', 'offsite_error',
    'verified_at', 'verify_status', 'verify_error', 'verify_mode', 'triggered_by', 'user_id', 'file_deleted_at',
])]
class SystemBackup extends Model
{
    use HasUuids;

    public const RUNNING = 'running';

    public const SUCCEEDED = 'succeeded';

    public const FAILED = 'failed';

    protected function casts(): array
    {
        return [
            'started_at' => 'immutable_datetime',
            'finished_at' => 'immutable_datetime',
            'verified_at' => 'immutable_datetime',
            'file_deleted_at' => 'immutable_datetime',
            'size_bytes' => 'integer',
        ];
    }
}
