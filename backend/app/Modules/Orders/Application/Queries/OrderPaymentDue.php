<?php

namespace App\Modules\Orders\Application\Queries;

use App\Modules\OnlinePayments\Application\Contracts\CheckoutPaymentMethods;
use App\Modules\Orders\Domain\OrderPaymentMethod;
use App\Modules\Orders\Domain\OrderStatus;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Orders\Infrastructure\Models\OrderPaymentClaim;
use App\Modules\Shared\Domain\ValueObjects\Money;

/**
 * BD1c: what an order still owes by Send Money. An order owes a payment while it is
 * `pending_payment` (and its hold has not run out) and either
 *
 * - it is paid with a Send Money method — purpose `full`, the total − paid_total, payable with
 *   its own method; or
 * - it is a cash-on-delivery order with an advance not paid yet — purpose `advance`,
 *   min(advance_amount, total) − paid_total, payable with every enabled Send Money method.
 */
class OrderPaymentDue
{
    public function __construct(private readonly CheckoutPaymentMethods $payments) {}

    /**
     * @param  bool  $ignoreExpiry  staff confirming a claim submitted in time may do so after the hold ran out
     * @return array{amount: string, currency: string, purpose: string, expires_at: ?string, methods: list<array{code: string, display_name: string, account_number: ?string, account_type: string, instructions: ?string}>}|null
     */
    public function of(Order $order, bool $ignoreExpiry = false): ?array
    {
        if ($order->status !== OrderStatus::PendingPayment) {
            return null;
        }
        if (! $ignoreExpiry && $order->expires_at !== null && $order->expires_at->isPast()) {
            return null;
        }

        $currency = $order->currency;
        $paid = Money::of((string) $order->paid_total, $currency);
        $total = Money::of((string) $order->total, $currency);
        if ($order->payment_method->isSendMoney()) {
            $purpose = OrderPaymentClaim::PURPOSE_FULL;
            $amount = $total->minus($paid);
            $own = $this->payments->sendMoneyMethod($order->payment_method->value);
            $methods = $own === null ? [] : [$own];
        } elseif ($order->payment_method === OrderPaymentMethod::CashOnDelivery && Money::of((string) $order->advance_amount, $currency)->isPositive()) {
            $purpose = OrderPaymentClaim::PURPOSE_ADVANCE;
            $advance = Money::of((string) $order->advance_amount, $currency);
            $amount = ($advance->greaterThan($total) ? $total : $advance)->minus($paid);
            $methods = $this->payments->sendMoneyMethods();
        } else {
            return null;
        }
        if (! $amount->isPositive()) {
            return null;
        }

        return [
            'amount' => $amount->amount(),
            'currency' => $currency,
            'purpose' => $purpose,
            'expires_at' => $order->expires_at?->toIso8601String(),
            'methods' => $methods,
        ];
    }

    /**
     * The codes a claim against this due may use.
     *
     * @param  array{purpose: string, methods: list<array{code: string}>}  $due
     * @return list<string>
     */
    public static function methodCodes(Order $order, array $due): array
    {
        return $due['purpose'] === OrderPaymentClaim::PURPOSE_FULL
            ? [$order->payment_method->value]
            : array_column($due['methods'], 'code');
    }
}
