<?php

namespace App\Modules\Products\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\ChangesStorefrontContent;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * The sellable unit of a product. Prices are decimal strings (NUMERIC), never floats.
 *
 * @property string $id
 * @property string $product_id
 * @property string $sku
 * @property ?string $name
 * @property array<string, string> $option_values
 * @property string $purchase_price
 * @property string $selling_price
 * @property ?string $wholesale_price
 * @property string $reorder_level
 * @property bool $is_active
 * @property int $sort_order
 */
#[Fillable([
    'organization_id', 'product_id', 'sku', 'name', 'option_values', 'purchase_price', 'selling_price',
    'wholesale_price', 'reorder_level', 'is_active', 'sort_order',
])]
class ProductVariant extends Model
{
    use BelongsToOrganization, ChangesStorefrontContent, HasUuids, SoftDeletes;

    protected $attributes = [
        'option_values' => '{}',
        'reorder_level' => '0',
        'is_active' => true,
        'sort_order' => 0,
    ];

    protected function casts(): array
    {
        return [
            'option_values' => 'array',
            'purchase_price' => 'decimal:2',
            'selling_price' => 'decimal:2',
            'wholesale_price' => 'decimal:2',
            'reorder_level' => 'decimal:3',
            'is_active' => 'boolean',
            'sort_order' => 'integer',
        ];
    }

    /**
     * @return BelongsTo<Product, $this>
     */
    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }

    /**
     * @return HasMany<ProductBarcode, $this>
     */
    public function barcodes(): HasMany
    {
        return $this->hasMany(ProductBarcode::class, 'variant_id');
    }
}
