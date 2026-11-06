<?php

namespace App\Modules\AI\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * One AI request (usage + audit): who, which feature, which reports / tools with which validated
 * parameters, tokens, model, outcome and duration. Never the prompt, the answer or result rows.
 *
 * @property string $id
 * @property string $organization_id
 * @property ?string $user_id
 * @property string $feature
 * @property ?string $intent
 * @property ?array<int, mixed> $params
 * @property int $input_tokens
 * @property int $output_tokens
 * @property ?string $model
 * @property string $status
 * @property int $duration_ms
 * @property ?string $error_code
 * @property ?string $summary
 */
#[Table('ai_requests', timestamps: false)]
#[Fillable(['organization_id', 'user_id', 'feature', 'intent', 'params', 'input_tokens', 'output_tokens', 'model', 'status', 'duration_ms', 'error_code', 'summary', 'created_at'])]
class AiRequest extends Model
{
    use BelongsToOrganization, HasUuids;

    protected function casts(): array
    {
        return [
            'params' => 'array',
            'input_tokens' => 'integer',
            'output_tokens' => 'integer',
            'duration_ms' => 'integer',
            'created_at' => 'immutable_datetime',
        ];
    }
}
