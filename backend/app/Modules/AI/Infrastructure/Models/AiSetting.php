<?php

namespace App\Modules\AI\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * @property string $id
 * @property string $organization_id
 * @property bool $enabled
 * @property ?int $monthly_token_budget
 * @property string $data_sharing_level
 * @property ?string $updated_by
 */
#[Table('ai_settings')]
#[Fillable(['organization_id', 'enabled', 'monthly_token_budget', 'data_sharing_level', 'updated_by'])]
class AiSetting extends Model
{
    use BelongsToOrganization, HasUuids;

    protected $attributes = [
        'enabled' => true,
        'monthly_token_budget' => null,
        'data_sharing_level' => 'aggregates',
    ];

    protected function casts(): array
    {
        return [
            'enabled' => 'boolean',
            'monthly_token_budget' => 'integer',
        ];
    }
}
