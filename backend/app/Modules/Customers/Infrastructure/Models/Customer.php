<?php

namespace App\Modules\Customers\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\TracksAuthor;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Registered customer. Sales without a customer are walk-in sales.
 *
 * @property string $id
 * @property ?string $customer_group_id
 * @property string $code
 * @property string $name
 * @property ?string $phone
 * @property ?string $email
 * @property ?string $address
 * @property ?string $tax_number
 * @property string $credit_limit
 * @property string $opening_balance
 * @property ?string $notes
 * @property bool $is_active
 */
#[Fillable([
    'organization_id', 'customer_group_id', 'code', 'name', 'phone', 'email', 'address', 'tax_number',
    'credit_limit', 'opening_balance', 'notes', 'is_active',
])]
class Customer extends Model
{
    use BelongsToOrganization, HasUuids, SoftDeletes, TracksAuthor;

    protected $attributes = [
        'credit_limit' => '0',
        'opening_balance' => '0',
        'is_active' => true,
    ];

    protected function casts(): array
    {
        return [
            'credit_limit' => 'decimal:2',
            'opening_balance' => 'decimal:2',
            'is_active' => 'boolean',
        ];
    }

    /**
     * @return BelongsTo<CustomerGroup, $this>
     */
    public function group(): BelongsTo
    {
        return $this->belongsTo(CustomerGroup::class, 'customer_group_id');
    }
}
