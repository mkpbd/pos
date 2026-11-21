<?php

namespace App\Modules\Storefront\Application\Builder;

use App\Modules\Cms\Application\Contracts\BlogDirectory;
use App\Modules\Cms\Application\Contracts\BlogReferences;
use App\Modules\Geography\Application\Contracts\GeoDirectory;
use App\Modules\Marketing\Application\Contracts\MarketingLinks;
use App\Modules\Media\Application\Contracts\MediaLibrary;
use App\Modules\OnlineCatalog\Application\Contracts\StorefrontCatalog;
use App\Modules\Promotions\Application\Contracts\CatalogPromotions;
use App\Modules\Promotions\Application\Contracts\PromotionShowcase;
use App\Modules\Storefront\Domain\Builder\AudienceRules;
use App\Modules\Storefront\Domain\Builder\BuilderDocumentSchema;
use App\Modules\Storefront\Domain\Builder\ElementRegistry;
use App\Modules\Storefront\Domain\Builder\InvalidBuilderDocument;
use App\Modules\Storefront\Domain\Builder\StyleSchema;
use App\Modules\Storefront\Domain\SectionType;
use App\Modules\Storefront\Infrastructure\Models\Banner;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;
use App\Modules\Storefront\Infrastructure\Models\Menu;

/**
 * Ownership of the ids a (normalized) builder document refers to, for the current
 * organization (B1): media (image elements, background images, testimonial photos and the
 * newsletter image), banners of the right placement, hand-picked products / categories /
 * brands, category sources, the hot-deals promotion and the blog category; B4: the countdown's
 * promotion (a countdown promotion), the discount's promotion (percent / fixed), the promoted
 * product and the menu of a menu element; B6: gallery / carousel / logo images, the category
 * card's category and image, the spotlight product, the shop-the-look photo and hotspot
 * products, and background-video posters (style media); B8a: before / after photos, team
 * portraits and photo grid images, comparison and bundle products, the flash sale bar's
 * countdown promotion, the review wall's product and a ratings chart's product; B19: scroll
 * story and horizontal gallery pictures, the gallery's products. Another
 * organization's id is reported exactly like a missing one: 422 DOCUMENT_INVALID with the
 * node id, path, a code and the ids.
 */
class BuilderReferences
{
    private const MESSAGES = [
        'MEDIA_NOT_FOUND' => 'Some selected images no longer exist in the media library.',
        'BANNER_NOT_FOUND' => 'Some selected banners do not exist or belong to another placement.',
        'PRODUCT_NOT_FOUND' => 'Some selected products no longer exist.',
        'CATEGORY_NOT_FOUND' => 'Some selected categories no longer exist.',
        'BRAND_NOT_FOUND' => 'Some selected brands no longer exist.',
        'PROMOTION_NOT_FOUND' => 'Choose an automatic promotion with a countdown (a flash sale).',
        'BLOG_CATEGORY_NOT_FOUND' => 'The selected blog category no longer exists.',
        // B4.
        'DISCOUNT_NOT_FOUND' => 'Choose a percentage or fixed-amount promotion.',
        'MENU_NOT_FOUND' => 'The selected menu no longer exists.',
        // B13: audience rules.
        'DISTRICT_NOT_FOUND' => 'Some selected districts do not exist.',
        'CAMPAIGN_NOT_FOUND' => 'Some selected campaigns no longer exist.',
    ];

    public function __construct(
        private readonly MediaLibrary $media,
        private readonly StorefrontCatalog $catalog,
        private readonly CatalogPromotions $promotions,
        private readonly BlogDirectory $blog,
        private readonly PromotionShowcase $showcase,
        private readonly GeoDirectory $geo,
        private readonly MarketingLinks $marketing,
    ) {}

