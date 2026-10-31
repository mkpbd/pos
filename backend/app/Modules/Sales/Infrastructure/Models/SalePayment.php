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
 * Money received for a sale (kind "payment") or given back when it was cancelled
 * (kind "reversal", negative amount). Append-only.
 *
 * @property string $id
 * @property string $sale_id
 * @property string $branch_id
 * @property string $kind
 * @property PaymentMethod $method
 * @property string $amount
 * @property ?string $tendered
 * @property ?string $reference
 * @property ?string $created_by
 * @property Carbon $created_at
 */
#[Table(timestamps: false)]
#[Fillable(['organization_id', 'sale_id', 'branch_id', 'kind', 'method', 'amount', 'tendered', 'reference', 'created_by', 'created_at'])]
class SalePayment extends Model
{
    use AppendOnly, BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return [
            'method' => PaymentMethod::class,
            'amount' => 'decimal:2',
            'tendered' => 'decimal:2',
            'created_at' => 'datetime',
        ];
    }
}
