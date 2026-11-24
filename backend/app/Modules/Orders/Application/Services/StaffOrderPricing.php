<?php

namespace App\Modules\Orders\Application\Services;

use App\Modules\Branches\Application\Contracts\BranchDirectory;
use App\Modules\Customers\Application\Contracts\CustomerDirectory;
use App\Modules\Customers\Application\Contracts\CustomerOnlineAccounts;
use App\Modules\OnlineCatalog\Application\Contracts\StorefrontCatalog;
use App\Modules\OnlinePayments\Application\Contracts\CheckoutPaymentMethods;
use App\Modules\Orders\Domain\OrderPaymentMethod;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Orders\Infrastructure\Models\OrderLine;
use App\Modules\Promotions\Application\Contracts\PromotionRedemptions;
use App\Modules\Shared\Application\Localization\LocaleContext;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Domain\ValueObjects\Decimal;
use App\Modules\Storefront\Application\Queries\StorefrontConfig;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * BD1b: pricing of orders staff enter or change — the checkout's one pricing path
 * (CheckoutQuoter::quoteLines: live prices, availability at the fulfilment store, promotions
 * with the coupon, tax, delivery and COD fees), used by the staff quote, the staff placement
 * (through PlaceOrder) and the order edit.
 *
 * For an order being edited, the order's own stock counts as available (`held`) and its
 * promotion redemptions do not count towards usage limits: they are released inside a
 * savepoint that is always rolled back, so pricing writes nothing.
 */
class StaffOrderPricing
{
    public function __construct(
        private readonly CheckoutQuoter $quoter,
        private readonly CheckoutPaymentMethods $payments,
        private readonly StorefrontConfig $storefront,
        private readonly BranchDirectory $branches,
        private readonly TenantContext $tenant,
        private readonly PromotionRedemptions $redemptions,
        private readonly CustomerDirectory $customers,
        private readonly CustomerOnlineAccounts $accounts,
        private readonly LocaleContext $locale,
        private readonly StorefrontCatalog $catalog,
    ) {}

    /**
     * The staff quote: the checkout preview shape for the given lines (any subset of the
     * delivery details) + `payment_methods` (the enabled offline methods); each line adds
     * `product_name`, `image_url` and `available` (stock at the fulfilment store — including
     * what the edited order holds — null for untracked products).
     *
     * @param  array<string, mixed>  $data  validated quote body
     * @return array<string, mixed>
     *
     * @throws BusinessRuleViolation|ValidationException
     */
    public function preview(array $data, ?Order $order): array
    {
        $this->ensureCheckoutAvailable();
        $customerId = $order !== null ? $order->customer_id : ($this->customer($data['customer_id'] ?? null)['customer_id'] ?? null);
        $input = [
            'contact' => $data['contact'] ?? null,
            'address' => isset($data['address']['district_id']) ? ['district_id' => (int) $data['address']['district_id']] : null,
            'shipping_method_id' => $data['shipping_method_id'] ?? null,
            // An edit keeps the order's payment method.
            'payment_method' => $order !== null ? $order->payment_method->value : ($data['payment_method'] ?? null),
        ];
        $coupon = self::coupon($data['coupon_code'] ?? null);

        return $this->present($this->locale->runAs(LocaleContext::BASE, fn () => $this->price($order, $data['lines'], $input, $customerId, $coupon, true))['preview']);
    }

    /**
     * A checkout preview in the staff quote shape (lines with `product_name`, `image_url`,
     * `available`; `payment_methods`) — also used for `details.preview` of TOTAL_CHANGED and
     * ITEMS_UNAVAILABLE on staff placement and edits.
     *
     * @param  array<string, mixed>  $preview
     * @return array<string, mixed>
     */
    public function present(array $preview): array
    {
        $preview['lines'] = array_map(fn (array $line) => self::line($line), $preview['lines']);

        return $preview + ['payment_methods' => $this->paymentMethods()];
    }

    /**
     * The same error with its `details.preview` in the staff quote shape.
     */
    public function withStaffPreview(BusinessRuleViolation $e): BusinessRuleViolation
    {
        if (! is_array($e->details['preview'] ?? null) || isset($e->details['preview']['payment_methods'])) {
            return $e;
        }

        return new BusinessRuleViolation($e->errorCode, $e->getMessage(), ['preview' => $this->present($e->details['preview'])] + $e->details, $e->status);
    }

