<?php

namespace App\Modules\Loyalty\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * A customer's points balance; only ever changed together with a ledger transaction.
 *
 * @property string $id
 * @property string $customer_id
 * @property int $balance
 * @property int $lifetime_earned
 * @property int $lifetime_redeemed
 */
#[Fillable(['organization_id', 'customer_id', 'balance', 'lifetime_earned', 'lifetime_redeemed'])]
class LoyaltyAccount extends Model
{
    use BelongsToOrganization, HasUuids;

    protected $attributes = [
        'balance' => 0,
        'lifetime_earned' => 0,
        'lifetime_redeemed' => 0,
    ];

    protected function casts(): array
    {
        return [
            'balance' => 'integer',
            'lifetime_earned' => 'integer',
            'lifetime_redeemed' => 'integer',
        ];
    }
}
