<?php

namespace App\Modules\Storefront\Application\Builder;

use App\Modules\Cms\Application\Contracts\PageContent;
use App\Modules\OnlineCatalog\Application\Contracts\StorefrontCatalog;
use App\Modules\Promotions\Application\Contracts\PromotionShowcase;
use App\Modules\Storefront\Application\Queries\MenuTrees;
use App\Modules\Storefront\Domain\Builder\BuilderDocumentSchema;
use App\Modules\Storefront\Domain\Builder\ElementRegistry;
use Carbon\CarbonImmutable;

/**
 * `data[id]` of the B4 data elements (ElementRegistry::DATA_TYPES), resolved in one pass per
 * kind of record for a whole render:
 *
 * - countdown: `{ends_at, title, promotion: {id, name}|null}` — the date, or the end of the
 *   organization's countdown promotion; `title` is the element's title or else the promotion's
 *   name (null when both are empty). Published: an expired countdown is left out unless it
 *   has an `expired_text`; a promotion that is switched off, not started or without an end is
 *   left out.
 * - discount: `{name, kind: percent|fixed, value: "10.00", coupon_code: ?string (only when the
 *   element shows the code), min_subtotal: ?string, ends_at: ?string}`; published only while
 *   the promotion is active.
 * - promo_card: the storefront product card (catalog listing shape) of a live product.
 * - menu: `{name, items}` — the menu tree exactly as bootstrap serves menus; published only
 *   while the menu is active.
 * - faq_list: `{groups: [{group, items: [{id, question, answer_html}]}]}`; published only with
 *   at least one active entry.
 *
 * - B6 category_card: `{name, url, image: MediaRef|null, product_count}` of a visible category
 *   (draft: a hidden one with `url: null, image: null, product_count: 0, state: unavailable`).
 * - B6 product_spotlight: the product page object (GET /store/products/{slug}) of a live
 *   product (draft: a draft / scheduled / ended one with `state: unavailable`).
 * - B6 shop_the_look: `{products: {<product id>: product card}}` of the hotspots' live
 *   products (always present; published payloads also drop the other hotspots).
 *
 * In a draft (preview) an element that would be left out publicly keeps its data with
 * `state: expired | inactive | unavailable`; an element whose record is gone has no data.
 */
class BuilderElementData
{
    public function __construct(
        private readonly PromotionShowcase $promotions,
        private readonly StorefrontCatalog $catalog,
        private readonly MenuTrees $menus,
        private readonly PageContent $content,
    ) {}

