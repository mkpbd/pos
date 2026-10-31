<?php

namespace App\Modules\Authentication\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * @property string $id
 * @property ?string $organization_id
 * @property ?string $user_id
 * @property string $email
 * @property string $channel
 * @property bool $succeeded
 * @property ?string $failure_reason
 * @property ?string $ip_address
 * @property ?string $user_agent
 * @property Carbon $created_at
 */
#[Table(timestamps: false)]
#[Fillable(['organization_id', 'user_id', 'email', 'channel', 'succeeded', 'failure_reason', 'ip_address', 'user_agent', 'created_at'])]
class LoginActivity extends Model
{
    use BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return [
            'succeeded' => 'boolean',
            'created_at' => 'datetime',
        ];
    }
}
