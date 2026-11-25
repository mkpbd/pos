<?php

namespace App\Modules\Sales\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * POS1a: a promotion a sale used, as it read at checkout (name, product or order level, the
 * discount it gave). Append-only.
 *
 * @property string $id
 * @property string $sale_id
 * @property string $promotion_id
 * @property string $name
 * @property string $kind product | order
 * @property string $amount
 * @property Carbon $created_at
 */
#[Table(timestamps: false)]
#[Fillable(['organization_id', 'sale_id', 'promotion_id', 'name', 'kind', 'amount', 'created_at'])]
class SalePromotion extends Model
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
