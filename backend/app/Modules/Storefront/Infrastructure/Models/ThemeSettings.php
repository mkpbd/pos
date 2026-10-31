<?php

namespace App\Modules\Storefront\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\TracksAuthor;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * @property string $id
 * @property string $organization_id
 * @property array<string, mixed> $settings normalized by Domain\ThemeSchema
 * @property ?string $custom_css
 */
#[Fillable(['organization_id', 'settings', 'custom_css'])]
class ThemeSettings extends Model
{
    use BelongsToOrganization, HasUuids, TracksAuthor;

    protected $table = 'theme_settings';

    protected $attributes = [
        'settings' => '{}',
    ];

    protected function casts(): array
    {
        return ['settings' => 'array'];
    }
}
