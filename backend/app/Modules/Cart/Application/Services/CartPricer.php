<?php

namespace App\Modules\Cart\Application\Services;

use App\Modules\Cart\Domain\CartRules;
use App\Modules\Cart\Infrastructure\Models\Cart;
use App\Modules\Cart\Infrastructure\Models\CartItem;
use App\Modules\OnlineCatalog\Application\Contracts\StorefrontCatalog;
use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Sales\Domain\SaleCalculator;
use App\Modules\Sales\Domain\TaxMode;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\ValueObjects\Decimal;

/**
 * The one pricing path of the online cart (ADR-005): live catalog data (listing, price,
 * availability, stock at the fulfilment store, tax rate) for every line, then the POS
 * SaleCalculator with the organization's tax mode and currency. Runs on every read and
 * after every write; nothing about prices is stored.
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
     * @return array{
     *   cart: array<string, mixed>,
     *   lines: list<array{variant_id: string, product_id: string, product_slug: ?string, product_name: string, variant_name: ?string,
     *     option_values: array<string, string>, sku: string, image_url: ?string, quantity: string, unit_price: string,
     *     compare_at_price: ?string, tax_rate: string, tracked: bool, line_subtotal: string, net_amount: string,
     *     tax_amount: string, line_total: string}>,
     *   tax_mode: TaxMode
     * }
     */
    public function quote(?Cart $cart): array
    {
        $items = $cart === null ? [] : $cart->items()->orderBy('created_at')->orderBy('id')->get()->all();
        $organization = $this->organizations->summary($this->tenant->requireOrganization()) ?? [];
        $currency = (string) ($organization['base_currency'] ?? config('pos.default_currency'));
        $taxMode = TaxMode::tryFrom((string) ($organization['tax_mode'] ?? '')) ?? TaxMode::Exclusive;

        $variants = $this->catalog->variantsForCart(array_map(fn (CartItem $i) => $i->variant_id, $items));

        $lines = [];
        $calc = [];
        $issues = [];
        $itemCount = '0';
        foreach ($items as $i => $item) {
            $variant = $variants[$item->variant_id] ?? null;
            $quantity = Decimal::round((string) $item->quantity, 3);
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
            }

            $lines[$i] = [
                'id' => $item->id,
                'variant_id' => $item->variant_id,
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
                'purchasable' => $purchasable,
                'in_stock' => $inStock,
                'max_quantity' => $max,
                'exceeds_stock' => $exceeds,
                'allow_decimal' => (bool) ($variant['allow_decimal'] ?? false),
            ];
        }

        $totals = SaleCalculator::calculate(array_values($calc), null, $taxMode, $currency);
        $counted = [];
        foreach (array_keys($calc) as $position => $i) {
            // Quantity × unit price, so the lines add up to the subtotal.
            $lines[$i]['line_total'] = $totals['lines'][$position]['line_subtotal'];

            $variant = $variants[$items[$i]->variant_id];
            $amounts = $totals['lines'][$position];
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
                'net_amount' => $amounts['net_amount'],
                'tax_amount' => $amounts['tax_amount'],
                'line_total' => $amounts['line_total'],
            ];
        }

        $view = [
            'id' => $lines === [] ? null : $cart?->id,
            'items' => array_values($lines),
            'item_count' => CartRules::display($itemCount),
            'subtotal' => $totals['subtotal'],
            'tax_total' => $totals['tax_total'],
            'total' => $totals['total'],
            'prices_include_tax' => $taxMode === TaxMode::Inclusive,
            'currency' => $currency,
            'issues' => array_keys($issues),
        ];

        return ['cart' => $view, 'lines' => $counted, 'tax_mode' => $taxMode];
    }
}
