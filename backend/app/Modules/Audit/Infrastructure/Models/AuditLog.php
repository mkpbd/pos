<?php

namespace App\Modules\Audit\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;
use LogicException;

/**
 * Append-only audit entry.
 *
 * @property string $id
 * @property ?string $organization_id
 * @property ?string $branch_id
 * @property ?string $user_id
 * @property string $action
 * @property ?string $subject_type
 * @property ?string $subject_id
 * @property ?array<string, mixed> $old_values
 * @property ?array<string, mixed> $new_values
 * @property ?array<string, mixed> $context
 * @property ?string $ip_address
 * @property ?string $request_id
 * @property Carbon $created_at
 */
#[Table(timestamps: false)]
#[Fillable([
    'organization_id', 'branch_id', 'user_id', 'action', 'subject_type', 'subject_id',
    'old_values', 'new_values', 'context', 'ip_address', 'request_id', 'created_at',
])]
class AuditLog extends Model
{
    use BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return [
            'old_values' => 'array',
            'new_values' => 'array',
            'context' => 'array',
            'created_at' => 'datetime',
        ];
    }

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('Audit logs are immutable.'));
        static::deleting(fn () => throw new LogicException('Audit logs are immutable.'));
    }
}
