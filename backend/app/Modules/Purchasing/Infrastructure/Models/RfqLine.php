<?php

namespace App\Modules\Purchasing\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * @property string $id
 * @property string $rfq_id
 * @property string $variant_id
 * @property string $quantity
 * @property ?string $requisition_line_id
 * @property ?string $notes
 * @property int $sort_order
 */
#[Table(timestamps: false)]
#[Fillable(['organization_id', 'rfq_id', 'variant_id', 'quantity', 'requisition_line_id', 'notes', 'sort_order'])]
class RfqLine extends Model
{
    use BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return ['quantity' => 'decimal:3', 'sort_order' => 'integer'];
    }
}
