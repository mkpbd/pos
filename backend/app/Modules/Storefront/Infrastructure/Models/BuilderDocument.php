<?php

namespace App\Modules\Storefront\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\ChangesStorefrontContent;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A store builder document (B1): an editable draft and a pointer to its published version.
 * `key` is `home` or `landing:<slug>` for pages (later `cms:<id>`, `header`, `footer`, …).
 *
 * Only what shoppers can see bumps the storefront content version: publishing (the pointer),
 * the title of a published document, deleting a published document. Draft saves do not.
 *
 * @property string $id
 * @property string $organization_id
 * @property string $kind
 * @property string $key
 * @property string $title
 * @property int $schema_version
 * @property array<string, mixed> $draft
 * @property int $draft_revision
 * @property ?CarbonImmutable $draft_updated_at
 * @property ?string $draft_updated_by
 * @property ?string $published_version_id
 * @property ?BuilderVersion $publishedVersion
 */
#[Fillable(['organization_id', 'kind', 'key', 'title', 'schema_version', 'draft', 'draft_revision', 'draft_updated_at', 'draft_updated_by', 'published_version_id'])]
class BuilderDocument extends Model
{
    use BelongsToOrganization, ChangesStorefrontContent, HasUuids;

    public const KIND_PAGE = 'page';

    public const HOME = 'home';

    public const LANDING_PREFIX = 'landing:';

    protected $attributes = [
        'draft' => '{}',
        'schema_version' => 1,
        'draft_revision' => 0,
    ];

    protected function casts(): array
    {
        return [
            'draft' => 'array',
            'schema_version' => 'integer',
            'draft_revision' => 'integer',
            'draft_updated_at' => 'immutable_datetime',
            'created_at' => 'immutable_datetime',
            'updated_at' => 'immutable_datetime',
        ];
    }

    /**
     * @return BelongsTo<BuilderVersion, $this>
     */
    public function publishedVersion(): BelongsTo
    {
        return $this->belongsTo(BuilderVersion::class, 'published_version_id');
    }

    /**
     * @return HasMany<BuilderVersion, $this>
     */
    public function versions(): HasMany
    {
        return $this->hasMany(BuilderVersion::class, 'document_id');
    }

    public function isHome(): bool
    {
        return $this->key === self::HOME;
    }

    /**
     * The landing page slug, or null for other documents.
     */
    public function landingSlug(): ?string
    {
        return str_starts_with($this->key, self::LANDING_PREFIX) ? substr($this->key, strlen(self::LANDING_PREFIX)) : null;
    }

    protected function affectsStorefront(): bool
    {
        if (! $this->exists) {
            // Deleted: only a published document was on the storefront.
            return $this->published_version_id !== null;
        }

        return $this->wasChanged('published_version_id') || ($this->published_version_id !== null && $this->wasChanged('title'));
    }
}
