<?php

namespace App\Modules\System\Infrastructure\Models;

use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * G1b: one distinct unexpected error (grouped by fingerprint) in the built-in error log.
 * Rows are written by ErrorRecorder through the `error_log` connection; operators only change
 * the status. Install-wide, not tenant data.
 *
 * @property string $id
 * @property string $fingerprint
 * @property string $exception_class
 * @property string $message
 * @property ?string $file
 * @property ?int $line
 * @property ?string $trace
 * @property int $occurrences
 * @property CarbonImmutable $first_seen_at
 * @property CarbonImmutable $last_seen_at
 * @property ?string $last_method
 * @property ?string $last_path
 * @property ?string $last_request_id
 * @property ?string $last_user_id
 * @property ?string $last_organization_id
 * @property string $status open | resolved | ignored
 * @property ?CarbonImmutable $resolved_at
 * @property ?string $resolved_by
 * @property ?CarbonImmutable $notified_at
 */
#[Table('error_events')]
#[Fillable([
    'fingerprint', 'exception_class', 'message', 'file', 'line', 'trace', 'occurrences', 'first_seen_at', 'last_seen_at',
    'last_method', 'last_path', 'last_request_id', 'last_user_id', 'last_organization_id', 'status', 'resolved_at',
    'resolved_by', 'notified_at',
])]
class ErrorEvent extends Model
{
    use HasUuids;

    public const OPEN = 'open';

    public const RESOLVED = 'resolved';

    public const IGNORED = 'ignored';

    public const STATUSES = [self::OPEN, self::RESOLVED, self::IGNORED];

    protected function casts(): array
    {
        return [
            'line' => 'integer',
            'occurrences' => 'integer',
            'first_seen_at' => 'immutable_datetime',
            'last_seen_at' => 'immutable_datetime',
            'resolved_at' => 'immutable_datetime',
            'notified_at' => 'immutable_datetime',
        ];
    }
}
