<?php

namespace App\Modules\Social\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use App\Modules\Social\Domain\PostTarget;
use App\Modules\Social\Domain\TargetStatus;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * P2b: one target of a social post (Facebook or Instagram): its status, the network's id and
 * permalink, the error, the short link the caption carries, whether the sandbox published it,
 * and the claim (a worker sets `publishing` with a conditional update, so a target is posted once).
 *
 * @property string $id
 * @property string $organization_id
 * @property string $post_id
 * @property PostTarget $target
 * @property TargetStatus $status
 * @property ?string $remote_id
 * @property ?string $permalink
 * @property ?string $error_code
 * @property ?string $error_message
 * @property ?string $short_link_id
 * @property bool $sandbox
 * @property int $attempts
 * @property ?CarbonImmutable $claimed_at
 * @property ?CarbonImmutable $published_at
 */
#[Fillable(['organization_id', 'post_id', 'target', 'status', 'remote_id', 'permalink', 'error_code', 'error_message', 'short_link_id', 'sandbox', 'attempts', 'claimed_at', 'published_at'])]
class SocialPostResult extends Model
{
    use BelongsToOrganization, HasUuids;

    protected $attributes = [
        'status' => 'pending',
        'sandbox' => false,
        'attempts' => 0,
    ];

    protected function casts(): array
    {
        return [
            'target' => PostTarget::class,
            'status' => TargetStatus::class,
            'sandbox' => 'boolean',
            'attempts' => 'integer',
            'claimed_at' => 'immutable_datetime',
            'published_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }
}
