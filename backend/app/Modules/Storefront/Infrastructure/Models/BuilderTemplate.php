<?php

namespace App\Modules\Storefront\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * A store builder template (section, page or site; B5). `organization_id` null = built in.
 * Model only in B1.
 *
 * @property string $id
 * @property ?string $organization_id
 * @property string $scope
 * @property ?string $preset
 * @property string $name
 * @property ?string $thumbnail_media_id
 * @property array<string, mixed> $content
 */
#[Fillable(['organization_id', 'scope', 'preset', 'name', 'thumbnail_media_id', 'content'])]
class BuilderTemplate extends Model
{
    use BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return ['content' => 'array'];
    }
}