    /**
     * @param  array<string, mixed>  $document  normalized
     *
     * @throws InvalidBuilderDocument
     */
    public function check(array $document, ?string $context = null): void
    {
        ['uses' => $uses, 'globals' => $globals] = $this->collect($document);

        $errors = $this->globalErrors($globals, $context);
        foreach ($uses as $code => $list) {
            $all = array_values(array_unique(array_merge(...array_column($list, 'ids'))));
            $found = $this->existing($code, $all);
            foreach ($list as $entry) {
                $missing = array_values(array_diff($entry['ids'], $found));
                if ($missing !== []) {
                    $baseCode = explode(':', $code)[0];
                    // B13: districts are whole numbers.
                    $errors[] = ['path' => $entry['path'], 'node_id' => $entry['node_id'], 'message' => self::MESSAGES[$baseCode], 'code' => $baseCode,
                        'ids' => $baseCode === 'DISTRICT_NOT_FOUND' ? array_map('intval', $missing) : $missing];
                }
            }
        }

        if ($errors !== []) {
            throw new InvalidBuilderDocument($errors, 'The page refers to records that do not exist.');
        }
    }

    /**
     * B10: every reference of the document — `uses` keyed by check code (`BANNER_NOT_FOUND:<placement>`
     * for banners) with the path, node id and ids, and the global section references — for the
     * save check and the page check (BuilderPageCheck).
     *
     * @param  array<string, mixed>  $document  normalized
     * @return array{uses: array<string, list<array{path: string, node_id: ?string, ids: list<string>}>>, globals: list<array{path: string, node_id: string, ref: string}>}
     */
    public function collect(array $document): array
    {
        /** @var array<string, list<array{path: string, node_id: ?string, ids: list<string>}>> $uses code => uses */
        $uses = [];
        $use = function (string $code, string $path, ?string $nodeId, array $ids) use (&$uses) {
            $ids = array_values(array_unique(array_filter($ids, 'is_string')));
            if ($ids !== []) {
                $uses[$code][] = ['path' => $path, 'node_id' => $nodeId, 'ids' => $ids];
            }
        };
        // B9: the search & sharing image.
        $use('MEDIA_NOT_FOUND', 'seo.image.media_id', null, [$document['seo']['image']['media_id'] ?? null]);
        /** @var list<array{path: string, node_id: string, ref: string}> $globals */
        $globals = [];

        BuilderDocumentSchema::walk($document, function (array $node, string $path, string $kind) use ($use, &$globals) {
            // B13: the districts and campaigns of audience rules (district ids as strings here).
            $audience = AudienceRules::references(is_array($node['audience'] ?? null) ? $node['audience'] : null);
            foreach ($audience['districts'] as $rule) {
                $use('DISTRICT_NOT_FOUND', "{$path}.audience.rules.{$rule['rule']}.in", $node['id'] ?? null, array_map('strval', $rule['ids']));
            }
            foreach ($audience['campaigns'] as $rule) {
                $use('CAMPAIGN_NOT_FOUND', "{$path}.audience.rules.{$rule['rule']}.in", $node['id'] ?? null, $rule['ids']);
            }
            if ($kind === BuilderDocumentSchema::GLOBAL_SECTION) {
                // B9: checked below (exists, this organization's, fits the context).
                $globals[] = ['path' => "{$path}.ref", 'node_id' => $node['id'], 'ref' => $node['ref']];

                return;
            }
            $use('MEDIA_NOT_FOUND', "{$path}.style", $node['id'], StyleSchema::mediaIds($node['style'] ?? []));
            if ($kind !== 'element') {
                return;
            }
            $props = $node['props'];
            // Image elements; B6: gallery, carousel and logo images, the category card's own image
            // and the shop-the-look photo.
            $mediaIds = ElementRegistry::mediaIds($node['type'], $props);
            if ($node['type'] === 'before_after') {
                // B8a: the two photos, each with its own path.
                $use('MEDIA_NOT_FOUND', "{$path}.props.before.media_id", $node['id'], [$props['before']['media_id']]);
                $use('MEDIA_NOT_FOUND', "{$path}.props.after.media_id", $node['id'], [$props['after']['media_id']]);
            } elseif ($mediaIds !== []) {
                $prop = match ($node['type']) {
                    'gallery', 'image_carousel', 'photo_grid' => 'images',
                    'logo_carousel' => 'logos',
                    'team' => 'members',
                    // B19.
                    'scroll_story' => 'steps',
                    'horizontal_gallery' => 'items',
                    default => 'media_id',
                };
                $use('MEDIA_NOT_FOUND', "{$path}.props.{$prop}", $node['id'], $mediaIds);
            }
            // B4 / B6 elements.
            match ($node['type']) {
                'countdown' => $use('PROMOTION_NOT_FOUND', "{$path}.props.promotion_id", $node['id'], [$props['promotion_id']]),
                'discount' => $use('DISCOUNT_NOT_FOUND', "{$path}.props.promotion_id", $node['id'], [$props['promotion_id']]),
                'promo_card', 'product_spotlight' => $use('PRODUCT_NOT_FOUND', "{$path}.props.product_id", $node['id'], [$props['product_id']]),
                'menu' => $use('MENU_NOT_FOUND', "{$path}.props.menu_id", $node['id'], [$props['menu_id']]),
                'category_card' => $use('CATEGORY_NOT_FOUND', "{$path}.props.category_id", $node['id'], [$props['category_id']]),
                'shop_the_look' => $use('PRODUCT_NOT_FOUND', "{$path}.props.hotspots", $node['id'], array_column($props['hotspots'], 'product_id')),
                // B8a.
                'comparison_table' => $use('PRODUCT_NOT_FOUND', "{$path}.props.columns", $node['id'], array_column($props['columns'], 'product_id')),
                'bundle' => $use('PRODUCT_NOT_FOUND', "{$path}.props.items", $node['id'], array_column($props['items'], 'product_id')),
                'flash_sale_bar' => $use('PROMOTION_NOT_FOUND', "{$path}.props.promotion_id", $node['id'], [$props['promotion_id']]),
                'review_wall' => $use('PRODUCT_NOT_FOUND', "{$path}.props.product_id", $node['id'], $props['source'] === 'product' ? [$props['product_id']] : []),
                'chart' => $use('PRODUCT_NOT_FOUND', "{$path}.props.source_product_id", $node['id'], [$props['source_product_id'] ?? null]),
                // P2a: the product the order form sells and its add-on.
                'order_form' => $use('PRODUCT_NOT_FOUND', "{$path}.props.product_id", $node['id'], [$props['product_id'], $props['upsell']['product_id'] ?? null]),
                // B14: a listing of chosen categories or brands.
                'product_listing' => [
                    $use('CATEGORY_NOT_FOUND', "{$path}.props.category_ids", $node['id'], $props['category_ids'] ?? []),
                    $use('BRAND_NOT_FOUND', "{$path}.props.brand_ids", $node['id'], $props['brand_ids'] ?? []),
                ],
                // B19: a horizontal gallery of chosen products.
                'horizontal_gallery' => $use('PRODUCT_NOT_FOUND', "{$path}.props.product_ids", $node['id'], $props['product_ids']),
                default => null,
            };
            $type = ElementRegistry::sectionType($node['type']);
            if ($type === null) {
                return;
            }

            $config = $props['config'];
            $use('MEDIA_NOT_FOUND', "{$path}.props.config", $node['id'], $type->mediaIds($config));
            $use('CATEGORY_NOT_FOUND', "{$path}.props.config", $node['id'], $type->categoryIds($config));
            $itemIds = array_column($props['items'], 'item_id');
            if ($type->bannerPlacement() !== null) {
                $use('BANNER_NOT_FOUND:'.$type->bannerPlacement()->value, "{$path}.props.items", $node['id'], $itemIds);
            } elseif (($manual = $type->manualItemLimits()) !== null) {
                $use(strtoupper($manual['type']).'_NOT_FOUND', "{$path}.props.items", $node['id'], $itemIds);
            }
            if ($type === SectionType::HotDeals) {
                $use('PROMOTION_NOT_FOUND', "{$path}.props.config.promotion_id", $node['id'], [$config['promotion_id']]);
            }
            if ($type === SectionType::BlogPosts) {
                $use('BLOG_CATEGORY_NOT_FOUND', "{$path}.props.config.category_id", $node['id'], [$config['category_id']]);
            }
        });

        return ['uses' => $uses, 'globals' => $globals];
    }