    /**
     * Prices the lines (CheckoutQuoter::quoteLines). With `$order` (an edit): its held stock
     * counts as available and its promotions are released for the pricing only.
     *
     * @param  list<array{variant_id: string, quantity: string}>  $lines
     * @param  array<string, mixed>  $input
     * @return array<string, mixed> the CheckoutQuoter quote
     */
    public function price(?Order $order, array $lines, array $input, ?string $customerId, ?string $coupon, bool $autoPickMethod = false): array
    {
        $lines = array_map(fn (array $l) => ['variant_id' => strtolower((string) $l['variant_id']), 'quantity' => (string) $l['quantity']], array_values($lines));
        if ($order === null) {
            return $this->quoter->quoteLines($lines, $input, $customerId, $autoPickMethod, $coupon);
        }

        $held = self::held($order);
        DB::beginTransaction();
        try {
            $this->redemptions->release($order->id);

            return $this->quoter->quoteLines($lines, $input, $customerId, $autoPickMethod, $coupon, $held);
        } finally {
            DB::rollBack();
        }
    }

    /**
     * What the order's lines hold now, by variant.
     *
     * @return array<string, string>
     */
    public static function held(Order $order): array
    {
        $held = [];
        foreach ($order->lines()->get(['variant_id', 'quantity']) as $line) {
            /** @var OrderLine $line */
            $held[$line->variant_id] = Decimal::add($held[$line->variant_id] ?? '0', (string) $line->quantity, 3);
        }

        return $held;
    }

    /**
     * The existing customer an order is entered for: `{customer_id, account_id}` (the linked
     * online account, if any), null for a guest order.
     *
     * @return array{customer_id: string, account_id: ?string}|null
     *
     * @throws ValidationException customer_id
     */
    public function customer(?string $customerId): ?array
    {
        if ($customerId === null || $customerId === '') {
            return null;
        }
        $customer = $this->customers->find(strtolower($customerId), $this->tenant->requireOrganization());
        if ($customer === null || $customer['archived']) {
            throw ValidationException::withMessages(['customer_id' => ['Choose an existing customer.']]);
        }

        return ['customer_id' => $customer['id'], 'account_id' => $this->accounts->accountId($customer['id'])];
    }

    /**
     * @throws BusinessRuleViolation CHECKOUT_UNAVAILABLE
     */
    public function ensureCheckoutAvailable(): void
    {
        $storeId = $this->storefront->settings()->fulfilment_store_id;
        $store = $storeId === null ? null : $this->branches->store($storeId, $this->tenant->requireOrganization());
        if ($store === null || ! $store['is_active'] || ! $store['branch_is_active']) {
            throw new BusinessRuleViolation('CHECKOUT_UNAVAILABLE', 'Online ordering is not available right now. Please try again later.', ['reason' => 'no_fulfilment_store']);
        }
    }

    /**
     * The enabled offline payment methods: `[{code, name}]`.
     *
     * @return list<array{code: string, name: string}>
     */
    public function paymentMethods(): array
    {
        $codes = array_map(fn (OrderPaymentMethod $m) => $m->value, OrderPaymentMethod::cases());

        return array_values(array_map(
            fn (array $m) => ['code' => $m['code'], 'name' => $m['display_name']],
            array_filter($this->payments->enabled(), fn (array $m) => in_array($m['code'], $codes, true)),
        ));
    }

    /**
     * The language of the customer's e-mails and text messages: the given one, else the
     * store's default.
     */
    public function locale(?string $locale): string
    {
        if (in_array($locale, LocaleContext::SUPPORTED, true)) {
            return $locale;
        }
        $settings = $this->storefront->settings();

        return $settings->bangla_enabled && in_array($settings->default_locale, LocaleContext::SUPPORTED, true) ? $settings->default_locale : LocaleContext::EN;
    }

    public static function coupon(mixed $code): ?string
    {
        return is_string($code) && trim($code) !== '' ? trim($code) : null;
    }

    /**
     * Products sold in whole units ordered in fractions: field errors `lines.N.quantity`.
     *
     * @param  list<array{variant_id: string, quantity: string}>  $lines
     *
     * @throws ValidationException
     */
    public function assertWholeQuantities(array $lines): void
    {
        $variants = $this->catalog->variantsForCart(array_values(array_unique(array_column($lines, 'variant_id'))));
        $errors = [];
        foreach (array_values($lines) as $i => $line) {
            $quantity = Decimal::round((string) $line['quantity'], 3);
            $allowDecimal = (bool) ($variants[$line['variant_id']]['allow_decimal'] ?? false);
            if (! $allowDecimal && Decimal::compare($quantity, Decimal::round($quantity, 0)) !== 0) {
                $errors["lines.{$i}.quantity"] = ['This product is sold in whole units.'];
            }
        }
        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }
    }

    /**
     * @param  array<string, mixed>  $line  a CartPricer line
     * @return array<string, mixed>
     */
    private static function line(array $line): array
    {
        return $line + [
            'product_name' => $line['product']['name'] ?? null,
            'image_url' => $line['product']['image']['url'] ?? null,
            'available' => $line['max_quantity'] ?? null,
        ];
    }
}
