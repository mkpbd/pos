<?php

namespace App\Modules\Storefront\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Persistence\Concerns\BelongsToOrganization;
use App\Modules\Shared\Infrastructure\Persistence\Concerns\ChangesStorefrontContent;
use App\Modules\Storefront\Domain\Builder\BuilderDocumentSchema;
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
 * (kind `zone`; P1b adds `product.below_price` and `product.bottom`, and product zone versions for
 * a category or a product: `zone:<product zone>@category:<uuid>` / `@product:<uuid>`); `theme` for
 * the theme draft (kind `theme`, B3).
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
 * @property ?string $context B9: a global section's context (page | header | footer); null otherwise
 * @property ?BuilderVersion $publishedVersion
 */
#[Fillable(['organization_id', 'kind', 'key', 'title', 'schema_version', 'draft', 'draft_revision', 'draft_updated_at', 'draft_updated_by', 'published_version_id', 'active', 'context'])]
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

    /**
     * B9: a global section (`global:<uuid>`) — one section shown wherever a `global_section` node
     * refers to it; `context` (page | header | footer) says where it may be used.
     */
    public const KIND_GLOBAL = 'global';

    public const GLOBAL_PREFIX = 'global:';

    /** B9: where a global section may be used: page → pages, content pages and shop areas. */
    public const GLOBAL_CONTEXTS = ['page', 'header', 'footer'];

    /** The kinds of the builder documents API (everything but the theme draft). */
    public const BUILDER_KINDS = [self::KIND_PAGE, self::KIND_HEADER, self::KIND_FOOTER, self::KIND_ZONE, self::KIND_POPUP, self::KIND_GLOBAL];

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

    /**
     * Above / below the product grid on shop, category, brand and search; below product details.
     * P1b: under the product's price and at the very end of the product page.
     */
    public const ZONES = ['listing.top', 'listing.bottom', 'product.below_price', 'product.after', 'product.bottom'];

    /** P1b: the zones the bootstrap carries (product pages get theirs resolved with the product). */
    public const BOOTSTRAP_ZONES = ['listing.top', 'listing.bottom', 'product.after'];

    /**
     * P1b: the product page zones; each may also have versions for a category
     * (`zone:<zone>@category:<uuid>`) or one product (`zone:<zone>@product:<uuid>`).
     */
    public const PRODUCT_ZONES = ['product.below_price', 'product.after', 'product.bottom'];

    public const TARGET_CATEGORY = 'category';

    public const TARGET_PRODUCT = 'product';

    /** P1b: at most this many targeted zone versions per organization. */
    public const MAX_TARGETED_ZONES = 100;

    /** P1b: `zone:<product zone>@<category|product>:<uuid>` (lower-case uuid). */
    public const TARGETED_ZONE_PATTERN = '/^zone:(product\.below_price|product\.after|product\.bottom)@(category|product):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/';

    /**
     * P1b: the document key of a zone, or of its version for a category or a product.
     *
     * @param  'category'|'product'|null  $targetType
     */
    public static function zoneKey(string $zone, ?string $targetType = null, ?string $targetId = null): string
    {
        return self::ZONE_PREFIX.$zone.($targetType === null || $targetId === null ? '' : '@'.$targetType.':'.strtolower($targetId));
    }

    /**
     * P1b: `{zone, type, id}` of a targeted zone key, or null for any other key.
     *
     * @return array{zone: string, type: 'category'|'product', id: string}|null
     */
    public static function parseTargetedZone(string $key): ?array
    {
        if (preg_match(self::TARGETED_ZONE_PATTERN, $key, $m) !== 1) {
            return null;
        }

        /** @var 'category'|'product' $type */
        $type = $m[2];

        return ['zone' => $m[1], 'type' => $type, 'id' => $m[3]];
    }

    /**
     * P1b: the zone of a zone document (`product.after` for `zone:product.after@category:…`), else null.
     */
    public function zone(): ?string
    {
        if (! str_starts_with($this->key, self::ZONE_PREFIX)) {
            return null;
        }
        $zone = explode('@', substr($this->key, strlen(self::ZONE_PREFIX)), 2)[0];

        return in_array($zone, self::ZONES, true) ? $zone : null;
    }

    /**
     * P1b: `{type, id}` of a targeted zone version, else null.
     *
     * @return array{type: 'category'|'product', id: string}|null
     */
    public function zoneTarget(): ?array
    {
        $parsed = self::parseTargetedZone($this->key);

        return $parsed === null ? null : ['type' => $parsed['type'], 'id' => $parsed['id']];
    }

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
     * B9: a global section.
     */
    public function isGlobal(): bool
    {
        return $this->kind === self::KIND_GLOBAL;
    }

    /**
     * B9: the validation context of the document's content — a global's own context, else the
     * context of its key (BuilderDocumentSchema::contextOf).
     */
    public function contentContext(): string
    {
        if ($this->isGlobal()) {
            return in_array($this->context, self::GLOBAL_CONTEXTS, true) ? $this->context : 'page';
        }

        return BuilderDocumentSchema::contextOf($this->key);
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
