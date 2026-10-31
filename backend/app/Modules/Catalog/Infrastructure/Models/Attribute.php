<?php

namespace App\Modules\Catalog\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\TracksAuthor;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A dictionary entry for a product option name ("Size", "Colour").
 *
 * @property string $id
 * @property string $organization_id
 * @property string $name
 * @property string $slug
 * @property string $display text | swatch | button
 * @property bool $is_filterable
 * @property int $sort_order
 */
#[Fillable(['organization_id', 'name', 'slug', 'display', 'is_filterable', 'sort_order'])]
class Attribute extends Model
{
    use BelongsToOrganization, HasUuids, TracksAuthor;

    public const DISPLAYS = ['text', 'swatch', 'button'];

    protected $table = 'attributes';

    protected $attributes = [
        'display' => 'button',
        'is_filterable' => true,
        'sort_order' => 0,
    ];

    protected function casts(): array
    {
        return [
            'is_filterable' => 'boolean',
            'sort_order' => 'integer',
        ];
    }

    /**
     * @return HasMany<AttributeValue, $this>
     */
    public function attributeValues(): HasMany
    {
        return $this->hasMany(AttributeValue::class)->orderBy('sort_order');
    }
}
