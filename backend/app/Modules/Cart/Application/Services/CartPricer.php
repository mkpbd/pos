<?php

namespace App\Modules\Cart\Application\Services;

use App\Modules\Cart\Domain\CartRules;
use App\Modules\Cart\Infrastructure\Models\Cart;
use App\Modules\Cart\Infrastructure\Models\CartItem;
use App\Modules\OnlineCatalog\Application\Contracts\StorefrontCatalog;
use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Promotions\Application\Contracts\PromotionPricing;
use App\Modules\Promotions\Application\DTOs\PromotionQuote;
use App\Modules\Sales\Domain\Discount;
use App\Modules\Sales\Domain\SaleCalculator;
use App\Modules\Sales\Domain\TaxMode;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Shared\Domain\ValueObjects\Money;

/**
 * The one pricing path of the online cart (ADR-005): live catalog data (listing, price,
 * availability, stock at the fulfilment store, tax rate) for every line, then the POS
 * SaleCalculator with the organization's tax mode and currency. Runs on every read and
 * after every write; nothing about prices is stored.
 *
 * Promotions (E8b) join the same path: the Promotions module decides each counted line's
 * product discount and the order discount (automatic promotions + the cart's coupon), which
 * reach SaleCalculator as the line discounts and the invoice discount, so tax is computed
 * after discounts. A line's `discount_amount` is its product discount plus its share of the
 * order discount, so the lines add up to `discount_total`.
 *
 * Lines are never changed on read. A line that is no longer purchasable or is out of stock
 * stays in the cart, flagged, and does not count; a line above the available quantity is
 * flagged `exceeds_stock` and counts with the available quantity.
 */
class CartPricer
{
    public function __construct(
        private readonly StorefrontCatalog $catalog,
        private readonly OrganizationDirectory $organizations,
        private readonly TenantContext $tenant,
        private readonly PromotionPricing $promotions,
    ) {}

    /**
     * @return array<string, mixed> the cart as the storefront shows it
     */
    public function price(?Cart $cart): array
    {
        return $this->quote($cart)['cart'];
    }

    /**
     * The cart as the storefront shows it plus what checkout needs to write an order: per
     * counted line (purchasable and in stock, in cart order) the snapshot data and the
     * SaleCalculator amounts, and the organization's tax mode.
     *
     * `$email` (the contact e-mail at checkout) lets per-customer promotion limits count a
     * guest's earlier orders; `$coupon` prices with another code than the cart's (false =
     * the cart's code, null = none).
     *
     * @return array{
     *   cart: array<string, mixed>,
     *   lines: list<array{variant_id: string, product_id: string, product_slug: ?string, product_name: string, variant_name: ?string,
     *     option_values: array<string, string>, sku: string, image_url: ?string, quantity: string, unit_price: string,
     *     compare_at_price: ?string, tax_rate: string, tracked: bool, line_subtotal: string, discount_amount: string,
     *     net_amount: string, tax_amount: string, line_total: string}>,
     *   tax_mode: TaxMode,
     *   promotions: PromotionQuote
     * }
     */
    public function quote(?Cart $cart, ?string $email = null, string|false|null $coupon = false): array
    {
        $items = $cart === null ? [] : array_map(fn (CartItem $i) => [
            'id' => $i->id,
            'variant_id' => $i->variant_id,
            'quantity' => (string) $i->quantity,
        ], $cart->items()->orderBy('created_at')->orderBy('id')->get()->all());
        $couponCode = $coupon === false ? $cart?->coupon_code : $coupon;

        return $this->quoteItems($items, $cart?->customer_id, $email, $couponCode, $cart?->id);
    }

