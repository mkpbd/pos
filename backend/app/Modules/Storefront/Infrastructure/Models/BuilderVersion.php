<?php

namespace App\Modules\Storefront\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * An immutable published snapshot of a builder document (B1), numbered 1..n per document.
 * B11: or a draft checkpoint (`kind` checkpoint) — a named, unpublished snapshot of the draft
 * without a number (restored like a version); versions and checkpoints carry an editable
 * `name`; `via` says how a version went live (manual | scheduled | review).
 *
 * @property string $id
 * @property string $organization_id
 * @property string $document_id
 * @property string $kind
 * @property ?int $number null for checkpoints
 * @property ?string $name
 * @property ?string $via
 * @property int $schema_version
 * @property array<string, mixed> $content
 * @property ?string $note
 * @property ?CarbonImmutable $published_at
 * @property ?string $created_by
 * @property ?CarbonImmutable $created_at
 */
#[Fillable(['organization_id', 'document_id', 'kind', 'number', 'name', 'via', 'schema_version', 'content', 'note', 'published_at', 'created_by'])]
class BuilderVersion extends Model
{
    use BelongsToOrganization, HasUuids;

    public const KIND_VERSION = 'version';

    /** B11: a named, unpublished snapshot of the draft. */
    public const KIND_CHECKPOINT = 'checkpoint';

    public const VIA_MANUAL = 'manual';

    public const VIA_SCHEDULED = 'scheduled';

    public const VIA_REVIEW = 'review';

    protected $attributes = [
        'kind' => self::KIND_VERSION,
    ];

    public function isCheckpoint(): bool
    {
        return $this->kind === self::KIND_CHECKPOINT;
    }

    /**
     * B11: published versions only (not checkpoints).
     *
     * @param  Builder<BuilderVersion>  $query
     */
    public function scopePublishedOnly(Builder $query): void
    {
        $query->where('kind', self::KIND_VERSION);
    }

    public const UPDATED_AT = null;

    protected function casts(): array
    {
        return [
            'content' => 'array',
            'number' => 'integer',
            'schema_version' => 'integer',
            'published_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return BelongsTo<BuilderDocument, $this>
     */
    public function document(): BelongsTo
    {
        return $this->belongsTo(BuilderDocument::class, 'document_id');
    }
}
