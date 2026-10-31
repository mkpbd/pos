<?php

namespace App\Modules\Sales\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * Stock a sale line was taken from (a batch, or untracked stock when batch is NULL) and its cost.
 *
 * @property string $id
 * @property string $sale_line_id
 * @property ?string $batch_id
 * @property string $quantity
 * @property string $unit_cost
 */
#[Table(name: 'sale_line_stock', timestamps: false)]
#[Fillable(['organization_id', 'sale_line_id', 'batch_id', 'quantity', 'unit_cost'])]
class SaleLineStock extends Model
{
    use AppendOnly, BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return ['quantity' => 'decimal:3', 'unit_cost' => 'decimal:4'];
    }
}
