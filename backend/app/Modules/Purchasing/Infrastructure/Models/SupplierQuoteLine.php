<?php

namespace App\Modules\Purchasing\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * @property string $id
 * @property string $supplier_quote_id
 * @property string $rfq_line_id
 * @property string $unit_price
 * @property ?string $quantity_offered
 * @property ?int $lead_time_days
 * @property ?string $notes
 */
#[Table(timestamps: false)]
#[Fillable(['organization_id', 'supplier_quote_id', 'rfq_line_id', 'unit_price', 'quantity_offered', 'lead_time_days', 'notes'])]
class SupplierQuoteLine extends Model
{
    use BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return ['unit_price' => 'decimal:4', 'quantity_offered' => 'decimal:3', 'lead_time_days' => 'integer'];
    }
}
