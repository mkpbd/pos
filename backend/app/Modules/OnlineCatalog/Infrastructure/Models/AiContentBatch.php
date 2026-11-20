<?php

namespace App\Modules\OnlineCatalog\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * AI2a: one "write drafts" run of the AI writer over many products, categories or brands.
 *
 * @property string $id
 * @property string $organization_id
 * @property ?string $created_by
 * @property string $subject product | category | brand
 * @property array{missing: ?list<string>, ids: list<string>} $criteria
 * @property list<string> $fields
 * @property list<string> $languages
 * @property string $tone
 * @property string $length
 * @property ?string $notes
 * @property int $total subjects
 * @property int $done subjects written
 * @property int $failed subjects that failed
 * @property string $status queued | running | done | cancelled | budget_stopped
 * @property ?CarbonImmutable $created_at
 * @property ?CarbonImmutable $updated_at
 */
#[Fillable(['organization_id', 'created_by', 'subject', 'criteria', 'fields', 'languages', 'tone', 'length', 'notes', 'total', 'done', 'failed', 'status'])]
class AiContentBatch extends Model
{
    use BelongsToOrganization, HasUuids;

    public const STATUSES = ['queued', 'running', 'done', 'cancelled', 'budget_stopped'];

    public const ACTIVE = ['queued', 'running'];

    protected function casts(): array
    {
        return [
            'criteria' => 'array',
            'fields' => 'array',
            'languages' => 'array',
            'total' => 'integer',
            'done' => 'integer',
            'failed' => 'integer',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return HasMany<AiContentDraft, $this>
     */
    public function drafts(): HasMany
    {
        return $this->hasMany(AiContentDraft::class, 'batch_id');
    }

    public function isActive(): bool
    {
        return in_array($this->status, self::ACTIVE, true);
    }
}
