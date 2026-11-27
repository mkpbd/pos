<?php

namespace App\Modules\Sales\Application\Services;

use App\Modules\Inventory\Application\Contracts\StockLevels;
use App\Modules\Products\Application\Contracts\ProductDirectory;
use App\Modules\Sales\Domain\Discount;
use App\Modules\Sales\Domain\SaleCalculator;
use App\Modules\Shared\Application\Contracts\TenantUser;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Shared\Domain\ValueObjects\Money;
use Illuminate\Validation\ValidationException;

/**
 * Prices a cart exactly as checkout will: current list prices (ST2c: branch, wholesale and
 * quantity-break prices) and tax rates from the catalog (the client sends a price only for
 * open-price products and approved price changes — POS1a, TillPriceRules), discount rules,
 * till promotions, then the SaleCalculator.
 * Used for the live POS preview and inside checkout, so both always agree.
 *
 * Discount rules (critical rule #4 — validated on the server):
 *  - manual item or invoice discounts need `sales.discount` or (POS1a) a manager's approval;
 *  - an item discount may not exceed the product's max. discount % (when set), for everyone;
 *  - the customer's group discount is applied automatically as the invoice discount when the
 *    cart does not say otherwise, and needs no permission;
 *  - POS1a: till promotions and the coupon (TillPromotions): one discount per line (manual >
 *    promotion) and one on the invoice (manual > order promotion / coupon > customer group).
 */
class CartPricer
{
    public function __construct(
        private readonly SalesContext $context,
        private readonly ProductDirectory $products,
        private readonly StockLevels $stock,
        private readonly CustomerCredit $credit,
        private readonly TillPromotions $promotions,
    ) {}

    /**
     * @param  array{id: string, code: string, name: string, branch_id: string, branch_code?: string, branch_name: string}  $store
     * @param  array{customer_id?: ?string, lines: list<array{variant_id: string, quantity: string|int|float, discount?: ?array{type: string, value: string}}>, invoice_discount?: ?array{type: string, value: string}}  $cart
     * @return array<string, mixed> the priced cart as shown to the cashier (no cost data)
     *
     * @throws ValidationException|BusinessRuleViolation
     */
    public function price(TenantUser $actor, array $store, array $cart): array
    {
        return $this->evaluate($actor, $store, $cart)[0];
    }

    /**
     * The priced cart plus the catalog data checkout snapshots onto the invoice and (POS1a)
     * what checkout must settle: the approvals used (to consume), the promotion redemptions
     * and the applied coupon code.
     *
     * @param  array<string, mixed>  $store
     * @param  array<string, mixed>  $cart
     * @return array{0: array<string, mixed>, 1: array<string, array<string, mixed>>, 2: ?array<string, mixed>, 3: array{price_approvals: array<int, array{id: string, approver_id: string, approver_name: string}>, discount_approval: ?array{id: string, approver_id: string, approver_name: string}, redemptions: list<array{promotion_id: string, coupon_id: ?string, name: string, kind: string, amount: string}>, coupon_code: ?string}}
     */
    public function priceForCheckout(TenantUser $actor, array $store, array $cart): array
    {
        return $this->evaluate($actor, $store, $cart);
    }

