<?php

namespace App\Modules\Purchasing\Infrastructure\Models;

use App\Modules\Purchasing\Domain\Procurement\QuoteStatus;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\TracksAuthor;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Carbon;

/**
 * A supplier's answer to an RFQ: prices per line, or a decline.
 *
 * @property string $id
 * @property string $rfq_supplier_id
 * @property QuoteStatus $status
 * @property Carbon $received_at
 * @property ?Carbon $valid_until
 * @property ?string $notes
 */
#[Fillable(['organization_id', 'rfq_supplier_id', 'status', 'received_at', 'valid_until', 'notes'])]
class SupplierQuote extends Model
{
    use BelongsToOrganization, HasUuids, TracksAuthor;

    protected function casts(): array
    {
        return ['status' => QuoteStatus::class, 'received_at' => 'datetime', 'valid_until' => 'date'];
    }

    /**
     * @return HasMany<SupplierQuoteLine, $this>
     */
    public function lines(): HasMany
    {
        return $this->hasMany(SupplierQuoteLine::class);
    }
}
