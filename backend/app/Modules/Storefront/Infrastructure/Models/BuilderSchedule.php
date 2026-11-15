<?php

namespace App\Modules\Storefront\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * B11: "publish later" — a snapshot of a builder document's draft (or of the theme draft) that
 * the scheduler publishes at `publish_at` (storefront:publish-scheduled). One pending schedule per
 * document; `pending` → `done` (with the version) | `failed` (with `failure {code, message,
 * errors?}`) | `cancelled` (by hand, or replaced by a newer schedule). `review_id`: approved for
 * later from a review.
 *
 * @property string $id
 * @property string $organization_id
 * @property string $document_id
 * @property string $status
 * @property CarbonImmutable $publish_at
 * @property ?string $note
 * @property int $schema_version
 * @property array<string, mixed> $content
 * @property int $draft_revision
 * @property ?string $review_id
 * @property ?string $created_by
 * @property ?string $cancelled_by
 * @property ?array{code: string, message: string, errors?: list<array<string, mixed>>} $failure
 * @property ?string $version_id
 * @property ?CarbonImmutable $finished_at
 * @property ?CarbonImmutable $created_at
 * @property ?BuilderDocument $document
 * @property ?BuilderVersion $version
 */
#[Fillable(['organization_id', 'document_id', 'status', 'publish_at', 'note', 'schema_version', 'content', 'draft_revision', 'review_id', 'created_by', 'cancelled_by', 'failure', 'version_id', 'finished_at'])]
class BuilderSchedule extends Model
{
    use BelongsToOrganization, HasUuids;

    public const PENDING = 'pending';

    public const DONE = 'done';

    public const FAILED = 'failed';

    public const CANCELLED = 'cancelled';

    /** Publishing can be scheduled at most this many days ahead. */
    public const MAX_DAYS_AHEAD = 365;

    protected function casts(): array
    {
        return [
            'publish_at' => 'immutable_datetime',
            'content' => 'array',
            'failure' => 'array',
            'schema_version' => 'integer',
            'draft_revision' => 'integer',
            'finished_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return BelongsTo<BuilderDocument, $this>
     */
    public function document(): BelongsTo
    {
        return $this->belongsTo(BuilderDocument::class, 'document_id');
    }

    /**
     * @return BelongsTo<BuilderVersion, $this>
     */
    public function version(): BelongsTo
    {
        return $this->belongsTo(BuilderVersion::class, 'version_id');
    }
}
