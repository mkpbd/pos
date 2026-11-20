<?php

namespace App\Modules\AI\Application\Tools\Shopper;

use App\Modules\AI\Application\Tools\AiTool;
use App\Modules\AI\Application\Tools\Arguments;
use App\Modules\AI\Application\Tools\ToolOutput;
use App\Modules\AI\Domain\Llm\ToolDefinition;
use App\Modules\OnlineCatalog\Application\Contracts\StorefrontCatalog;
use App\Modules\Promotions\Application\Contracts\PromotionShowcase;
use Illuminate\Support\Facades\Validator;

/**
 * AI2b: the offers running now — live automatic promotions and flash sales (applied without a
 * code) with what they apply to (visible products, categories and brands only) and when they
 * end. Coupon promotions and coupon codes are never returned; a product-level promotion with
 * nothing visible left to apply to is left out.
 */
final class CurrentOffersTool implements AiTool
{
    public const NAME = 'current_offers';

    public const MAX_OFFERS = 10;

    private const MAX_TARGETS = 5;

    public function __construct(
        private readonly PromotionShowcase $promotions,
        private readonly StorefrontCatalog $catalog,
        private readonly ShopperFindings $findings,
        private readonly string $currency,
    ) {}

    public function definition(): ToolDefinition
    {
        return new ToolDefinition(
            self::NAME,
            'The discounts and flash sales running now in this store (applied automatically, no code needed): what each gives, '
            .'what it applies to, the minimum order and when it ends.',
            Arguments::schema([]),
        );
    }

    public function run(array $input): ToolOutput
    {
        Validator::make(Arguments::only($input, []), [])->validate();

        $offers = [];
        foreach ($this->promotions->liveAutomatic(self::MAX_OFFERS * 2) as $promotion) {
            $appliesTo = $this->appliesTo($promotion['target_type'], $promotion['target_ids']);
            if ($appliesTo === null) {
                continue;
            }
            $offers[] = [
                'name' => $promotion['name'],
                'description' => ShopperText::clip($promotion['description'], 200),
                'kind' => $promotion['kind'],
                'value_text' => $this->valueText($promotion),
                'applies_to' => $appliesTo,
                'min_order_text' => ShopperText::money($promotion['min_subtotal'], $this->currency),
                'max_discount_text' => ShopperText::money($promotion['max_discount'], $this->currency),
                'ends_at' => $promotion['ends_at'],
                'flash_sale' => $promotion['flash_sale'],
            ];
            if (count($offers) >= self::MAX_OFFERS) {
                break;
            }
        }

        return new ToolOutput(data: ['offers' => $offers, 'currency' => $this->currency], params: []);
    }

    /**
     * @param  array<string, mixed>  $promotion
     */
    private function valueText(array $promotion): string
    {
        return match ($promotion['kind']) {
            'percent' => rtrim(rtrim((string) $promotion['value'], '0'), '.').'% off',
            'fixed' => ShopperText::money((string) $promotion['value'], $this->currency).' off'.($promotion['target_type'] === null ? ' the order' : ' per item'),
            'free_shipping' => 'Free delivery',
            default => (string) $promotion['kind'],
        };
    }

    /**
     * "whole order", or the visible targets `{type, items: [{name, path}], more}` (null when none is visible).
     *
     * @param  list<string>  $ids
     * @return array<string, mixed>|string|null
     */
    private function appliesTo(?string $type, array $ids): array|string|null
    {
        if ($type === null) {
            return 'whole order';
        }
        $names = [];
        switch ($type) {
            case 'product':
                foreach ($this->catalog->productCards($ids) as $card) {
                    $names[] = ['name' => $card['name'], 'path' => '/product/'.$card['slug']];
                    if (count($names) <= self::MAX_TARGETS) {
                        $this->findings->productFrom($card, $this->currency);
                    }
                }
                break;
            case 'category':
                foreach ($this->catalog->visibleCategories($ids) as $category) {
                    $names[] = ['name' => $category['name'], 'path' => '/category/'.$category['slug']];
                    $this->findings->link($category['name'], '/category/'.$category['slug']);
                }
                break;
            case 'brand':
                foreach ($this->catalog->visibleBrands($ids) as $brand) {
                    $names[] = ['name' => $brand['name'], 'path' => '/brand/'.$brand['slug']];
                    $this->findings->link($brand['name'], '/brand/'.$brand['slug']);
                }
                break;
        }
        if ($names === []) {
            return null;
        }

        return [
            'type' => $type.'s',
            'items' => array_slice($names, 0, self::MAX_TARGETS),
            'more' => max(0, count($names) - self::MAX_TARGETS),
        ];
    }
}
