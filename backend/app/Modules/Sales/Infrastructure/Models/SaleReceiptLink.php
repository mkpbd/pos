<?php

namespace App\Modules\Sales\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * POS1d: the public link of a sale's digital receipt — one per sale, made on first need and
 * reused. The token is random and URL-safe; whoever has it may read the receipt.
 *
 * @property string $id
 * @property string $organization_id
 * @property string $sale_id
 * @property string $token
 * @property Carbon $created_at
 */
#[Table(timestamps: false)]
#[Fillable(['organization_id', 'sale_id', 'token', 'created_at'])]
class SaleReceiptLink extends Model
{
    use BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return [
            'created_at' => 'datetime',
        ];
    }
}
