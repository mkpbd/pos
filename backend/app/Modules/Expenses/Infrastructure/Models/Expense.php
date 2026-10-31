<?php

namespace App\Modules\Expenses\Infrastructure\Models;

use App\Modules\Expenses\Domain\EntryType;
use App\Modules\Payments\Domain\PaymentMethod;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;
use LogicException;

/**
 * An expense or other-income entry. Immutable; voiding is the only change it sees.
 *
 * @property string $id
 * @property string $branch_id
 * @property EntryType $type
 * @property string $number
 * @property string $expense_category_id
 * @property string $currency
 * @property string $amount
 * @property PaymentMethod $method
 * @property ?string $reference
 * @property ?string $party
 * @property Carbon $occurred_on
 * @property ?string $notes
 * @property ?string $created_by
 * @property ?Carbon $voided_at
 * @property ?string $voided_by
 * @property ?string $void_reason
 * @property Carbon $created_at
 */
#[Fillable([
    'organization_id', 'branch_id', 'type', 'number', 'expense_category_id', 'currency', 'amount', 'method', 'reference',
    'party', 'occurred_on', 'notes', 'created_by', 'voided_at', 'voided_by', 'void_reason',
])]
class Expense extends Model
{
    use BelongsToOrganization, HasUuids;

    private const MUTABLE = ['voided_at', 'voided_by', 'void_reason', 'updated_at'];

    protected function casts(): array
    {
        return [
            'type' => EntryType::class,
            'amount' => 'decimal:2',
            'method' => PaymentMethod::class,
            'occurred_on' => 'date',
            'voided_at' => 'datetime',
        ];
    }

    protected static function booted(): void
    {
        static::updating(function (Expense $expense) {
            if ($expense->getOriginal('voided_at') !== null || array_diff(array_keys($expense->getDirty()), self::MUTABLE) !== []) {
                throw new LogicException('Expense entries are immutable; only voiding can be recorded.');
            }
        });
        static::deleting(fn () => throw new LogicException('Expense entries cannot be deleted.'));
    }

    /**
     * @return BelongsTo<ExpenseCategory, $this>
     */
    public function category(): BelongsTo
    {
        return $this->belongsTo(ExpenseCategory::class, 'expense_category_id');
    }
}
