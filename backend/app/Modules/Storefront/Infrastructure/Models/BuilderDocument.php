<?php

namespace App\Modules\Storefront\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\ChangesStorefrontContent;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\Relation;

/**
 * A store builder document (B1): an editable draft and a pointer to its published version.
 * `key` is `home`, `landing:<slug>` or (B4) `cms:<cms page id>` for pages (kind `page`), `header`
 * and `footer` (kinds `header`, `footer`) and `zone:<listing.top|listing.bottom|product.after>`
 * (kind `zone`); `theme` for the theme draft (kind `theme`, B3).
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
 * @property bool $active B8b: a popup's on / off switch (not versioned)
 * @property ?BuilderVersion $publishedVersion
 */
#[Fillable(['organization_id', 'kind', 'key', 'title', 'schema_version', 'draft', 'draft_revision', 'draft_updated_at', 'draft_updated_by', 'published_version_id', 'active'])]
class BuilderDocument extends Model
{
    use BelongsToOrganization, ChangesStorefrontContent, HasUuids;

    public const KIND_PAGE = 'page';

    /** B4: the store header, footer and the shop / product zones. */
    public const KIND_HEADER = 'header';

    public const KIND_FOOTER = 'footer';

    public const KIND_ZONE = 'zone';

    /** B8b: popups and bars (`popup:<uuid>`), switched on and off with `active`. */
    public const KIND_POPUP = 'popup';

    public const POPUP_PREFIX = 'popup:';

    /** The kinds of the builder documents API (everything but the theme draft). */
    public const BUILDER_KINDS = [self::KIND_PAGE, self::KIND_HEADER, self::KIND_FOOTER, self::KIND_ZONE, self::KIND_POPUP];

    /** B3: the theme draft (one per organization, key `theme`); not a page of the builder API. */
    public const KIND_THEME = 'theme';

    public const THEME = 'theme';

    public const HOME = 'home';

    public const LANDING_PREFIX = 'landing:';

    /** B4: a CMS page designed with the builder: `cms:<cms page uuid>`. */
    public const CMS_PREFIX = 'cms:';

    public const HEADER = 'header';

    public const FOOTER = 'footer';

    /** B4: `zone:<zone>`. */
    public const ZONE_PREFIX = 'zone:';

    /** Above / below the product grid on shop, category, brand and search; below product details. */
    public const ZONES = ['listing.top', 'listing.bottom', 'product.after'];

    protected $attributes = [
        'draft' => '{}',
        'schema_version' => 1,
        'draft_revision' => 0,
        'active' => false,
    ];

    protected function casts(): array
    {
        return [
            'active' => 'boolean',
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

    /**
     * Route binding (`{document}` of the builder API) finds builder documents only (pages,
     * B4: header, footer, zones): the theme draft has its own endpoints (`/storefront/theme/draft`,
     * …) and content format.
     *
     * @param  Builder<static>|Relation<static, *, *>  $query
     * @return Builder<static>|Relation<static, *, *>
     */
    public function resolveRouteBindingQuery($query, $value, $field = null)
    {
        return parent::resolveRouteBindingQuery($query, $value, $field)->whereIn('kind', self::BUILDER_KINDS);
    }

    /**
     * Builder documents: pages, header, footer and zones (B3: the theme draft is a document too).
     *
     * @param  Builder<BuilderDocument>  $query
     */
    public function scopeBuilder(Builder $query): void
    {
        $query->whereIn('kind', self::BUILDER_KINDS);
    }

    public function isHome(): bool
    {
        return $this->key === self::HOME;
    }

    /**
     * B8b: a popup or bar.
     */
    public function isPopup(): bool
    {
        return $this->kind === self::KIND_POPUP;
    }

    /**
     * B8b: a popup's status — `draft` (never published), `off` (published, switched off),
     * `scheduled` / `expired` (on, outside the published schedule) or `live`; null for other
     * documents.
     */
    public function popupStatus(?CarbonImmutable $now = null): ?string
    {
        if (! $this->isPopup()) {
            return null;
        }
        $version = $this->publishedVersion;
        if ($version === null) {
            return 'draft';
        }
        if (! $this->active) {
            return 'off';
        }
        $now ??= CarbonImmutable::now();
        $starts = $version->content['popup']['starts_at'] ?? null;
        $ends = $version->content['popup']['ends_at'] ?? null;

        return match (true) {
            is_string($starts) && CarbonImmutable::parse($starts)->gt($now) => 'scheduled',
            is_string($ends) && CarbonImmutable::parse($ends)->lte($now) => 'expired',
            default => 'live',
        };
    }

    /**
     * B4: the CMS page id of a `cms:<uuid>` document, or null.
     */
    public function cmsPageId(): ?string
    {
        return str_starts_with($this->key, self::CMS_PREFIX) ? substr($this->key, strlen(self::CMS_PREFIX)) : null;
    }

    /**
     * The landing page slug, or null for other documents.
     */
    public function landingSlug(): ?string
    {
        return str_starts_with($this->key, self::LANDING_PREFIX) ? substr($this->key, strlen(self::LANDING_PREFIX)) : null;
    }

    /**
     * Where the page is on the store (B2): `/` for the home page, `/p/<slug>` for a landing
     * page; null for documents that are not pages of their own (B4: header, footer, zones; a CMS
     * page's path `/pages/<slug>` comes from the Cms module, see BuilderPresenter).
     */
    public function storePath(): ?string
    {
        if ($this->isHome()) {
            return '/';
        }
        $slug = $this->landingSlug();

        return $slug === null ? null : '/p/'.$slug;
    }

    protected function affectsStorefront(): bool
    {
        if (! $this->exists) {
            // Deleted: only a published document was on the storefront.
            return $this->published_version_id !== null;
        }

        return $this->wasChanged('published_version_id')
            || ($this->published_version_id !== null && ($this->wasChanged('title') || $this->wasChanged('active')));
    }
}
