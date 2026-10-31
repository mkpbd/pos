<?php

namespace App\Modules\Storefront\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use App\Modules\Storefront\Domain\MenuItemType;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * @property string $id
 * @property string $menu_id
 * @property ?string $parent_id
 * @property MenuItemType $type
 * @property string $label
 * @property ?string $url
 * @property bool $open_in_new_tab
 * @property bool $is_visible
 * @property bool $is_mega
 * @property ?int $mega_columns
 * @property ?string $image_media_id
 * @property int $sort_order
 */
#[Fillable(['organization_id', 'menu_id', 'parent_id', 'type', 'label', 'url', 'open_in_new_tab', 'is_visible', 'is_mega', 'mega_columns', 'image_media_id', 'sort_order'])]
class MenuItem extends Model
{
    use BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return [
            'type' => MenuItemType::class,
            'open_in_new_tab' => 'boolean',
            'is_visible' => 'boolean',
            'is_mega' => 'boolean',
            'mega_columns' => 'integer',
            'sort_order' => 'integer',
        ];
    }
}
