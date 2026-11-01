<?php

namespace App\Modules\OnlineCatalog\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\ChangesStorefrontContent;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * @property string $id
 * @property string $variant_id
 * @property ?string $compare_at_price
 * @property ?string $image_id
 */
#[Fillable(['organization_id', 'variant_id', 'compare_at_price', 'image_id'])]
class VariantListing extends Model
{
    use BelongsToOrganization, ChangesStorefrontContent, HasUuids;

    protected function casts(): array
    {
        return ['compare_at_price' => 'decimal:2'];
    }
}
