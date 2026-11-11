<?php

namespace App\Modules\Storefront\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * An immutable published snapshot of a builder document (B1), numbered 1..n per document.
 *
 * @property string $id
 * @property string $organization_id
 * @property string $document_id
 * @property int $number
 * @property int $schema_version
 * @property array<string, mixed> $content
 * @property ?string $note
 * @property ?CarbonImmutable $published_at
 * @property ?string $created_by
 * @property ?CarbonImmutable $created_at
 */
#[Fillable(['organization_id', 'document_id', 'number', 'schema_version', 'content', 'note', 'published_at', 'created_by'])]
class BuilderVersion extends Model
{
    use BelongsToOrganization, HasUuids;

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
