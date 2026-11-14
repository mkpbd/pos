<?php

namespace App\Modules\Social\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\TracksAuthor;
use App\Modules\Social\Domain\FeedChannel;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * P2b: a catalog feed (Meta, TikTok or Pinterest) of an organization: its secret token (the
 * public URL's only key, rotatable), whether it answers, and the item count and time of its last
 * generation.
 *
 * @property string $id
 * @property string $organization_id
 * @property FeedChannel $channel
 * @property string $token
 * @property bool $enabled
 * @property ?int $item_count
 * @property ?CarbonImmutable $last_generated_at
 * @property ?CarbonImmutable $updated_at
 */
#[Fillable(['organization_id', 'channel', 'token', 'enabled', 'item_count', 'last_generated_at'])]
class ProductFeed extends Model
{
    use BelongsToOrganization, HasUuids, TracksAuthor;

    protected $attributes = [
        'enabled' => false,
    ];

    protected function casts(): array
    {
        return [
            'channel' => FeedChannel::class,
            'enabled' => 'boolean',
            'item_count' => 'integer',
            'last_generated_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }

    public static function newToken(): string
    {
        return bin2hex(random_bytes(32));
    }
}
