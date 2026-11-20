<?php

namespace App\Modules\AI\Application\Tools\Shopper;

use App\Modules\AI\Application\Tools\AiTool;
use App\Modules\AI\Application\Tools\Arguments;
use App\Modules\AI\Application\Tools\ToolOutput;
use App\Modules\AI\Domain\Llm\ToolDefinition;
use App\Modules\OnlineCatalog\Application\Contracts\StorefrontCatalog;
use App\Modules\OnlinePayments\Application\Contracts\CheckoutPaymentMethods;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\PlainText;
use App\Modules\Shipping\Application\Contracts\ShippingRates;
use Illuminate\Support\Facades\Validator;

/**
 * AI2b: one live product as its page shows it to shoppers — price now (automatic promotion
 * applied), options and which combinations can be bought, specifications, the store's delivery
 * note and the rating. Never cost, stock quantities, SKUs, suppliers or ids; drafts, scheduled,
 * ended, archived and other stores' products are "not found".
 */
final class GetProductTool implements AiTool
{
    public const NAME = 'get_product';

    private const MAX_VARIANTS = 30;

    private const MAX_SPECIFICATIONS = 15;

    public function __construct(
        private readonly StorefrontCatalog $catalog,
        private readonly ShippingRates $shipping,
        private readonly CheckoutPaymentMethods $payments,
        private readonly ShopperFindings $findings,
        private readonly string $currency,
    ) {}

    public function definition(): ToolDefinition
    {
        return new ToolDefinition(
            self::NAME,
            'Details of one product of this store by its slug (from search_products or the page the shopper is on): price now, options '
            .'(size, colour …) and which combinations are available, short description, specifications, delivery note and rating.',
            Arguments::schema([
                'slug' => ['type' => 'string', 'description' => 'The product\'s slug, e.g. "cotton-shirt"'],
            ], ['slug']),
        );
    }

    public function run(array $input): ToolOutput
    {
        $args = Validator::make(Arguments::only($input, ['slug']), [
            'slug' => ['required', 'string', 'max:100', 'regex:/^[\pL\pN-]+$/u'],
        ])->validate();
        $slug = mb_strtolower(trim((string) $args['slug']));

        $id = $this->catalog->liveProductId($slug);
        $product = $id === null ? null : ($this->catalog->productDetails([$id])[$id] ?? null);
        if ($product === null) {
            throw new BusinessRuleViolation('NOT_FOUND', 'Product not found.');
        }
        $this->findings->productFrom($product, $this->currency);

        $variants = [];
        foreach (array_slice($product['variants'] ?? [], 0, self::MAX_VARIANTS) as $variant) {
            $price = $variant['promo_price'] ?? $variant['price'];
            $variants[] = [
                'name' => $variant['name'],
                'options' => (array) $variant['option_values'],
                'price_text' => ShopperText::money((string) $price, $this->currency),
                'available' => (bool) $variant['in_stock'],
            ];
        }

        return new ToolOutput(
            data: [
                'slug' => $product['slug'],
                'name' => $product['name'],
                'url' => '/product/'.$product['slug'],
                'category' => $product['category']['name'] ?? null,
                'brand' => $product['brand']['name'] ?? null,
                'price_text' => ShopperText::price($product, $this->currency),
                'regular_price_text' => ShopperText::regularPrice($product, $this->currency),
                'promotion' => ($product['promotion'] ?? null) === null ? null : [
                    'name' => $product['promotion']['name'],
                    'ends_at' => $product['promotion']['ends_at'],
                ],
                'in_stock' => (bool) $product['in_stock'],
                'unit' => $product['unit'] ?? null,
                'options' => array_map(fn (array $o) => [
                    'name' => $o['name'],
                    'values' => array_map(fn (array $v) => $v['value'], $o['values']),
                ], $product['options'] ?? []),
                'variants' => $variants,
                'more_variants' => max(0, count($product['variants'] ?? []) - self::MAX_VARIANTS),
                'short_description' => ShopperText::clip($product['short_description'] ?? null, 300)
                    ?? PlainText::excerpt($product['description_html'] ?? null, 300),
                'specifications' => array_map(fn ($s) => [
                    'label' => ShopperText::clip((string) ($s['label'] ?? ''), 80),
                    'value' => ShopperText::clip((string) ($s['value'] ?? ''), 200),
                ], array_slice(array_values(array_filter($product['specifications'] ?? [], 'is_array')), 0, self::MAX_SPECIFICATIONS)),
                'delivery_note' => $this->deliveryNote(),
                'rating' => $product['rating'] ?? null,
            ],
            params: ['slug' => mb_substr($slug, 0, 60)],
        );
    }

    /**
     * The store's delivery note (the same for every product), as the product page shows it.
     *
     * @return array{options: list<array<string, mixed>>, cash_on_delivery: bool}|null
     */
    private function deliveryNote(): ?array
    {
        $zones = array_slice($this->shipping->zoneOverview(), 0, 10);
        if ($zones === []) {
            return null;
        }
        $codOn = in_array('cod', array_column($this->payments->enabled(), 'code'), true);

        return [
            'options' => array_map(fn (array $z) => [
                'zone' => $z['zone'],
                'method' => $z['method'],
                'days' => ShopperText::days($z['min_days'], $z['max_days']),
                'fee_text' => ShopperText::money($z['fee'], $this->currency),
                'free_over_text' => ShopperText::money($z['free_over'], $this->currency),
            ], $zones),
            'cash_on_delivery' => $codOn && in_array(true, array_column($zones, 'cod_allowed'), true),
        ];
    }
}
