<?php

namespace App\Modules\Suppliers\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\TracksAuthor;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * @property string $id
 * @property string $code
 * @property string $name
 * @property ?string $contact_person
 * @property ?string $email
 * @property ?string $phone
 * @property ?string $address
 * @property ?string $tax_number
 * @property int $payment_terms_days
 * @property string $opening_balance
 * @property ?string $notes
 * @property bool $is_active
 */
#[Fillable([
    'organization_id', 'code', 'name', 'contact_person', 'email', 'phone', 'address', 'tax_number',
    'payment_terms_days', 'opening_balance', 'notes', 'is_active',
])]
class Supplier extends Model
{
    use BelongsToOrganization, HasUuids, SoftDeletes, TracksAuthor;

    protected $attributes = [
        'payment_terms_days' => 0,
        'opening_balance' => '0',
        'is_active' => true,
    ];

    protected function casts(): array
    {
        return [
            'payment_terms_days' => 'integer',
            'opening_balance' => 'decimal:2',
            'is_active' => 'boolean',
        ];
    }
}
