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
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\ValidationException;

/**
 * Prices a cart exactly as checkout will: current selling prices and tax rates from the
 * catalog (the client never sends prices), discount rules, then the SaleCalculator.
 * Used for the live POS preview and inside checkout, so both always agree.
 *
 * Discount rules (critical rule #4 — validated on the server):
 *  - manual item or invoice discounts need `sales.discount`;
 *  - an item discount may not exceed the product's max. discount % (when set);
 *  - the customer's group discount is applied automatically as the invoice discount when the
 *    cart does not say otherwise, and needs no permission.
 */
class CartPricer
{
    public function __construct(
        private readonly SalesContext $context,
        private readonly ProductDirectory $products,
        private readonly StockLevels $stock,
        private readonly CustomerCredit $credit,
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
     * The priced cart plus the catalog data checkout snapshots onto the invoice.
     *
     * @param  array<string, mixed>  $store
     * @param  array<string, mixed>  $cart
     * @return array{0: array<string, mixed>, 1: array<string, array<string, mixed>>, 2: ?array<string, mixed>}
     */
    public function priceForCheckout(TenantUser $actor, array $store, array $cart): array
    {
        return $this->evaluate($actor, $store, $cart);
    }

    /**
     * @param  array<string, mixed>  $store
     * @param  array<string, mixed>  $cart
     * @return array{0: array<string, mixed>, 1: array<string, array<string, mixed>>, 2: ?array<string, mixed>}
     */
    private function evaluate(TenantUser $actor, array $store, array $cart): array
    {
        $organizationId = $this->context->organizationId();
        $currency = $this->context->currency();
        $taxMode = $this->context->taxMode();
        $canDiscount = Gate::forUser($actor)->allows('sales.discount');

        $customer = filled($cart['customer_id'] ?? null) ? $this->context->requireActiveCustomer($cart['customer_id']) : null;
        $lines = array_values($cart['lines']);
        $variants = $this->products->variants($organizationId, array_column($lines, 'variant_id'));

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

            $discount = Discount::fromArray($line['discount'] ?? null);
            if ($discount !== null && ! $discount->isZero()) {
                $subtotal = Money::ofProduct($quantity, $variant['selling_price'], $currency);
                if (! $canDiscount) {
                    throw new BusinessRuleViolation('DISCOUNT_NOT_ALLOWED', 'You are not allowed to give discounts.', ['line' => $i]);
                }
                $max = $variant['max_discount_percent'];
                if ($max !== null && Decimal::compare($discount->percentOf($subtotal), $max) > 0) {
                    throw new BusinessRuleViolation('DISCOUNT_NOT_ALLOWED', "{$variant['product_name']} can be discounted by at most {$max}%.", ['line' => $i, 'max_percent' => Decimal::round($max, 2)]);
                }
            }

            $calcLines[$i] = [
                'quantity' => $quantity,
                'unit_price' => $variant['selling_price'],
                'tax_rate' => $variant['tax_rate'] ?? '0',
                'discount' => $discount,
            ];
        }

        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        [$invoiceDiscount, $source] = $this->invoiceDiscount($cart, $customer, $canDiscount);
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
            'lines' => array_map(function (int $i) use ($lines, $variants, $calcLines, $totals, $onHand) {
                $variant = $variants[$lines[$i]['variant_id']];

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
                    'discount' => $calcLines[$i]['discount']?->toArray(),
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
        ];

        return [$priced, $variants, $customer];
    }

    /**
     * @param  array<string, mixed>  $cart
     * @param  array<string, mixed>|null  $customer
     * @return array{0: ?Discount, 1: ?string}
     */
    private function invoiceDiscount(array $cart, ?array $customer, bool $canDiscount): array
    {
        $groupPercent = $customer['group_discount_percent'] ?? '0';
        $groupDiscount = Decimal::compare($groupPercent, '0') > 0 ? Discount::percent($groupPercent) : null;

        if (! array_key_exists('invoice_discount', $cart)) {
            return [$groupDiscount, $groupDiscount ? 'customer_group' : null];
        }

        $requested = Discount::fromArray($cart['invoice_discount']);
        if ($requested === null || $requested->isZero()) {
            return [null, null];
        }
        if ($requested->equals($groupDiscount)) {
            return [$requested, 'customer_group'];
        }
        if (! $canDiscount) {
            throw new BusinessRuleViolation('DISCOUNT_NOT_ALLOWED', 'You are not allowed to give discounts.', ['field' => 'invoice_discount']);
        }

        return [$requested, 'manual'];
    }
}