    /**
     * @param  array<string, mixed>  $store
     * @param  array<string, mixed>  $cart
     * @return array{0: array<string, mixed>, 1: array<string, array<string, mixed>>, 2: ?array<string, mixed>, 3: array<string, mixed>}
     */
    private function evaluate(TenantUser $actor, array $store, array $cart): array
    {
        $organizationId = $this->context->organizationId();
        $currency = $this->context->currency();
        $taxMode = $this->context->taxMode();
        $rules = new TillPriceRules($actor, $cart['discount_approval_id'] ?? null, $store['id']);
        $prices = [];
        $manual = [];

        $customer = filled($cart['customer_id'] ?? null) ? $this->context->requireActiveCustomer($cart['customer_id']) : null;
        $lines = array_values($cart['lines']);
        $variants = $this->products->variants($organizationId, array_column($lines, 'variant_id'));
        // ST2c: list prices — the store's branch prices and the customer's price level.
        $branchPrices = $this->products->branchPrices($organizationId, $store['branch_id'], array_keys($variants));
        $wholesale = ($customer['price_level'] ?? null) === 'wholesale';

        $errors = [];
        $calcLines = [];
        foreach ($lines as $i => $line) {
            $variant = $variants[$line['variant_id']] ?? null;
            $quantity = Decimal::round((string) $line['quantity'], 3);

            if ($variant === null) {
                $errors["lines.{$i}.variant_id"] = ['This product does not exist.'];

                continue;
            }
            if (! $variant['sellable']) {
                $errors["lines.{$i}.variant_id"] = ["{$variant['product_name']} is not for sale (archived or inactive)."];
            }
            if (! $variant['allow_decimal'] && ! Decimal::isWhole($quantity)) {
                $errors["lines.{$i}.quantity"] = ["{$variant['product_name']} is sold in whole units ({$variant['unit_code']})."];
            }

            // POS1a: list (ST2c: catalog / branch, wholesale, tier), open (typed) or overridden price.
            $prices[$i] = $rules->linePrice($i, $line, $variant, $quantity, $branchPrices[$variant['variant_id']] ?? null, $wholesale);

            $discount = Discount::fromArray($line['discount'] ?? null);
            $manual[$i] = '0';
            if ($discount !== null && ! $discount->isZero()) {
                $subtotal = Money::ofProduct($quantity, $prices[$i]['unit_price'], $currency);
                $rules->authorizeDiscount(['line' => $i]);
                $max = $variant['max_discount_percent'];
                if ($max !== null && Decimal::compare($discount->percentOf($subtotal), $max) > 0) {
                    throw new BusinessRuleViolation('DISCOUNT_NOT_ALLOWED', "{$variant['product_name']} can be discounted by at most {$max}%.", ['line' => $i, 'max_percent' => Decimal::round($max, 2)]);
                }
                $manual[$i] = $discount->of($subtotal)->amount();
            }

            $calcLines[$i] = [
                'quantity' => $quantity,
                'unit_price' => $prices[$i]['unit_price'],
                'tax_rate' => $variant['tax_rate'] ?? '0',
                'discount' => $discount,
            ];
        }

        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        // POS1a: till promotions and the coupon; a line's promotion only where nothing manual applies.
        $quote = $this->promotions->quote($this->promotionLines($lines, $variants, $calcLines, $prices, $manual), $cart['coupon_code'] ?? null, $customer, $currency);
        foreach (array_keys($calcLines) as $i) {
            if (Decimal::isZero($manual[$i]) && Decimal::compare($quote->lineDiscount($i), '0') > 0) {
                $calcLines[$i]['discount'] = Discount::amount($quote->lineDiscount($i));
            }
        }

        [$invoiceDiscount, $source] = $this->invoiceDiscount($cart, $customer, $rules, $quote->orderDiscount);
        $outcome = TillPromotions::outcome($quote, $source === 'promotion');
        $totals = SaleCalculator::calculate(array_values($calcLines), $invoiceDiscount, $taxMode, $currency);

        $tracked = array_filter($variants, fn (array $v) => $v['track_stock']);
        $onHand = $this->stock->onHand($store['id'], array_keys($tracked));

        $priced = [
            'store' => ['id' => $store['id'], 'code' => $store['code'], 'name' => $store['name'], 'branch_id' => $store['branch_id'], 'branch_name' => $store['branch_name']],
            'customer' => $customer === null ? null : [
                'id' => $customer['id'],
                'code' => $customer['code'],
                'name' => $customer['name'],
                'phone' => $customer['phone'],
                'group_discount_percent' => $customer['group_discount_percent'],
                'credit' => $this->credit->position($customer),
            ],
            'currency' => $currency,
            'tax_mode' => $taxMode->value,
            'lines' => array_map(function (int $i) use ($lines, $variants, $calcLines, $totals, $onHand, $prices, $manual, $quote) {
                $variant = $variants[$lines[$i]['variant_id']];
                $approval = $prices[$i]['approval'];
                $promotion = Decimal::isZero($manual[$i]) ? $quote->linePromotion($i) : null;
                $promotionDiscount = $promotion === null ? '0.00' : $quote->lineDiscount($i);

                return [
                    'position' => $i,
                    'variant_id' => $variant['variant_id'],
                    'product_id' => $variant['product_id'],
                    'product_name' => $variant['product_name'],
                    'variant_name' => $variant['variant_name'],
                    'sku' => $variant['sku'],
                    'unit_code' => $variant['unit_code'],
                    'allow_decimal' => $variant['allow_decimal'],
                    'track_stock' => $variant['track_stock'],
                    'track_batches' => $variant['track_batches'],
                    'track_serials' => $variant['track_serials'],
                    'max_discount_percent' => $variant['max_discount_percent'],
                    'quantity' => $calcLines[$i]['quantity'],
                    'unit_price' => Decimal::round($calcLines[$i]['unit_price'], 2),
                    'tax_rate' => Decimal::round($calcLines[$i]['tax_rate'], 4),
                    // The manual item discount (a promotion's is in `promotion`).
                    'discount' => Discount::fromArray($lines[$i]['discount'] ?? null)?->toArray(),
                    // POS1a: list (catalog) price vs. the price charged, and the line's promotion.
                    'list_price' => $prices[$i]['list_price'],
                    'price_source' => $prices[$i]['source'],
                    'price_approved_by' => $approval === null ? null : ['id' => $approval['approver_id'], 'name' => $approval['approver_name']],
                    'open_price' => (bool) ($variant['open_price'] ?? false),
                    'promotion' => $promotion === null ? null : ['name' => $promotion['name'], 'amount' => $promotionDiscount],
                    'promotion_discount' => $promotionDiscount,
                    // Informational: checkout re-checks under lock.
                    'available' => $variant['track_stock'] ? $onHand[$variant['variant_id']] : null,
                    ...$totals['lines'][$i],
                ];
            }, array_keys($calcLines)),
            'invoice_discount' => $invoiceDiscount === null ? null : [...$invoiceDiscount->toArray(), 'source' => $source],
            'subtotal' => $totals['subtotal'],
            'item_discount_total' => $totals['item_discount_total'],
            'invoice_discount_total' => $totals['invoice_discount_total'],
            'discount_total' => $totals['discount_total'],
            'net_total' => $totals['net_total'],
            'tax_total' => $totals['tax_total'],
            'total' => $totals['total'],
            // POS1a: promotions used, the coupon's outcome, what the customer saves.
            'promotions' => $outcome['promotions'],
            'coupon' => $outcome['coupon'],
            'savings_total' => $this->savings($calcLines, $prices, $totals['discount_total'], $currency),
            'discount_approved_by' => ($a = $rules->discountApproval()) === null ? null : ['id' => $a['approver_id'], 'name' => $a['approver_name']],
        ];

        return [$priced, $variants, $customer, [
            'price_approvals' => array_filter(array_map(fn (array $p) => $p['approval'], $prices)),
            'discount_approval' => $rules->discountApproval(),
            'redemptions' => $outcome['redemptions'],
            'coupon_code' => $outcome['coupon_code'],
        ]];
    }