    /**
     * P2a: the same pricing for lines that are not in a cart (a landing page's order form): each
     * `{id, variant_id, quantity}` in the given order, priced exactly like cart lines (live
     * catalog data, stock at the fulfilment store, promotions, tax) — the cart path reuses it.
     *
     * @param  list<array{id: string, variant_id: string, quantity: string}>  $items
     * @return array{cart: array<string, mixed>, lines: list<array<string, mixed>>, tax_mode: TaxMode, promotions: PromotionQuote}
     */
    public function quoteItems(array $items, ?string $customerId, ?string $email, ?string $couponCode, ?string $cartId = null): array
    {
        $organization = $this->organizations->summary($this->tenant->requireOrganization()) ?? [];
        $currency = (string) ($organization['base_currency'] ?? config('pos.default_currency'));
        $taxMode = TaxMode::tryFrom((string) ($organization['tax_mode'] ?? '')) ?? TaxMode::Exclusive;

        $variants = $this->catalog->variantsForCart(array_values(array_unique(array_column($items, 'variant_id'))));

        $lines = [];
        $calc = [];
        $promoLines = [];
        $issues = [];
        $itemCount = '0';
        foreach ($items as $i => $item) {
            $variant = $variants[$item['variant_id']] ?? null;
            $quantity = Decimal::round((string) $item['quantity'], 3);
            $purchasable = $variant !== null && $variant['purchasable'];
            $inStock = $variant !== null && $variant['in_stock'];
            $max = $variant['max_quantity'] ?? null;
            $exceeds = $purchasable && $inStock && $max !== null && Decimal::compare($quantity, $max) > 0;

            if (! $purchasable) {
                $issues['unavailable'] = true;
            } elseif (! $inStock) {
                $issues['out_of_stock'] = true;
            }
            if ($exceeds) {
                $issues['exceeds_stock'] = true;
            }
            if ($purchasable) {
                $itemCount = Decimal::add($itemCount, $quantity, 3);
            }
            if ($purchasable && $inStock) {
                $calc[$i] = [
                    'quantity' => CartRules::countable($quantity, $max),
                    'unit_price' => $variant['price'],
                    'tax_rate' => $variant['tax_rate'],
                    'discount' => null,
                ];
                $promoLines[] = [
                    'key' => $i,
                    'product_id' => $variant['product_id'],
                    'brand_id' => $variant['brand_id'] ?? null,
                    'category_id' => $variant['category_id'] ?? null,
                    'quantity' => $calc[$i]['quantity'],
                    'unit_price' => $variant['price'],
                ];
            }

            $lines[$i] = [
                'id' => $item['id'],
                'variant_id' => $item['variant_id'],
                'product' => [
                    'id' => $variant['product_id'] ?? null,
                    'slug' => $variant['product_slug'] ?? null,
                    'name' => $variant['product_name'] ?? 'Product no longer available',
                    'url' => ($variant['product_slug'] ?? null) === null ? null : '/product/'.$variant['product_slug'],
                    'image' => $variant['image'] ?? null,
                ],
                'variant_name' => $variant['variant_name'] ?? null,
                'option_values' => (object) ($variant['option_values'] ?? []),
                'sku' => $variant['sku'] ?? '',
                'quantity' => CartRules::display($quantity),
                'unit_price' => $variant['price'] ?? '0.00',
                'compare_at_price' => $variant['compare_at_price'] ?? null,
                'line_total' => '0.00',
                'discount_amount' => '0.00',
                'promotion' => null,
                'purchasable' => $purchasable,
                'in_stock' => $inStock,
                'max_quantity' => $max,
                'exceeds_stock' => $exceeds,
                'allow_decimal' => (bool) ($variant['allow_decimal'] ?? false),
            ];
        }

        $promotions = $this->promotions->price($promoLines, $couponCode, $customerId, $email, $currency);
        foreach (array_keys($calc) as $i) {
            $discount = Discount::amount($promotions->lineDiscount($i));
            $calc[$i]['discount'] = $discount->isZero() ? null : $discount;
        }
        $invoiceDiscount = Discount::amount($promotions->orderDiscount);

        $totals = SaleCalculator::calculate(array_values($calc), $invoiceDiscount->isZero() ? null : $invoiceDiscount, $taxMode, $currency);
        $counted = [];
        foreach (array_keys($calc) as $position => $i) {
            $amounts = $totals['lines'][$position];
            $lineDiscount = Money::of($amounts['discount_amount'], $currency)->plus(Money::of($amounts['invoice_discount_share'], $currency))->amount();
            // Quantity × unit price, so the lines add up to the subtotal.
            $lines[$i]['line_total'] = $amounts['line_subtotal'];
            $lines[$i]['discount_amount'] = $lineDiscount;
            $lines[$i]['promotion'] = $promotions->linePromotion($i);

            $variant = $variants[$items[$i]['variant_id']];
            $counted[] = [
                'variant_id' => $variant['variant_id'],
                'product_id' => $variant['product_id'],
                'product_slug' => $variant['product_slug'],
                'product_name' => $variant['product_name'],
                'variant_name' => $variant['variant_name'],
                'option_values' => $variant['option_values'],
                'sku' => $variant['sku'],
                'image_url' => $variant['image']['url'] ?? null,
                'quantity' => Decimal::round($calc[$i]['quantity'], 3),
                'unit_price' => $variant['price'],
                'compare_at_price' => $variant['compare_at_price'],
                'tax_rate' => Decimal::round($variant['tax_rate'], 4),
                'tracked' => $variant['max_quantity'] !== null,
                'line_subtotal' => $amounts['line_subtotal'],
                'discount_amount' => $lineDiscount,
                'net_amount' => $amounts['net_amount'],
                'tax_amount' => $amounts['tax_amount'],
                'line_total' => $amounts['line_total'],
            ];
        }

        $view = [
            'id' => $lines === [] ? null : $cartId,
            'items' => array_values($lines),
            'item_count' => CartRules::display($itemCount),
            'subtotal' => $totals['subtotal'],
            'discount_total' => $totals['discount_total'],
            'tax_total' => $totals['tax_total'],
            'total' => $totals['total'],
            'promotions' => $promotions->promotions,
            'free_shipping' => $promotions->freeShipping === null ? null : ['id' => $promotions->freeShipping['id'], 'name' => $promotions->freeShipping['name']],
            'coupon' => $promotions->coupon,
            'prices_include_tax' => $taxMode === TaxMode::Inclusive,
            'currency' => $currency,
            'issues' => array_keys($issues),
        ];

        return ['cart' => $view, 'lines' => $counted, 'tax_mode' => $taxMode, 'promotions' => $promotions];
    }
}
