<?php

namespace App\Modules\Pos\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * POS1a: a manager's approval given with their PIN at the till, used once by the requester's sale.
 *
 * @property string $id
 * @property string $organization_id
 * @property string $store_id
 * @property string $action price_override|discount
 * @property string $approver_id
 * @property string $requester_id
 * @property array<string, mixed> $details
 * @property Carbon $expires_at
 * @property ?Carbon $used_at
 * @property ?string $sale_id
 * @property Carbon $created_at
 */
#[Table(timestamps: false)]
#[Fillable(['organization_id', 'store_id', 'action', 'approver_id', 'requester_id', 'details', 'expires_at', 'created_at'])]
class PosApproval extends Model
{
    use BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return [
            'details' => 'array',
            'expires_at' => 'datetime',
            'used_at' => 'datetime',
            'created_at' => 'datetime',
        ];
    }
}
