<?php

namespace App\Modules\Storefront\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * An organization's own store builder template (B5: "save section as template"; scope
 * `section`). `content` is `{description, context, allowed_in, section}` with the section in the
 * normalized document format, referring to the organization's own media and banners. The
 * built-in templates are files (BuilderTemplateLibrary), not rows.
 *
 * @property string $id
 * @property ?string $organization_id
 * @property string $scope
 * @property ?string $preset
 * @property string $name
 * @property ?string $thumbnail_media_id
 * @property array<string, mixed> $content
 * @property ?CarbonImmutable $created_at
 */
#[Fillable(['organization_id', 'scope', 'preset', 'name', 'thumbnail_media_id', 'content'])]
class BuilderTemplate extends Model
{
    use BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return [
            'content' => 'array',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }
}
