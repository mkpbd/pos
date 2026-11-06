<?php

namespace App\Modules\Purchasing\Infrastructure\Models;

use App\Modules\Purchasing\Domain\LandedCost\LandedCostVoucherStatus;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * SC3: landed costs billed after the goods arrived (`LCV-000001`), applied to posted goods
 * receipts of one branch. Draft → posted; a posted voucher is never changed.
 *
 * @property string $id
 * @property string $number
 * @property string $branch_id
 * @property LandedCostVoucherStatus $status
 * @property Carbon $voucher_date
 * @property string $charge_supplier_id
 * @property ?string $reference
 * @property ?string $notes
 * @property string $currency
 * @property string $charges_total
 * @property string $tax_total
 * @property string $total
 * @property ?string $on_hand_total
 * @property ?string $consumed_total
 * @property ?string $expense_id
 * @property ?string $expense_number
 * @property ?string $posted_by
 * @property ?Carbon $posted_at
 * @property ?string $created_by
 * @property ?string $updated_by
 * @property Carbon $created_at
 * @property Carbon $updated_at
 */
#[Fillable([
    'organization_id', 'number', 'branch_id', 'status', 'voucher_date', 'charge_supplier_id', 'reference', 'notes', 'currency',
    'charges_total', 'tax_total', 'total', 'on_hand_total', 'consumed_total', 'expense_id', 'expense_number', 'posted_by',
    'posted_at', 'created_by', 'updated_by',
])]
class LandedCostVoucher extends Model
{
    use BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return [
            'status' => LandedCostVoucherStatus::class,
            'voucher_date' => 'date',
            'charges_total' => 'decimal:2',
            'tax_total' => 'decimal:2',
            'total' => 'decimal:2',
            'on_hand_total' => 'decimal:2',
            'consumed_total' => 'decimal:2',
            'posted_at' => 'datetime',
        ];
    }

    /**
     * @return HasMany<LandedCostVoucherCharge, $this>
     */
    public function charges(): HasMany
    {
        return $this->hasMany(LandedCostVoucherCharge::class)->orderBy('sort_order');
    }

    /**
     * @return HasMany<LandedCostVoucherReceipt, $this>
     */
    public function receipts(): HasMany
    {
        return $this->hasMany(LandedCostVoucherReceipt::class)->orderBy('sort_order');
    }

    /**
     * @return HasMany<LandedCostAllocation, $this>
     */
    public function allocations(): HasMany
    {
        return $this->hasMany(LandedCostAllocation::class)->orderBy('sort_order');
    }
}
