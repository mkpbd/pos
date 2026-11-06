<?php

namespace App\Modules\Purchasing\Infrastructure\Models;

use App\Modules\Purchasing\Domain\LandedCost\AllocationBasis;
use App\Modules\Purchasing\Domain\LandedCost\ChargeType;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * @property string $id
 * @property string $landed_cost_voucher_id
 * @property ChargeType $type
 * @property ?string $description
 * @property string $amount
 * @property string $tax_amount
 * @property AllocationBasis $allocation
 * @property int $sort_order
 */
#[Table(timestamps: false)]
#[Fillable(['organization_id', 'landed_cost_voucher_id', 'type', 'description', 'amount', 'tax_amount', 'allocation', 'sort_order'])]
class LandedCostVoucherCharge extends Model
{
    use BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return [
            'type' => ChargeType::class,
            'allocation' => AllocationBasis::class,
            'amount' => 'decimal:2',
            'tax_amount' => 'decimal:2',
            'sort_order' => 'integer',
        ];
    }
}
