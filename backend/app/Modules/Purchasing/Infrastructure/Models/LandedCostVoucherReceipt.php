<?php

namespace App\Modules\Purchasing\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * A goods receipt a landed cost voucher applies to.
 *
 * @property string $id
 * @property string $landed_cost_voucher_id
 * @property string $goods_receipt_id
 * @property int $sort_order
 */
#[Table(timestamps: false)]
#[Fillable(['organization_id', 'landed_cost_voucher_id', 'goods_receipt_id', 'sort_order'])]
class LandedCostVoucherReceipt extends Model
{
    use BelongsToOrganization, HasUuids;
}