    /**
     * @param  list<array{id: string, type: string, props: array<string, mixed>}>  $elements  props in the request's language
     * @return array<string, array<string, mixed>> element id => data, in input order
     */
    public function resolve(array $elements, bool $preview): array
    {
        $ids = fn (string $type, string $prop, ?callable $when = null) => array_values(array_unique(array_filter(array_map(
            fn (array $e) => $e['type'] === $type && ($when === null || $when($e)) ? ($e['props'][$prop] ?? null) : null,
            $elements,
        ), 'is_string')));

        $countdownIds = $ids('countdown', 'promotion_id', fn (array $e) => $e['props']['source'] === 'promotion');
        $countdowns = $countdownIds === [] ? [] : $this->promotions->countdowns($countdownIds);
        $discountIds = $ids('discount', 'promotion_id');
        $discounts = $discountIds === [] ? [] : $this->promotions->discounts($discountIds);
        $productIds = $ids('promo_card', 'product_id');
        $cards = $productIds === [] ? [] : array_column($this->catalog->productCards($productIds), null, 'id');
        $menuIds = $ids('menu', 'menu_id');
        $menus = $this->menus->load($menuIds)->keyBy('id');
        $trees = $menus->isEmpty() ? [] : $this->menus->trees($menus->values());
        $faq = null;

        // B6: category cards, product spotlights and shop-the-look products.
        $categoryIds = $ids('category_card', 'category_id');
        $categories = $this->categoryCards($categoryIds, $preview);
        $spotlightIds = $ids('product_spotlight', 'product_id');
        $details = $spotlightIds === [] ? [] : $this->catalog->productDetails($spotlightIds);
        $missing = array_values(array_diff($spotlightIds, array_keys($details)));
        $previewDetails = $preview && $missing !== [] ? $this->catalog->productDetails($missing, true) : [];
        $lookIds = [];
        foreach ($elements as $element) {
            if ($element['type'] === 'shop_the_look') {
                array_push($lookIds, ...array_filter(array_column($element['props']['hotspots'] ?? [], 'product_id'), 'is_string'));
            }
        }
        $lookIds = array_values(array_unique($lookIds));
        $lookCards = $lookIds === [] ? [] : array_column($this->catalog->productCards($lookIds), null, 'id');

        $now = CarbonImmutable::now();
        $result = [];
        foreach ($elements as $element) {
            $props = $element['props'];
            $data = null;
            $state = null;
            switch ($element['type']) {
                case 'countdown':
                    [$data, $state] = $this->countdown($props, $countdowns, $now);
                    break;
                case 'discount':
                    $promotion = $discounts[$props['promotion_id']] ?? null;
                    if ($promotion !== null) {
                        $data = [
                            'name' => $promotion['name'],
                            'kind' => $promotion['kind'],
                            'value' => $promotion['value'],
                            'coupon_code' => $props['show_code'] ? $promotion['coupon_code'] : null,
                            'min_subtotal' => $promotion['min_subtotal'],
                            'ends_at' => $promotion['ends_at'],
                        ];
                        $state = match ($promotion['state']) {
                            'active' => null,
                            'expired' => 'expired',
                            default => 'inactive',
                        };
                    }
                    break;
                case 'promo_card':
                    $data = $cards[$props['product_id']] ?? null;
                    break;
                case 'menu':
                    $menu = $menus->get($props['menu_id']);
                    if ($menu !== null) {
                        $data = ['name' => $menu->name, 'items' => $trees[$menu->id] ?? []];
                        $state = $menu->is_active ? null : 'inactive';
                    }
                    break;
                case 'faq_list':
                    $faq ??= $this->content->publicFaq();
                    $data = ['groups' => $faq];
                    $state = $faq === [] ? 'unavailable' : null;
                    break;
                case 'category_card':
                    [$data, $state] = $categories[$props['category_id']] ?? [null, null];
                    break;
                case 'product_spotlight':
                    $data = $details[$props['product_id']] ?? null;
                    if ($data === null && isset($previewDetails[$props['product_id']])) {
                        $data = $previewDetails[$props['product_id']];
                        unset($data['preview_state']);
                        $state = 'unavailable';
                    }
                    break;
                case 'shop_the_look':
                    $products = [];
                    foreach ($props['hotspots'] as $spot) {
                        if (isset($lookCards[$spot['product_id']])) {
                            $products[$spot['product_id']] = $lookCards[$spot['product_id']];
                        }
                    }
                    $data = ['products' => $products];
                    break;
            }

            if ($data === null) {
                continue;
            }
            // An expired countdown with a text for afterwards stays (the storefront shows the text).
            $shownExpired = $element['type'] === 'countdown' && $state === 'expired' && $props['expired_text'] !== '';
            if ($state !== null && ! $preview && ! $shownExpired) {
                continue;
            }
            $result[$element['id']] = $preview && $state !== null ? $data + ['state' => $state] : $data;
        }

        return $result;
    }

