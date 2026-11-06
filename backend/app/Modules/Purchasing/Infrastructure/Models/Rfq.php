<?php

namespace App\Modules\Purchasing\Infrastructure\Models;

use App\Modules\Purchasing\Domain\Procurement\RfqStatus;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\TracksAuthor;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * A request for quotation sent to several suppliers (SC2).
 *
 * @property string $id
 * @property string $number
 * @property string $branch_id
 * @property string $store_id
 * @property RfqStatus $status
 * @property ?string $requisition_id
 * @property string $title
 * @property ?Carbon $needed_by
 * @property ?Carbon $reply_by
 * @property ?string $notes
 * @property ?Carbon $sent_at
 * @property ?Carbon $closed_at
 * @property ?Carbon $awarded_at
 * @property ?Carbon $cancelled_at
 * @property ?string $created_by
 * @property ?Carbon $created_at
 * @property ?Carbon $updated_at
 */
#[Fillable(['organization_id', 'number', 'branch_id', 'store_id', 'status', 'requisition_id', 'title', 'needed_by', 'reply_by', 'notes'])]
class Rfq extends Model
{
    use BelongsToOrganization, HasUuids, TracksAuthor;

    protected function casts(): array
    {
        return [
            'status' => RfqStatus::class,
            'needed_by' => 'date',
            'reply_by' => 'date',
            'sent_at' => 'datetime',
            'closed_at' => 'datetime',
            'awarded_at' => 'datetime',
            'cancelled_at' => 'datetime',
        ];
    }

    /**
     * @return HasMany<RfqLine, $this>
     */
    public function lines(): HasMany
    {
        return $this->hasMany(RfqLine::class)->orderBy('sort_order');
    }

    /**
     * @return HasMany<RfqSupplier, $this>
     */
    public function suppliers(): HasMany
    {
        return $this->hasMany(RfqSupplier::class)->orderBy('invited_at')->orderBy('id');
    }

    /**
     * @return HasMany<RfqAward, $this>
     */
    public function awards(): HasMany
    {
        return $this->hasMany(RfqAward::class);
    }

    /**
     * @return HasMany<RfqStatusChange, $this>
     */
    public function history(): HasMany
    {
        return $this->hasMany(RfqStatusChange::class)->orderBy('created_at')->orderBy('id');
    }
}
