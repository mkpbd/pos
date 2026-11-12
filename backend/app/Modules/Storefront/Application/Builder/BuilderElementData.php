<?php

namespace App\Modules\Storefront\Application\Builder;

use App\Modules\Cms\Application\Contracts\PageContent;
use App\Modules\OnlineCatalog\Application\Contracts\StorefrontCatalog;
use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Promotions\Application\Contracts\CatalogPromotions;
use App\Modules\Promotions\Application\Contracts\PromotionShowcase;
use App\Modules\Reviews\Application\Contracts\ReviewShowcase;
use App\Modules\Shared\Application\Localization\LocaleContext;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
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
 * - B8a comparison_table: `{products: {<product id>: product card}}` of the columns' products
 *   on sale (draft: `columns: {<column id>: {state: unavailable}}` for the others).
 * - B8a bundle: `{products: {<product id>: product page object}}` of the items' products on
 *   sale; fewer than two is `unavailable` (draft: `items: {<item id>: {state: unavailable}}`).
 * - B8a flash_sale_bar: `{promotion: {id, name, ends_at, state}, products: [card], claimed:
 *   {used, limit}|null}` of the chosen countdown promotion or the live one ending first;
 *   published only while it runs with an end (draft: `state: scheduled | expired | inactive |
 *   unavailable`).
 * - B8a review_wall: `{summary: {average, count}|null, reviews: [{id, author, rating, title,
 *   body, created_at, product: {name, url, image}|null}]}` — approved reviews of products on
 *   sale only (ReviewShowcase); none → no data.
 * - B8a store_hours: `{timezone}` of the organization.
 * - B8a chart with a store `data_source`: `{labels, series: [{id, name, values}]}` — products
 *   per top-level category or approved reviews per star rating; nothing to show → no data.
 *
 * In a draft (preview) an element that would be left out publicly keeps its data with
 * `state: expired | inactive | unavailable`; an element whose record is gone has no data.
 */
class BuilderElementData
{
    /** B8a: ids of the live products (keys), loaded once per instance when a review needs them. */
    private ?array $live = null;

    /** @var array<string, array<string, int>> B8a: approved review counts per star, by scope */
    private array $ratingCounts = [];

    private ?string $timezone = null;

    public function __construct(
        private readonly PromotionShowcase $promotions,
        private readonly StorefrontCatalog $catalog,
        private readonly MenuTrees $menus,
        private readonly PageContent $content,
        private readonly CatalogPromotions $catalogPromotions,
        private readonly ReviewShowcase $reviews,
        private readonly OrganizationDirectory $organizations,
        private readonly TenantContext $tenant,
        private readonly LocaleContext $locale,
    ) {}

