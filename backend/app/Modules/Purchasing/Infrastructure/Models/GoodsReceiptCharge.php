<?php

namespace App\Modules\Purchasing\Infrastructure\Models;

use App\Modules\Purchasing\Domain\LandedCost\AllocationBasis;
use App\Modules\Purchasing\Domain\LandedCost\ChargeType;
use App\Modules\Sales\Infrastructure\Models\AppendOnly;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * SC3: a landed cost charge on a goods receipt (append-only, like the posted receipt).
 * `charge_supplier_id` NULL = billed on the main supplier's invoice; otherwise a payable on
 * that supplier's account.
 *
 * @property string $id
 * @property string $goods_receipt_id
 * @property ChargeType $type
 * @property ?string $description
 * @property string $amount
 * @property string $tax_amount
 * @property AllocationBasis $allocation
 * @property ?string $charge_supplier_id
 * @property int $sort_order
 * @property Carbon $created_at
 */
#[Table(timestamps: false)]
#[Fillable(['organization_id', 'goods_receipt_id', 'type', 'description', 'amount', 'tax_amount', 'allocation', 'charge_supplier_id', 'sort_order', 'created_at'])]
class GoodsReceiptCharge extends Model
{
    use AppendOnly, BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return [
            'type' => ChargeType::class,
            'allocation' => AllocationBasis::class,
            'amount' => 'decimal:2',
            'tax_amount' => 'decimal:2',
            'sort_order' => 'integer',
            'created_at' => 'datetime',
        ];
    }
}
