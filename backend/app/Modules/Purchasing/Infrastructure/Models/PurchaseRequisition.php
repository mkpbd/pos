<?php

namespace App\Modules\Purchasing\Infrastructure\Models;

use App\Modules\Purchasing\Domain\Procurement\ApprovalLevel;
use App\Modules\Purchasing\Domain\Procurement\RequisitionStatus;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\TracksAuthor;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * A branch's request to buy (SC2), approved by amount and turned into purchase orders / RFQs.
 *
 * @property string $id
 * @property string $number
 * @property string $branch_id
 * @property string $store_id
 * @property RequisitionStatus $status
 * @property string $requested_by
 * @property ?Carbon $needed_by
 * @property ?string $notes
 * @property string $currency
 * @property string $estimated_subtotal
 * @property string $estimated_tax
 * @property string $estimated_total
 * @property ?ApprovalLevel $approval_level
 * @property ?Carbon $submitted_at
 * @property ?string $approved_by
 * @property ?Carbon $approved_at
 * @property ?string $rejected_by
 * @property ?Carbon $rejected_at
 * @property ?string $rejection_reason
 * @property ?string $cancelled_by
 * @property ?Carbon $cancelled_at
 * @property ?string $cancellation_reason
 * @property ?Carbon $converted_at
 * @property ?string $created_by
 * @property ?Carbon $created_at
 * @property ?Carbon $updated_at
 */
#[Fillable([
    'organization_id', 'number', 'branch_id', 'store_id', 'status', 'requested_by', 'needed_by', 'notes', 'currency',
    'estimated_subtotal', 'estimated_tax', 'estimated_total',
])]
class PurchaseRequisition extends Model
{
    use BelongsToOrganization, HasUuids, TracksAuthor;

    protected function casts(): array
    {
        return [
            'status' => RequisitionStatus::class,
            'approval_level' => ApprovalLevel::class,
            'needed_by' => 'date',
            'estimated_subtotal' => 'decimal:2',
            'estimated_tax' => 'decimal:2',
            'estimated_total' => 'decimal:2',
            'submitted_at' => 'datetime',
            'approved_at' => 'datetime',
            'rejected_at' => 'datetime',
            'cancelled_at' => 'datetime',
            'converted_at' => 'datetime',
        ];
    }

    /**
     * @return HasMany<PurchaseRequisitionLine, $this>
     */
    public function lines(): HasMany
    {
        return $this->hasMany(PurchaseRequisitionLine::class)->orderBy('sort_order');
    }

    /**
     * @return HasMany<PurchaseRequisitionStatusChange, $this>
     */
    public function history(): HasMany
    {
        return $this->hasMany(PurchaseRequisitionStatusChange::class)->orderBy('created_at')->orderBy('id');
    }

    /** Approved by a person or the system (also once converted). */
    public function isApproved(): bool
    {
        return $this->approved_at !== null && in_array($this->status, [RequisitionStatus::Approved, RequisitionStatus::Converted], true);
    }
}
