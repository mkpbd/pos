<?php

namespace App\Modules\Products\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * ST2c: the selling price of a variant at one branch (replaces `selling_price` at its tills).
 *
 * @property string $id
 * @property string $variant_id
 * @property string $branch_id
 * @property string $price
 */
#[Fillable(['organization_id', 'variant_id', 'branch_id', 'price'])]
class ProductBranchPrice extends Model
{
    use BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return ['price' => 'decimal:2'];
    }
}