    /**
     * @param  list<array{id: string, type: string, props: array<string, mixed>}>  $elements  props in the request's language
     * @return array<string, array<string, mixed>> element id => data, in input order
     */
    public function resolve(array $elements, bool $preview): array
    {
        // B8a: per-render lookups (live products, review counts, the time zone).
        $this->live = null;
        $this->ratingCounts = [];
        $this->timezone = null;

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

        // B8a: comparison products (cards) and bundle products (product pages), one query each.
        $compareIds = [];
        $bundleIds = [];
        foreach ($elements as $element) {
            if ($element['type'] === 'comparison_table') {
                array_push($compareIds, ...array_filter(array_column($element['props']['columns'] ?? [], 'product_id'), 'is_string'));
            } elseif ($element['type'] === 'bundle') {
                array_push($bundleIds, ...array_filter(array_column($element['props']['items'] ?? [], 'product_id'), 'is_string'));
            }
        }
        $compareCards = $compareIds === [] ? [] : array_column($this->catalog->productCards(array_values(array_unique($compareIds))), null, 'id');
        $bundleDetails = $bundleIds === [] ? [] : $this->catalog->productDetails(array_values(array_unique($bundleIds)));

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
                case 'comparison_table':
                    [$data, $state] = $this->comparison($props, $compareCards, $preview);
                    break;
                case 'bundle':
                    [$data, $state] = $this->bundle($props, $bundleDetails, $preview);
                    break;
                case 'flash_sale_bar':
                    [$data, $state] = $this->flashSale($props);
                    break;
                case 'review_wall':
                    $data = $this->reviewWall($props);
                    break;
                case 'store_hours':
                    $data = ['timezone' => $this->timezone()];
                    break;
                case 'chart':
                    $data = ElementRegistry::needsData('chart', $props) ? $this->storeChart($props) : null;
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
        $anyFlashSale = false;
        BuilderDocumentSchema::walk($content, function (array $node, string $path, string $kind) use (&$instants, &$countdownIds, &$discountIds, &$anyFlashSale) {
            if ($kind !== 'element') {
                return;
            }
            if ($node['type'] === 'flash_sale_bar') {
                // B8a: a chosen flash sale starting or ending; "the one ending first" changes
                // whenever any automatic promotion starts or ends.
                if (is_string($node['props']['promotion_id'] ?? null)) {
                    $countdownIds[] = $node['props']['promotion_id'];
                } else {
                    $anyFlashSale = true;
                }
            } elseif ($node['type'] === 'countdown') {
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
        if ($anyFlashSale && ($next = $this->catalogPromotions->nextChangeAt()) !== null) {
            $instants[] = $next->toIso8601String();
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
     * B8a: comparison data — the cards of the columns' products on sale; in a draft also
     * `columns: {<column id>: {state: unavailable}}` for product columns whose product is not.
     *
     * @param  array<string, mixed>  $props
     * @param  array<string, array<string, mixed>>  $cards
     * @return array{0: array<string, mixed>, 1: null}
     */
    private function comparison(array $props, array $cards, bool $preview): array
    {
        $products = [];
        $columns = [];
        foreach ($props['columns'] as $column) {
            if (! is_string($column['product_id'])) {
                continue;
            }
            if (isset($cards[$column['product_id']])) {
                $products[$column['product_id']] = $cards[$column['product_id']];
            } else {
                $columns[$column['id']] = ['state' => 'unavailable'];
            }
        }
        $data = ['products' => $products];
        if ($preview && $columns !== []) {
            $data['columns'] = $columns;
        }

        return [$data, null];
    }

    /**
     * B8a: bundle data — the product pages of the items' products on sale; fewer than two
     * is `unavailable` (left out publicly). A draft also gets `items: {<item id>: {state:
     * unavailable}}` for the others.
     *
     * @param  array<string, mixed>  $props
     * @param  array<string, array<string, mixed>>  $details
     * @return array{0: array<string, mixed>, 1: ?string}
     */
    private function bundle(array $props, array $details, bool $preview): array
    {
        $products = [];
        $items = [];
        foreach ($props['items'] as $item) {
            if (isset($details[$item['product_id']])) {
                $products[$item['product_id']] = $details[$item['product_id']];
            } else {
                $items[$item['id']] = ['state' => 'unavailable'];
            }
        }
        $data = ['products' => $products];
        if ($preview && $items !== []) {
            $data['items'] = $items;
        }

        return [$data, count($products) < 2 ? 'unavailable' : null];
    }

    /**
     * B8a: flash sale bar data — the chosen countdown promotion, or the live one ending first;
     * its products on sale (at most `product_limit`), and `claimed` only when the promotion has
     * a usage limit. Shown only while the promotion runs and has an end.
     *
     * @param  array<string, mixed>  $props
     * @return array{0: array<string, mixed>|null, 1: ?string}
     */
    private function flashSale(array $props): array
    {
        $id = $props['promotion_id'] ?? ($this->catalogPromotions->countdownPromotions(null)[0]['id'] ?? null);
        $promotion = is_string($id) ? ($this->promotions->countdowns([$id])[$id] ?? null) : null;
        if ($promotion === null) {
            return [null, null];
        }
        $state = match (true) {
            $promotion['state'] !== 'active' => $promotion['state'],
            $promotion['ends_at'] === null => 'unavailable',
            default => null,
        };

        return [[
            'promotion' => ['id' => $promotion['id'], 'name' => $promotion['name'], 'ends_at' => $promotion['ends_at'], 'state' => $promotion['state']],
            'products' => $state === null && $props['show_products'] ? $this->catalog->hotDealCards($promotion['id'], $props['product_limit']) : [],
            'claimed' => $this->promotions->claimed([$promotion['id']])[$promotion['id']] ?? null,
        ], $state];
    }

    /**
     * B8a: review wall data — approved reviews of products on sale (one product's for source
     * `product`), at least `min_rating` stars; null when there are none.
     *
     * @param  array<string, mixed>  $props
     * @return array<string, mixed>|null
     */
    private function reviewWall(array $props): ?array
    {
        $scope = $this->scope($props['source'] === 'product' ? $props['product_id'] : null);
        if ($scope === []) {
            return null;
        }
        $reviews = $this->reviews->approved($scope, $props['min_rating'], $props['source'] === 'top_rated' ? 'top_rated' : 'latest', $props['limit'], ElementRegistry::REVIEW_BODY_MAX);
        if ($reviews === []) {
            return null;
        }

        $cards = $props['show_product']
            ? array_column($this->catalog->productCards(array_values(array_unique(array_column($reviews, 'product_id')))), null, 'id')
            : [];
        $summary = null;
        if ($props['show_summary']) {
            $counts = $this->ratingCounts($scope, $props['source'] === 'product' ? (string) $props['product_id'] : '*');
            $count = array_sum($counts);
            $sum = 0;
            foreach ($counts as $stars => $n) {
                $sum += (int) $stars * $n;
            }
            $summary = $count === 0 ? null : ['average' => Decimal::div((string) $sum, (string) $count, 1), 'count' => $count];
        }

        return [
            'summary' => $summary,
            'reviews' => array_map(function (array $review) use ($cards, $props) {
                $card = $cards[$review['product_id']] ?? null;

                return [
                    'id' => $review['id'],
                    'author' => $review['author'],
                    'rating' => $review['rating'],
                    'title' => $review['title'],
                    'body' => $review['body'],
                    'created_at' => $review['created_at'],
                    'product' => $props['show_product'] && $card !== null ? ['name' => $card['name'], 'url' => $card['url'], 'image' => $card['image']] : null,
                ];
            }, $reviews),
        ];
    }

    /**
     * B8a: a chart's store data `{labels, series: [{id, name, values}]}` — only public-safe
     * counts (products per category, approved reviews per star rating), never sales, revenue,
     * order or customer numbers; null when there is nothing to show.
     *
     * @param  array<string, mixed>  $props
     * @return array<string, mixed>|null
     */
    private function storeChart(array $props): ?array
    {
        $bangla = $this->locale->current() === LocaleContext::BN;
        if ($props['data_source'] === 'store.products_per_category') {
            $categories = array_values(array_filter($this->catalog->categoryStrip(null, 1000), fn (array $c) => $c['product_count'] > 0));
            usort($categories, fn (array $a, array $b) => $b['product_count'] <=> $a['product_count'] ?: strcmp($a['name'], $b['name']));
            $categories = array_slice($categories, 0, in_array($props['kind'], ['pie', 'donut'], true) ? ElementRegistry::CHART_PIE_LABELS : ElementRegistry::CHART_STORE_CATEGORIES);
            if ($categories === []) {
                return null;
            }

            return [
                'labels' => array_column($categories, 'name'),
                'series' => [['id' => 's1', 'name' => $bangla ? 'পণ্য' : 'Products', 'values' => array_map(fn (array $c) => (int) $c['product_count'], $categories)]],
            ];
        }

        $productId = $props['source_product_id'] ?? null;
        $scope = $this->scope(is_string($productId) ? $productId : null);
        $counts = $scope === [] ? [] : $this->ratingCounts($scope, is_string($productId) ? $productId : '*');
        if (array_sum($counts) === 0) {
            return null;
        }
        $digits = fn (int $n) => $bangla ? strtr((string) $n, ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯']) : (string) $n;

        return [
            'labels' => array_map(fn (int $stars) => $bangla ? $digits($stars).' তারকা' : $stars.' '.($stars === 1 ? 'star' : 'stars'), [5, 4, 3, 2, 1]),
            'series' => [['id' => 's1', 'name' => $bangla ? 'রিভিউ' : 'Reviews', 'values' => array_map(fn (int $stars) => (int) ($counts[(string) $stars] ?? 0), [5, 4, 3, 2, 1])]],
        ];
    }

    /**
     * B8a: the products whose reviews may show — one product (when it is on sale) or every
     * product on sale.
     *
     * @return list<string>
     */
    private function scope(?string $productId): array
    {
        $this->live ??= array_fill_keys($this->catalog->liveProductIds(), true);
        if ($productId !== null) {
            return isset($this->live[$productId]) ? [$productId] : [];
        }

        return array_map('strval', array_keys($this->live));
    }

    /**
     * @param  list<string>  $scope
     * @return array<string, int>
     */
    private function ratingCounts(array $scope, string $key): array
    {
        return $this->ratingCounts[$key] ??= $this->reviews->ratingCounts($scope);
    }

    /**
     * B8a: the organization's time zone (store hours' "open now").
     */
    private function timezone(): string
    {
        return $this->timezone ??= (string) ($this->organizations->summary($this->tenant->requireOrganization())['timezone'] ?? config('app.timezone'));
    }

    /**
     * Whether an element gets data here (B8a: a chart only with a store data source).
     *
     * @param  array<string, mixed>  $props  normalized
     */
    public static function handles(string $type, array $props = []): bool
    {
        return ElementRegistry::needsData($type, $props);
    }
}
