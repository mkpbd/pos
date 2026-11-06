<?php

namespace App\Modules\Purchasing\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\TracksAuthor;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * The organization's purchase approval limits (SC2). At most one row; missing = defaults.
 *
 * @property string $id
 * @property string $auto_approve_limit
 * @property string $manager_limit
 * @property bool $require_po_approval
 * @property ?Carbon $updated_at
 */
#[Fillable(['organization_id', 'auto_approve_limit', 'manager_limit', 'require_po_approval'])]
class PurchaseApprovalSettings extends Model
{
    use BelongsToOrganization, HasUuids, TracksAuthor;

    public const DEFAULTS = ['auto_approve_limit' => '10000.00', 'manager_limit' => '100000.00', 'require_po_approval' => true];

    protected $table = 'purchase_approval_settings';

    protected function casts(): array
    {
        return [
            'auto_approve_limit' => 'decimal:2',
            'manager_limit' => 'decimal:2',
            'require_po_approval' => 'boolean',
        ];
    }
}
