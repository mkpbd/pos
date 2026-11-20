<?php

namespace App\Modules\Storefront\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Table;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

/**
 * B16: one staff member's draft saves of a builder document, merged while the gap between saves
 * is at most 15 minutes — "Rima edited the draft (12 saves, 3:10–3:40 PM)" in the activity log.
 *
 * @property string $id
 * @property string $organization_id
 * @property string $document_id
 * @property ?string $user_id
 * @property CarbonImmutable $started_at
 * @property CarbonImmutable $ended_at
 * @property int $saves
 * @property ?int $first_revision
 * @property ?int $last_revision
 */
#[Table(timestamps: false)]
#[Fillable(['organization_id', 'document_id', 'user_id', 'started_at', 'ended_at', 'saves', 'first_revision', 'last_revision'])]
class BuilderEditSession extends Model
{
    use BelongsToOrganization, HasUuids;

    /** A save within this many minutes of the last one continues the session. */
    public const GAP_MINUTES = 15;

    protected function casts(): array
    {
        return [
            'started_at' => 'immutable_datetime',
            'ended_at' => 'immutable_datetime',
            'saves' => 'integer',
            'first_revision' => 'integer',
            'last_revision' => 'integer',
        ];
    }
}
