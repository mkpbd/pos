<?php

namespace App\Modules\Storefront\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * A record shown by a section, in order. `item_type` is `banner` for now.
 *
 * @property string $id
 * @property string $section_id
 * @property string $item_type
 * @property string $item_id
 * @property int $sort_order
 */
#[Fillable(['organization_id', 'section_id', 'item_type', 'item_id', 'sort_order'])]
class HomepageSectionItem extends Model
{
    use BelongsToOrganization, HasUuids;

    public const TYPE_BANNER = 'banner';

    protected function casts(): array
    {
        return ['sort_order' => 'integer'];
    }
}
