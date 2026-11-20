<?php

namespace App\Modules\OnlineCatalog\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * AI2a: the AI's proposed texts for one subject in one language, waiting for staff review.
 * Nothing in a draft is on the listing until staff approve it.
 *
 * @property string $id
 * @property string $organization_id
 * @property string $batch_id
 * @property string $subject product | category | brand
 * @property string $subject_id
 * @property string $subject_name
 * @property string $language en | bn
 * @property array<string, array{proposed: string, base_hash: string}> $fields
 * @property ?list<string> $missing_info
 * @property string $status pending | approved | rejected | failed | stale
 * @property ?string $error
 * @property ?string $reviewed_by
 * @property ?CarbonImmutable $reviewed_at
 * @property ?CarbonImmutable $created_at
 * @property ?CarbonImmutable $updated_at
 */
#[Fillable(['organization_id', 'batch_id', 'subject', 'subject_id', 'subject_name', 'language', 'fields', 'missing_info', 'status', 'error', 'reviewed_by', 'reviewed_at'])]
class AiContentDraft extends Model
{
    use BelongsToOrganization, HasUuids;

    public const STATUSES = ['pending', 'approved', 'rejected', 'failed', 'stale'];

    /** Drafts staff can still approve or reject. */
    public const OPEN = ['pending', 'stale'];

    /** Drafts are deleted this many days after they were written. */
    public const KEEP_DAYS = 30;

    protected function casts(): array
    {
        return [
            'fields' => 'array',
            'missing_info' => 'array',
            'reviewed_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return BelongsTo<AiContentBatch, $this>
     */
    public function batch(): BelongsTo
    {
        return $this->belongsTo(AiContentBatch::class, 'batch_id');
    }
}