    /**
     * The next instant the data of a document's elements changes on its own: a countdown date
     * passing, a referenced promotion starting or ending.
     *
     * @param  array<string, mixed>  $content  normalized document
     */
    public function nextChange(array $content): ?CarbonImmutable
    {
        $instants = [];
        $countdownIds = [];
        $discountIds = [];
        BuilderDocumentSchema::walk($content, function (array $node, string $path, string $kind) use (&$instants, &$countdownIds, &$discountIds) {
            if ($kind !== 'element') {
                return;
            }
            if ($node['type'] === 'countdown') {
                if ($node['props']['source'] === 'date' && is_string($node['props']['ends_at'])) {
                    $instants[] = $node['props']['ends_at'];
                } elseif (is_string($node['props']['promotion_id'])) {
                    $countdownIds[] = $node['props']['promotion_id'];
                }
            } elseif ($node['type'] === 'discount' && is_string($node['props']['promotion_id'])) {
                $discountIds[] = $node['props']['promotion_id'];
            }
        });
        $promotions = [
            ...($countdownIds === [] ? [] : array_values($this->promotions->countdowns(array_values(array_unique($countdownIds))))),
            ...($discountIds === [] ? [] : array_values($this->promotions->discounts(array_values(array_unique($discountIds))))),
        ];
        foreach ($promotions as $promotion) {
            array_push($instants, ...array_filter([$promotion['starts_at'], $promotion['ends_at']]));
        }

        $now = CarbonImmutable::now();
        $next = null;
        foreach ($instants as $instant) {
            $at = CarbonImmutable::parse($instant);
            if ($at->gt($now) && ($next === null || $at->lt($next))) {
                $next = $at;
            }
        }

        return $next;
    }

    /**
     * @param  array<string, mixed>  $props
     * @param  array<string, array<string, mixed>>  $countdowns
     * @return array{0: array<string, mixed>|null, 1: ?string} data and state
     */
    private function countdown(array $props, array $countdowns, CarbonImmutable $now): array
    {
        $title = $props['title'] !== '' ? $props['title'] : null;
        if ($props['source'] === 'date') {
            $endsAt = (string) $props['ends_at'];

            return [
                ['ends_at' => $endsAt, 'title' => $title, 'promotion' => null],
                CarbonImmutable::parse($endsAt)->lte($now) ? 'expired' : null,
            ];
        }

        $promotion = $countdowns[$props['promotion_id']] ?? null;
        if ($promotion === null) {
            return [null, null];
        }
        $data = [
            'ends_at' => $promotion['ends_at'],
            'title' => $title ?? $promotion['name'],
            'promotion' => ['id' => $promotion['id'], 'name' => $promotion['name']],
        ];
        $state = match (true) {
            $promotion['state'] === 'expired' => 'expired',
            $promotion['state'] !== 'active' => 'inactive',
            $promotion['ends_at'] === null => 'unavailable',
            default => null,
        };

        return [$data, $state];
    }

    /**
     * B6: category card data `{name, url, image, product_count}` and state by category id —
     * visible categories (state null); in a draft also hidden ones (`url` null, no image, 0
     * products, state `unavailable`). Categories that no longer exist are left out.
     *
     * @param  list<string>  $ids
     * @return array<string, array{0: array<string, mixed>, 1: ?string}>
     */
    private function categoryCards(array $ids, bool $preview): array
    {
        if ($ids === []) {
            return [];
        }
        $visible = $this->catalog->visibleCategories($ids);
        $strip = $visible === [] ? [] : array_column($this->catalog->categoryStrip(array_keys($visible), count($visible)), null, 'slug');

        $result = [];
        foreach ($visible as $id => $category) {
            $card = $strip[$category['slug']] ?? null;
            if ($card !== null) {
                $result[$id] = [['name' => $card['name'], 'url' => $card['url'], 'image' => $card['image'], 'product_count' => $card['product_count']], null];
            }
        }
        if ($preview) {
            $hidden = array_values(array_diff($ids, array_keys($result)));
            foreach ($hidden === [] ? [] : $this->catalog->itemSummaries('category', $hidden) as $id => $summary) {
                $result[$id] = [['name' => $summary['name'], 'url' => null, 'image' => null, 'product_count' => 0], 'unavailable'];
            }
        }

        return $result;
    }

    /**
     * Whether an element type gets data here.
     */
    public static function handles(string $type): bool
    {
        return in_array($type, ElementRegistry::DATA_TYPES, true);
    }
}
