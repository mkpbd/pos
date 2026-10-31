<?php

namespace App\Modules\Sales\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * Money a customer paid against their account (dues of credit sales). Append-only.
 *
 * @property string $id
 * @property string $branch_id
 * @property string $customer_id
 * @property string $number
 * @property string $currency
 * @property string $amount
 * @property string $method
 * @property ?string $reference
 * @property ?string $notes
 * @property ?string $created_by
 * @property Carbon $created_at
 */
#[Table(timestamps: false)]
#[Fillable(['organization_id', 'branch_id', 'customer_id', 'number', 'currency', 'amount', 'method', 'reference', 'notes', 'created_by', 'created_at'])]
class CustomerPayment extends Model
{
    use AppendOnly, BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return [
            'amount' => 'decimal:2',
            'created_at' => 'datetime',
        ];
    }
}
