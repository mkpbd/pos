<?php

namespace App\Modules\Pos\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * A parked cart, resumed later at a till of the same branch.
 *
 * @property string $id
 * @property string $branch_id
 * @property string $store_id
 * @property ?string $label
 * @property ?string $customer_id
 * @property array<string, mixed> $cart
 * @property int $lines_count
 * @property ?string $created_by
 * @property Carbon $created_at
 */
#[Fillable(['organization_id', 'branch_id', 'store_id', 'label', 'customer_id', 'cart', 'lines_count', 'created_by'])]
class HeldSale extends Model
{
    use BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return ['cart' => 'array'];
    }
}
