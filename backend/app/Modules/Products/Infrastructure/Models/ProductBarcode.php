<?php

namespace App\Modules\Products\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * @property string $id
 * @property string $variant_id
 * @property string $barcode
 * @property string $units ST2c: base units one scan adds ('1.000' for a unit barcode)
 * @property ?string $pack_name ST2c: e.g. "Carton" when units > 1
 */
#[Fillable(['organization_id', 'variant_id', 'barcode', 'units', 'pack_name'])]
class ProductBarcode extends Model
{
    use BelongsToOrganization, HasUuids;

    protected $attributes = ['units' => '1'];

    protected function casts(): array
    {
        return ['units' => 'decimal:3'];
    }

    /**
     * @return BelongsTo<ProductVariant, $this>
     */
    public function variant(): BelongsTo
    {
        return $this->belongsTo(ProductVariant::class, 'variant_id');
    }
}
