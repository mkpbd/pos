<?php

namespace App\Modules\Payments\Infrastructure\Models;

use App\Modules\Payments\Domain\SessionStatus;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;
use LogicException;

/**
 * A shift on a register: opened with a cash float, closed with a cash count.
 * Once closed it is a historical record and never changes again.
 *
 * @property string $id
 * @property string $branch_id
 * @property string $cash_register_id
 * @property string $number
 * @property SessionStatus $status
 * @property string $currency
 * @property string $opening_float
 * @property string $opened_by
 * @property Carbon $opened_at
 * @property ?string $expected_cash
 * @property ?string $counted_cash
 * @property ?string $variance
 * @property ?string $closing_notes
 * @property ?string $closed_by
 * @property ?Carbon $closed_at
 */
#[Table(name: 'cash_register_sessions')]
#[Fillable([
    'organization_id', 'branch_id', 'cash_register_id', 'number', 'status', 'currency', 'opening_float', 'opened_by', 'opened_at',
    'expected_cash', 'counted_cash', 'variance', 'closing_notes', 'closed_by', 'closed_at',
])]
class RegisterSession extends Model
{
    use BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return [
            'status' => SessionStatus::class,
            'opening_float' => 'decimal:2',
            'expected_cash' => 'decimal:2',
            'counted_cash' => 'decimal:2',
            'variance' => 'decimal:2',
            'opened_at' => 'datetime',
            'closed_at' => 'datetime',
        ];
    }

    protected static function booted(): void
    {
        static::updating(function (RegisterSession $session) {
            if ($session->getOriginal('status') === SessionStatus::Closed) {
                throw new LogicException('Closed register sessions cannot change.');
            }
        });
        static::deleting(fn () => throw new LogicException('Register sessions cannot be deleted.'));
    }

    /**
     * @return BelongsTo<CashRegister, $this>
     */
    public function register(): BelongsTo
    {
        return $this->belongsTo(CashRegister::class, 'cash_register_id');
    }
}
