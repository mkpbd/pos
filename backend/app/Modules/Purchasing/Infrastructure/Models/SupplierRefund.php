<?php

namespace App\Modules\Purchasing\Infrastructure\Models;

use App\Modules\Purchasing\Domain\PaymentMethod;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * ST1: money a supplier gave back (overpayment, credit for returned goods). Raises what we
 * owe the supplier again, like reversing an earlier payment. Immutable except for the void marker.
 *
 * @property string $id
 * @property string $number
 * @property string $supplier_id
 * @property string $branch_id
 * @property string $currency
 * @property string $amount
 * @property PaymentMethod $method
 * @property ?string $reference
 * @property Carbon $received_on
 * @property ?string $notes
 * @property ?string $created_by
 * @property ?Carbon $created_at
 * @property ?Carbon $voided_at
 * @property ?string $voided_by
 * @property ?string $void_reason
 */
#[Fillable(['organization_id', 'number', 'supplier_id', 'branch_id', 'currency', 'amount', 'method', 'reference', 'received_on', 'notes', 'created_by', 'voided_at', 'voided_by', 'void_reason'])]
class SupplierRefund extends Model
{
    use BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return [
            'amount' => 'decimal:2',
            'method' => PaymentMethod::class,
            'received_on' => 'date',
            'voided_at' => 'datetime',
        ];
    }
}
