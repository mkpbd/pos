<?php

namespace App\Modules\AI\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * AI2b: one shopper assistant conversation of the online store (browser token hash, optional
 * customer). No IP address, user agent or cookie.
 *
 * @property string $id
 * @property string $organization_id
 * @property string $token_hash
 * @property ?string $customer_id
 * @property string $language
 * @property int $message_count
 * @property string $status open | closed
 * @property bool $handed_off
 * @property CarbonImmutable $started_at
 * @property CarbonImmutable $last_message_at
 */
#[Table('assistant_conversations', timestamps: false)]
#[Fillable(['organization_id', 'token_hash', 'customer_id', 'language', 'message_count', 'status', 'handed_off', 'started_at', 'last_message_at'])]
class AssistantConversation extends Model
{
    use BelongsToOrganization, HasUuids;

    public const OPEN = 'open';

    public const CLOSED = 'closed';

    protected $attributes = [
        'language' => 'en',
        'message_count' => 0,
        'status' => self::OPEN,
        'handed_off' => false,
    ];

    protected function casts(): array
    {
        return [
            'message_count' => 'integer',
            'handed_off' => 'boolean',
            'started_at' => 'immutable_datetime',
            'last_message_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return HasMany<AssistantMessage, $this>
     */
    public function messages(): HasMany
    {
        return $this->hasMany(AssistantMessage::class, 'conversation_id');
    }

    public static function hashToken(string $token): string
    {
        return hash('sha256', $token);
    }
}
