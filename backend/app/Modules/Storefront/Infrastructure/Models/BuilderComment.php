<?php

namespace App\Modules\Storefront\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * B16: a comment pinned on a builder document — a thread (`parent_id` null, numbered per
 * document, resolvable) or a reply in one (one level). Staff only: shoppers never see comments.
 *
 * @property string $id
 * @property string $organization_id
 * @property string $document_id
 * @property ?string $parent_id
 * @property ?int $number
 * @property ?string $node_id
 * @property ?array{x: float, y: float} $anchor
 * @property string $body
 * @property list<string> $mentions user ids
 * @property ?string $author_id
 * @property ?CarbonImmutable $edited_at
 * @property ?CarbonImmutable $resolved_at
 * @property ?string $resolved_by
 * @property CarbonImmutable $created_at
 * @property ?CarbonImmutable $updated_at
 * @property ?CarbonImmutable $deleted_at
 */
#[Fillable(['organization_id', 'document_id', 'parent_id', 'number', 'node_id', 'anchor', 'body', 'mentions', 'author_id', 'edited_at', 'resolved_at', 'resolved_by'])]
class BuilderComment extends Model
{
    use BelongsToOrganization, HasUuids, SoftDeletes;

    public const BODY_MAX = 2000;

    /** The author may change the text this long after posting. */
    public const EDIT_MINUTES = 15;

    protected $attributes = [
        'mentions' => '[]',
    ];

    protected function casts(): array
    {
        return [
            'anchor' => 'array',
            'mentions' => 'array',
            'number' => 'integer',
            'edited_at' => 'immutable_datetime',
            'resolved_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
            'deleted_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return HasMany<BuilderComment, $this>
     */
    public function replies(): HasMany
    {
        return $this->hasMany(self::class, 'parent_id');
    }

    public function isThread(): bool
    {
        return $this->parent_id === null;
    }
}