    /**
     * POS1a: the engine's lines — a line with a changed or typed price, or a manual discount,
     * gets no promotion; its manual discount counts before the order promotion.
     *
     * @param  list<array<string, mixed>>  $lines
     * @param  array<string, array<string, mixed>>  $variants
     * @param  array<int, array{quantity: string, unit_price: string, tax_rate: string, discount: ?Discount}>  $calcLines
     * @param  array<int, array{unit_price: string, list_price: ?string, source: string, approval: ?array<string, string>}>  $prices
     * @param  array<int, string>  $manual
     * @return list<array{key: int, product_id: string, brand_id: ?string, category_id: ?string, quantity: string, unit_price: string, promotable: bool, own_discount: string}>
     */
    private function promotionLines(array $lines, array $variants, array $calcLines, array $prices, array $manual): array
    {
        $result = [];
        foreach ($calcLines as $i => $calc) {
            $variant = $variants[$lines[$i]['variant_id']];
            $result[] = [
                'key' => $i,
                'product_id' => $variant['product_id'],
                'brand_id' => $variant['brand_id'] ?? null,
                'category_id' => $variant['category_id'] ?? null,
                'quantity' => $calc['quantity'],
                'unit_price' => $calc['unit_price'],
                'promotable' => $prices[$i]['source'] === TillPriceRules::SOURCE_CATALOG && Decimal::isZero($manual[$i]),
                'own_discount' => $manual[$i],
            ];
        }

        return $result;
    }

    /**
     * POS1a: list price above the charged price (never negative per line) plus every discount.
     *
     * @param  array<int, array{quantity: string, unit_price: string}>  $calcLines
     * @param  array<int, array{list_price: ?string}>  $prices
     */
    private function savings(array $calcLines, array $prices, string $discountTotal, string $currency): string
    {
        $savings = Money::of($discountTotal, $currency);
        foreach ($calcLines as $i => $calc) {
            if ($prices[$i]['list_price'] === null) {
                continue;
            }
            $difference = Money::ofProduct($calc['quantity'], $prices[$i]['list_price'], $currency)->minus(Money::ofProduct($calc['quantity'], $calc['unit_price'], $currency));
            if ($difference->isPositive()) {
                $savings = $savings->plus($difference);
            }
        }

        return $savings->amount();
    }

    /**
     * The one invoice-level discount: manual > order promotion / coupon (POS1a) > customer group.
     *
     * @param  array<string, mixed>  $cart
     * @param  array<string, mixed>|null  $customer
     * @return array{0: ?Discount, 1: ?string} the discount and its source (manual | promotion | customer_group)
     */
    private function invoiceDiscount(array $cart, ?array $customer, TillPriceRules $rules, string $orderPromotion): array
    {
        $groupPercent = $customer['group_discount_percent'] ?? '0';
        $groupDiscount = Decimal::compare($groupPercent, '0') > 0 ? Discount::percent($groupPercent) : null;
        $requested = array_key_exists('invoice_discount', $cart) ? Discount::fromArray($cart['invoice_discount']) : null;

        if ($requested !== null && ! $requested->isZero() && ! $requested->equals($groupDiscount)) {
            $rules->authorizeDiscount(['field' => 'invoice_discount']);

            return [$requested, 'manual'];
        }
        if (Decimal::compare($orderPromotion, '0') > 0) {
            return [Discount::amount($orderPromotion), 'promotion'];
        }
        if (! array_key_exists('invoice_discount', $cart)) {
            return [$groupDiscount, $groupDiscount ? 'customer_group' : null];
        }
        if ($requested === null || $requested->isZero()) {
            return [null, null];
        }

        return [$requested, 'customer_group'];
    }
}
