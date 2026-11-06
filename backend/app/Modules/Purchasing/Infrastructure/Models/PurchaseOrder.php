<?php

namespace App\Modules\Purchasing\Infrastructure\Models;

use App\Modules\Purchasing\Domain\Procurement\ApprovalLevel;
use App\Modules\Purchasing\Domain\PurchaseOrderStatus;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\TracksAuthor;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * @property string $id
 * @property string $number
 * @property string $supplier_id
 * @property string $branch_id
 * @property string $store_id
 * @property PurchaseOrderStatus $status
 * @property Carbon $order_date
 * @property ?Carbon $expected_date
 * @property ?string $notes
 * @property string $currency
 * @property string $subtotal
 * @property string $tax_total
 * @property string $total
 * @property ?Carbon $ordered_at
 * @property ?Carbon $cancelled_at
 * @property ?string $requisition_id
 * @property ?string $rfq_id
 * @property ?string $approved_amount
 * @property ?ApprovalLevel $approval_level
 * @property ?string $submitted_by
 * @property ?Carbon $submitted_at
 * @property ?string $approved_by
 * @property ?Carbon $approved_at
 * @property ?string $rejected_by
 * @property ?Carbon $rejected_at
 * @property ?string $rejection_reason
 * @property ?string $created_by
 * @property ?Carbon $created_at
 */
#[Fillable([
    'organization_id', 'number', 'supplier_id', 'branch_id', 'store_id', 'status', 'order_date', 'expected_date', 'notes',
    'currency', 'subtotal', 'tax_total', 'total', 'ordered_at', 'cancelled_at',
])]
class PurchaseOrder extends Model
{
    use BelongsToOrganization, HasUuids, TracksAuthor;

    protected function casts(): array
    {
        return [
            'status' => PurchaseOrderStatus::class,
            'order_date' => 'date',
            'expected_date' => 'date',
            'ordered_at' => 'datetime',
            'cancelled_at' => 'datetime',
            'subtotal' => 'decimal:2',
            'tax_total' => 'decimal:2',
            'total' => 'decimal:2',
            // SC2: approval.
            'approved_amount' => 'decimal:2',
            'approval_level' => ApprovalLevel::class,
            'submitted_at' => 'datetime',
            'approved_at' => 'datetime',
            'rejected_at' => 'datetime',
        ];
    }

    /**
     * @return HasMany<PurchaseOrderStatusChange, $this>
     */
    public function history(): HasMany
    {
        return $this->hasMany(PurchaseOrderStatusChange::class)->orderBy('created_at')->orderBy('id');
    }

    /**
     * @return HasMany<PurchaseOrderLine, $this>
     */
    public function lines(): HasMany
    {
        return $this->hasMany(PurchaseOrderLine::class)->orderBy('sort_order');
    }
}