    /**
     * B10: the plain message of a reference check code.
     */
    public static function message(string $code): string
    {
        return self::MESSAGES[$code];
    }

    /**
     * B9: global section references — the global must exist in this organization (another
     * organization's reads as missing) and fit the document's context: a `page` global in pages,
     * content pages and shop areas, a `header` / `footer` global in the header / footer.
     *
     * @param  list<array{path: string, node_id: string, ref: string}>  $globals
     * @return list<array<string, mixed>>
     */
    public function globalErrors(array $globals, ?string $context): array
    {
        if ($globals === []) {
            return [];
        }
        $contexts = BuilderDocument::query()->where('kind', BuilderDocument::KIND_GLOBAL)
            ->whereIn('id', array_values(array_unique(array_column($globals, 'ref'))))
            ->pluck('context', 'id')->all();

        $errors = [];
        foreach ($globals as $global) {
            if (! array_key_exists($global['ref'], $contexts)) {
                $errors[] = ['path' => $global['path'], 'node_id' => $global['node_id'], 'message' => 'This global section no longer exists.', 'code' => 'GLOBAL_NOT_FOUND', 'ids' => [$global['ref']]];
            } elseif ($context !== null && ! self::globalFits((string) $contexts[$global['ref']], $context)) {
                $errors[] = ['path' => $global['path'], 'node_id' => $global['node_id'], 'message' => match ($contexts[$global['ref']]) {
                    'header' => 'This global section is made for the header.',
                    'footer' => 'This global section is made for the footer.',
                    default => 'This global section is made for pages, content pages and shop areas.',
                }, 'code' => 'GLOBAL_CONTEXT_MISMATCH', 'ids' => [$global['ref']]];
            }
        }

        return $errors;
    }

