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
     * Whether an element type gets data here.
     */
    public static function handles(string $type): bool
    {
        return in_array($type, ElementRegistry::DATA_TYPES, true);
    }
}
