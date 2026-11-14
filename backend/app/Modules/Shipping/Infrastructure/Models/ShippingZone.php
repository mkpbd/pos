<?php

namespace App\Modules\Shipping\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\ChangesStorefrontContent;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\TracksAuthor;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A delivery zone: a named set of districts with its delivery methods. P1b: the product page's
 * delivery note shows the zones, so writes refresh the storefront cache.
 *
 * @property string $id
 * @property string $organization_id
 * @property string $name
 * @property bool $is_active
 * @property int $sort_order
 */
#[Fillable(['organization_id', 'name', 'is_active', 'sort_order'])]
class ShippingZone extends Model
{
    use BelongsToOrganization, ChangesStorefrontContent, HasUuids, TracksAuthor;

    protected $attributes = [
        'is_active' => true,
        'sort_order' => 0,
    ];

    protected function casts(): array
    {
        return ['is_active' => 'boolean', 'sort_order' => 'integer'];
    }

    /**
     * @return HasMany<ShippingZoneDistrict, $this>
     */
    public function districts(): HasMany
    {
        return $this->hasMany(ShippingZoneDistrict::class, 'zone_id');
    }

    /**
     * @return HasMany<ShippingMethod, $this>
     */
    public function methods(): HasMany
    {
        return $this->hasMany(ShippingMethod::class, 'zone_id')->orderBy('sort_order')->orderBy('name');
    }
}