    /**
     * B9: whether a global made for `$globalContext` may be used in a `$documentContext` document.
     */
    public static function globalFits(string $globalContext, string $documentContext): bool
    {
        // B14: store page templates (`template:<key>`) take the page globals.
        $documentContext = BuilderDocumentSchema::baseContext($documentContext);

        return $globalContext === 'page'
            ? in_array($documentContext, ['page', 'cms', 'zone', 'template'], true)
            : $globalContext === $documentContext;
    }

    /**
     * The ids of `$ids` that exist for a reference check code (B10: public for the page check).
     *
     * @param  list<string>  $ids
     * @return list<string>
     */
    public function existing(string $code, array $ids): array
    {
        [$code, $placement] = array_pad(explode(':', $code, 2), 2, null);

        return match ($code) {
            'MEDIA_NOT_FOUND' => $this->media->existing($ids),
            'BANNER_NOT_FOUND' => Banner::query()->whereIn('id', $ids)->where('placement', $placement)->pluck('id')->all(),
            'PRODUCT_NOT_FOUND' => $this->catalog->existing('product', $ids),
            'CATEGORY_NOT_FOUND' => $this->catalog->existing('category', $ids),
            'BRAND_NOT_FOUND' => $this->catalog->existing('brand', $ids),
            'PROMOTION_NOT_FOUND' => array_values(array_filter($ids, fn (string $id) => $this->promotions->isCountdownPromotion($id))),
            'BLOG_CATEGORY_NOT_FOUND' => $this->blog->existing(BlogReferences::CATEGORY, $ids),
            'DISCOUNT_NOT_FOUND' => array_keys($this->showcase->discounts($ids)),
            'MENU_NOT_FOUND' => Menu::query()->whereIn('id', $ids)->pluck('id')->all(),
            // B13: Bangladesh's districts (reference data); the organization's campaigns.
            'DISTRICT_NOT_FOUND' => array_values(array_intersect($ids, array_map(fn (array $d) => (string) $d['id'], $this->geo->districts()))),
            'CAMPAIGN_NOT_FOUND' => array_values(array_intersect($ids, array_keys($this->marketing->campaigns($ids)))),
        };
    }
}
