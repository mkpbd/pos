<?php

namespace App\Modules\Pos\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;
use LogicException;

/**
 * POS1d: the cash drawer opened at the till without a sale. Append-only (a database trigger too).
 *
 * @property string $id
 * @property string $organization_id
 * @property string $branch_id
 * @property string $store_id
 * @property ?string $register_session_id
 * @property ?string $register_session_number
 * @property ?string $terminal_id
 * @property string $user_id
 * @property ?string $approved_by
 * @property ?string $approval_id
 * @property string $reason
 * @property Carbon $opened_at
 */
#[Table(name: 'pos_drawer_openings', timestamps: false)]
#[Fillable([
    'organization_id', 'branch_id', 'store_id', 'register_session_id', 'register_session_number', 'terminal_id',
    'user_id', 'approved_by', 'approval_id', 'reason', 'opened_at',
])]
class DrawerOpening extends Model
{
    use BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return ['opened_at' => 'datetime'];
    }

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('Drawer openings cannot change.'));
        static::deleting(fn () => throw new LogicException('Drawer openings cannot be deleted.'));
    }
}
