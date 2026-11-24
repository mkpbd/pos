<?php

namespace App\Modules\Purchasing\Infrastructure\Models;

use App\Modules\Purchasing\Domain\PaymentMethod;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * Money paid to a supplier. Immutable except for the void marker (ST1): a void books the
 * opposite ledger entry and keeps the row.
 *
 * @property string $id
 * @property string $number
 * @property string $supplier_id
 * @property ?string $branch_id NULL only on payments recorded before ST1 (not in the ledger)
 * @property string $currency
 * @property string $amount
 * @property PaymentMethod $method
 * @property ?string $reference
 * @property Carbon $paid_on
 * @property ?string $notes
 * @property ?string $created_by
 * @property ?Carbon $created_at
 * @property ?Carbon $voided_at
 * @property ?string $voided_by
 * @property ?string $void_reason
 */
#[Fillable(['organization_id', 'number', 'supplier_id', 'branch_id', 'currency', 'amount', 'method', 'reference', 'paid_on', 'notes', 'created_by', 'voided_at', 'voided_by', 'void_reason'])]
class SupplierPayment extends Model
{
    use BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return [
            'amount' => 'decimal:2',
            'method' => PaymentMethod::class,
            'paid_on' => 'date',
            'voided_at' => 'datetime',
        ];
    }
}
