<?php

namespace App\Modules\Products\Infrastructure\Models;

use App\Modules\Products\Domain\ProductType;
use App\Modules\Products\Infrastructure\Database\Factories\ProductFactory;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\ChangesStorefrontContent;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\TracksAuthor;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\UseFactory;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * @property string $id
 * @property string $organization_id
 * @property ?string $category_id
 * @property ?string $brand_id
 * @property string $unit_id
 * @property ?string $tax_rate_id
 * @property string $name
 * @property ?string $description
 * @property ProductType $type
 * @property bool $track_stock
 * @property bool $track_batches
 * @property bool $track_serials
 * @property ?string $max_discount_percent
 * @property ?list<array{name: string, values: list<string>}> $options
 * @property bool $is_active
 * @property ?string $photo_option P1a: the option whose values own photos
 * @property ?array<string, string> $option_styles P1a: option name => color|image|button
 */
#[UseFactory(ProductFactory::class)]
#[Fillable([
    'organization_id', 'category_id', 'brand_id', 'unit_id', 'tax_rate_id', 'name', 'description', 'type',
    'track_stock', 'track_batches', 'track_serials', 'max_discount_percent', 'options', 'is_active',
    'photo_option', 'option_styles',
])]
class Product extends Model
{
    /** @use HasFactory<ProductFactory> */
    use BelongsToOrganization, ChangesStorefrontContent, HasFactory, HasUuids, SoftDeletes, TracksAuthor;

    protected $attributes = [
        'type' => 'standard',
        'track_stock' => true,
        'track_batches' => false,
        'track_serials' => false,
        'is_active' => true,
    ];

    protected function casts(): array
    {
        return [
            'type' => ProductType::class,
            'track_stock' => 'boolean',
            'track_batches' => 'boolean',
            'track_serials' => 'boolean',
            'max_discount_percent' => 'decimal:2',
            'options' => 'array',
            'is_active' => 'boolean',
            'option_styles' => 'array',
        ];
    }

    /**
     * P1a: photos of the photo option's values, in order.
     *
     * @return HasMany<ProductOptionImage, $this>
     */
    public function optionImages(): HasMany
    {
        return $this->hasMany(ProductOptionImage::class)->orderBy('option_value')->orderBy('sort_order');
    }

    /**
     * @return HasMany<ProductVariant, $this>
     */
    public function variants(): HasMany
    {
        return $this->hasMany(ProductVariant::class)->orderBy('sort_order');
    }

    /**
     * @return HasMany<ProductImage, $this>
     */
    public function images(): HasMany
    {
        return $this->hasMany(ProductImage::class)->orderBy('sort_order');
    }
}
