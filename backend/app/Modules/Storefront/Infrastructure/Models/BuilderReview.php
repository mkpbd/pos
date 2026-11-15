<?php

namespace App\Modules\Storefront\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasOne;

/**
 * B11: "submit for review" — a snapshot of a builder document's draft waiting for someone who
 * may publish. One pending review per document; `pending` → `approved` (published now: the
 * version; or later: a schedule with this review) | `sent_back` (with a comment) | `withdrawn`
 * (by the submitter or a publisher, or replaced by a newer submission).
 *
 * @property string $id
 * @property string $organization_id
 * @property string $document_id
 * @property string $status
 * @property ?string $note
 * @property int $schema_version
 * @property array<string, mixed> $content
 * @property int $draft_revision
 * @property ?string $submitted_by
 * @property ?string $decided_by
 * @property ?CarbonImmutable $decided_at
 * @property ?string $comment
 * @property ?string $version_id
 * @property ?CarbonImmutable $created_at
 * @property ?BuilderDocument $document
 * @property ?BuilderVersion $version
 * @property ?BuilderSchedule $schedule
 */
#[Fillable(['organization_id', 'document_id', 'status', 'note', 'schema_version', 'content', 'draft_revision', 'submitted_by', 'decided_by', 'decided_at', 'comment', 'version_id'])]
class BuilderReview extends Model
{
    use BelongsToOrganization, HasUuids;

    public const PENDING = 'pending';

    public const APPROVED = 'approved';

    public const SENT_BACK = 'sent_back';

    public const WITHDRAWN = 'withdrawn';

    public const STATUSES = [self::PENDING, self::APPROVED, self::SENT_BACK, self::WITHDRAWN];

    protected function casts(): array
    {
        return [
            'content' => 'array',
            'schema_version' => 'integer',
            'draft_revision' => 'integer',
            'decided_at' => 'immutable_datetime',
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

    /**
     * The schedule made when the review was approved for later.
     *
     * @return HasOne<BuilderSchedule, $this>
     */
    public function schedule(): HasOne
    {
        return $this->hasOne(BuilderSchedule::class, 'review_id');
    }
}
