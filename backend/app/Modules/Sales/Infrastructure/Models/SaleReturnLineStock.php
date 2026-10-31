<?php

namespace App\Modules\Sales\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * Restocked quantity put back to one of the batches (sale line allocations) it was sold from.
 *
 * @property string $id
 * @property string $sale_return_line_id
 * @property string $sale_line_stock_id
 * @property ?string $batch_id
 * @property string $quantity
 * @property string $unit_cost
 */
#[Table(name: 'sale_return_line_stock', timestamps: false)]
#[Fillable(['organization_id', 'sale_return_line_id', 'sale_line_stock_id', 'batch_id', 'quantity', 'unit_cost'])]
class SaleReturnLineStock extends Model
{
    use AppendOnly, BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return ['quantity' => 'decimal:3', 'unit_cost' => 'decimal:4'];
    }
}
