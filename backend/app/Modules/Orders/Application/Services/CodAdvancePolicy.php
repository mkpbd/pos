<?php

namespace App\Modules\Orders\Application\Services;

use App\Modules\OnlinePayments\Application\Contracts\CheckoutPaymentMethods;
use App\Modules\Shared\Domain\BangladeshMobile;
use App\Modules\Shared\Domain\ValueObjects\Money;
use App\Modules\Storefront\Application\Queries\StorefrontConfig;

/**
 * BD1c: the advance delivery charge of cash-on-delivery orders shoppers place themselves (shop
 * and landing-page orders, never staff-entered ones). The store's `cod_advance` decides which
 * COD orders pay part of the money first by bKash / Nagad / Rocket Send Money: `all`, or
 * `risky` (the cash-on-delivery check's rule, CodRiskPolicy::isRisky, on the contact phone).
 * Without an enabled Send Money method it acts as `off` (fail open).
 *
 * The advance is `delivery` (the order's delivery charge + COD fee) or `fixed`
 * (`cod_advance_fixed`, at most the order total); 0 means no advance. Such an order starts
 * `pending_payment` with `advance_amount` (instead of `confirmed` or the confirmation-call hold)
 * and expires after `cod_advance_hold_hours` unless paid.
 */
class CodAdvancePolicy
{
    public function __construct(
        private readonly StorefrontConfig $storefront,
        private readonly CodRiskPolicy $risk,
        private readonly CheckoutPaymentMethods $payments,
    ) {}

    /**
     * The advance a shop COD order with these amounts owes, or null when none applies.
     *
     * @param  ?string  $phone  the contact phone (needed for `risky`)
     */
    public function advanceFor(?string $phone, string $shippingTotal, string $codFee, string $total, string $currency): ?string
    {
        $settings = $this->storefront->settings();
        $mode = $settings->cod_advance ?? 'off';
        if ($mode === 'off' || ! $this->ready()) {
            return null;
        }
        if ($mode === 'risky') {
            $phone = $phone === null ? null : BangladeshMobile::normalize($phone);
            if ($phone === null || ! $this->risk->isRisky($phone)) {
                return null;
            }
        }

        $orderTotal = Money::of($total, $currency);
        $advance = ($settings->cod_advance_amount ?? 'delivery') === 'fixed' && $settings->cod_advance_fixed !== null
            ? Money::of((string) $settings->cod_advance_fixed, $currency)
            : Money::of($shippingTotal, $currency)->plus(Money::of($codFee, $currency));
        if ($advance->greaterThan($orderTotal)) {
            $advance = $orderTotal;
        }

        return $advance->isPositive() ? $advance->amount() : null;
    }

    /**
     * Hours the shopper has to pay the advance.
     */
    public function holdHours(): int
    {
        return (int) ($this->storefront->settings()->cod_advance_hold_hours ?? 24);
    }

    /**
     * Whether an advance can be paid at all (an enabled Send Money method with its number).
     */
    public function ready(): bool
    {
        return $this->payments->sendMoneyMethods() !== [];
    }

    /**
     * Adds `cod_advance` to a checkout preview: `{amount, methods: [{code, display_name,
     * account_number, account_type, instructions}]}` when the preview prices cash on delivery
     * and an advance applies to it, else null.
     *
     * @param  array<string, mixed>  $preview  checkout preview (after CodRiskPolicy::preview)
     * @param  list<string|null>  $phones  the phones the preview was given, contact phone first
     * @return array<string, mixed>
     */
    public function preview(array $preview, array $phones): array
    {
        $advance = null;
        if (($preview['payment_method'] ?? null) === 'cod') {
            $phone = null;
            foreach ($phones as $candidate) {
                $phone ??= is_string($candidate) ? BangladeshMobile::normalize($candidate) : null;
            }
            $amount = $this->advanceFor($phone, (string) $preview['shipping_total'], (string) $preview['cod_fee'], (string) $preview['total'], (string) $preview['currency']);
            $advance = $amount === null ? null : ['amount' => $amount, 'methods' => $this->payments->sendMoneyMethods()];
        }

        return $preview + ['cod_advance' => $advance];
    }
}
