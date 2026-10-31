<?php

namespace App\Modules\Sales\Infrastructure\Models;

use App\Modules\Sales\Domain\PaymentMethod;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * Money (or points) handed back for a completed return. Append-only.
 *
 * @property string $id
 * @property string $sale_return_id
 * @property PaymentMethod $method
 * @property string $amount
 * @property ?string $reference
 * @property ?string $created_by
 * @property Carbon $created_at
 */
#[Table(timestamps: false)]
#[Fillable(['organization_id', 'sale_return_id', 'method', 'amount', 'reference', 'created_by', 'created_at'])]
class SaleReturnRefund extends Model
{
    use AppendOnly, BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return [
            'method' => PaymentMethod::class,
            'amount' => 'decimal:2',
            'created_at' => 'datetime',
        ];
    }
}
