<?php

namespace App\Modules\Purchasing\Infrastructure\Models;

use App\Modules\Sales\Infrastructure\Models\AppendOnly;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * An RFQ line (part) awarded to a supplier, and the draft purchase order it went into.
 *
 * @property string $id
 * @property string $rfq_id
 * @property string $rfq_line_id
 * @property string $supplier_id
 * @property string $purchase_order_id
 * @property string $quantity
 * @property string $unit_price
 * @property Carbon $created_at
 */
#[Table(timestamps: false)]
#[Fillable(['organization_id', 'rfq_id', 'rfq_line_id', 'supplier_id', 'purchase_order_id', 'quantity', 'unit_price', 'created_at'])]
class RfqAward extends Model
{
    use AppendOnly, BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return ['quantity' => 'decimal:3', 'unit_price' => 'decimal:4', 'created_at' => 'datetime'];
    }
}
