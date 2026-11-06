<?php

namespace App\Modules\AI\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * A cached business insight: deterministic facts for one organization scope (all branches or one
 * branch), period and day, plus the model's narrative of them (NULL when AI was unavailable).
 *
 * @property string $id
 * @property string $organization_id
 * @property string $scope_key
 * @property ?string $branch_id
 * @property string $period
 * @property CarbonImmutable $period_date
 * @property bool $with_cost
 * @property array<string, mixed> $facts
 * @property ?string $narrative
 * @property string $narrative_status
 * @property ?string $model
 * @property int $input_tokens
 * @property int $output_tokens
 * @property CarbonImmutable $generated_at
 */
#[Table('ai_insights')]
#[Fillable(['organization_id', 'scope_key', 'branch_id', 'period', 'period_date', 'with_cost', 'facts', 'narrative', 'narrative_status', 'model', 'input_tokens', 'output_tokens', 'generated_at'])]
class AiInsight extends Model
{
    use BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return [
            'period_date' => 'immutable_date',
            'with_cost' => 'boolean',
            'facts' => 'array',
            'input_tokens' => 'integer',
            'output_tokens' => 'integer',
            'generated_at' => 'immutable_datetime',
        ];
    }
}
