<?php

namespace App\Modules\AI\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * AI2b: one message of a shopper assistant conversation — the shopper's text or the cleaned
 * reply with the server-built cards / links / hand-off (`reply`) and the names of the tools used.
 *
 * @property string $id
 * @property string $conversation_id
 * @property string $organization_id
 * @property int $position 1, 2, 3, … within the conversation
 * @property string $role user | assistant
 * @property string $text
 * @property ?list<string> $tools
 * @property ?array{products?: list<array<string, mixed>>, links?: list<array{label: string, path: string}>, handoff?: ?array{type: string, url: string}, found?: list<string>} $reply
 * @property string $status ok | unavailable | limit | budget
 * @property int $input_tokens
 * @property int $output_tokens
 * @property CarbonImmutable $created_at
 */
#[Table('assistant_messages', timestamps: false)]
#[Fillable(['conversation_id', 'organization_id', 'position', 'role', 'text', 'tools', 'reply', 'status', 'input_tokens', 'output_tokens', 'created_at'])]
class AssistantMessage extends Model
{
    use BelongsToOrganization, HasUuids;

    public const USER = 'user';

    public const ASSISTANT = 'assistant';

    protected $attributes = [
        'status' => 'ok',
        'input_tokens' => 0,
        'output_tokens' => 0,
    ];

    protected function casts(): array
    {
        return [
            'position' => 'integer',
            'tools' => 'array',
            'reply' => 'array',
            'input_tokens' => 'integer',
            'output_tokens' => 'integer',
            'created_at' => 'immutable_datetime',
        ];
    }
}
