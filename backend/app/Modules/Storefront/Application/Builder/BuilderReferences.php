<?php

namespace App\Modules\Storefront\Application\Builder;

use App\Modules\Cms\Application\Contracts\BlogDirectory;
use App\Modules\Cms\Application\Contracts\BlogReferences;
use App\Modules\Media\Application\Contracts\MediaLibrary;
use App\Modules\OnlineCatalog\Application\Contracts\StorefrontCatalog;
use App\Modules\Promotions\Application\Contracts\CatalogPromotions;
use App\Modules\Promotions\Application\Contracts\PromotionShowcase;
use App\Modules\Storefront\Domain\Builder\BuilderDocumentSchema;
use App\Modules\Storefront\Domain\Builder\ElementRegistry;
use App\Modules\Storefront\Domain\Builder\InvalidBuilderDocument;
use App\Modules\Storefront\Domain\Builder\StyleSchema;
use App\Modules\Storefront\Domain\SectionType;
use App\Modules\Storefront\Infrastructure\Models\Banner;
use App\Modules\Storefront\Infrastructure\Models\Menu;

/**
 * Ownership of the ids a (normalized) builder document refers to, for the current
 * organization (B1): media (image elements, background images, testimonial photos and the
 * newsletter image), banners of the right placement, hand-picked products / categories /
 * brands, category sources, the hot-deals promotion and the blog category; B4: the countdown's
 * promotion (a countdown promotion), the discount's promotion (percent / fixed), the promoted
 * product and the menu of a menu element; B6: gallery / carousel / logo images, the category
 * card's category and image, the spotlight product, the shop-the-look photo and hotspot
 * products, and background-video posters (style media). Another
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
    ];

    public function __construct(
        private readonly MediaLibrary $media,
        private readonly StorefrontCatalog $catalog,
        private readonly CatalogPromotions $promotions,
        private readonly BlogDirectory $blog,
        private readonly PromotionShowcase $showcase,
    ) {}

    /**
     * @param  array<string, mixed>  $document  normalized
     *
     * @throws InvalidBuilderDocument
     */
    public function check(array $document): void
    {
        /** @var array<string, list<array{path: string, node_id: string, ids: list<string>}>> $uses code => uses */
        $uses = [];
        $use = function (string $code, string $path, string $nodeId, array $ids) use (&$uses) {
            $ids = array_values(array_unique(array_filter($ids, 'is_string')));
            if ($ids !== []) {
                $uses[$code][] = ['path' => $path, 'node_id' => $nodeId, 'ids' => $ids];
            }
        };

        BuilderDocumentSchema::walk($document, function (array $node, string $path, string $kind) use ($use) {
            $use('MEDIA_NOT_FOUND', "{$path}.style", $node['id'], StyleSchema::mediaIds($node['style'] ?? []));
            if ($kind !== 'element') {
                return;
            }
            $props = $node['props'];
            // Image elements; B6: gallery, carousel and logo images, the category card's own image
            // and the shop-the-look photo.
            $mediaIds = ElementRegistry::mediaIds($node['type'], $props);
            if ($mediaIds !== []) {
                $prop = match ($node['type']) {
                    'gallery', 'image_carousel' => 'images',
                    'logo_carousel' => 'logos',
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

        $errors = [];
        foreach ($uses as $code => $list) {
            $all = array_values(array_unique(array_merge(...array_column($list, 'ids'))));
            $found = $this->existing($code, $all);
            foreach ($list as $entry) {
                $missing = array_values(array_diff($entry['ids'], $found));
                if ($missing !== []) {
                    $baseCode = explode(':', $code)[0];
                    $errors[] = ['path' => $entry['path'], 'node_id' => $entry['node_id'], 'message' => self::MESSAGES[$baseCode], 'code' => $baseCode, 'ids' => $missing];
                }
            }
        }

        if ($errors !== []) {
            throw new InvalidBuilderDocument($errors, 'The page refers to records that do not exist.');
        }
    }

    /**
     * @param  list<string>  $ids
     * @return list<string>
     */
    private function existing(string $code, array $ids): array
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
        };
    }
}
