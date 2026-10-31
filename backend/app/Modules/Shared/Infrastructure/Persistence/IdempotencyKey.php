<?php

namespace App\Modules\Shared\Infrastructure\Persistence;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\MassPrunable;
use Illuminate\Database\Eloquent\Model;

/**
 * Stored outcome of an idempotent request; see EnsureIdempotency.
 *
 * @property string $id
 * @property string $user_id
 * @property string $key
 * @property string $fingerprint
 * @property string $status
 * @property ?int $response_status
 * @property ?string $response_body
 */
class IdempotencyKey extends Model
{
    use HasUuids, MassPrunable;

    public const RETENTION_HOURS = 24;

    protected $guarded = [];

    /**
     * @return Builder<self>
     */
    public function prunable(): Builder
    {
        return static::query()->where('created_at', '<', now()->subHours(self::RETENTION_HOURS));
    }
}
