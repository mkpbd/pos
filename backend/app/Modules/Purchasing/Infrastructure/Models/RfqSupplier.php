<?php

namespace App\Modules\Purchasing\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Support\Carbon;

/**
 * A supplier invited to an RFQ.
 *
 * @property string $id
 * @property string $rfq_id
 * @property string $supplier_id
 * @property Carbon $invited_at
 * @property ?Carbon $sent_at
 * @property ?Carbon $emailed_at
 * @property ?string $email
 */
#[Table(timestamps: false)]
#[Fillable(['organization_id', 'rfq_id', 'supplier_id', 'invited_at', 'sent_at', 'emailed_at', 'email'])]
class RfqSupplier extends Model
{
    use BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return ['invited_at' => 'datetime', 'sent_at' => 'datetime', 'emailed_at' => 'datetime'];
    }

    /**
     * @return HasOne<SupplierQuote, $this>
     */
    public function quote(): HasOne
    {
        return $this->hasOne(SupplierQuote::class);
    }
}
