<?php

namespace App\Modules\Orders\Application\Actions;

use App\Modules\Orders\Application\Events\OrderCancelledByCustomer;
use App\Modules\Orders\Domain\OrderStatus;
use App\Modules\Orders\Domain\PaymentStatus;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use Illuminate\Support\Facades\DB;

/**
 * A customer cancels their own order from the account area (E9). Allowed while it is
 * awaiting payment or confirmed and nothing was paid (paid orders need a refund, E10);
 * otherwise ORDER_NOT_CANCELLABLE. The E8a cancel path does the work in the same locked
 * transaction — stock back to the exact batches, history with actor `customer` — and
 * afterwards staff get an inbox notification and the shopper a confirmation e-mail.
 * Retries with the same Idempotency-Key replay the first answer (endpoint middleware).
 */
class CancelOwnOrder
{
    public function __construct(private readonly CancelOrder $cancel) {}

    public static function allowed(Order $order): bool
    {
        return in_array($order->status, [OrderStatus::PendingPayment, OrderStatus::Confirmed], true)
            && $order->payment_status === PaymentStatus::Unpaid;
    }

    /**
     * @throws BusinessRuleViolation ORDER_NOT_CANCELLABLE (details.status, details.payment_status)
     */
    public function __invoke(Order $order, string $customerId, ?string $reason, string $siteUrl): Order
    {
        $cancelled = DB::transaction(function () use ($order, $customerId, $reason) {
            /** @var Order $locked */
            $locked = Order::query()->whereKey($order->id)->where('customer_id', $customerId)->lockForUpdate()->firstOrFail();
            if (! self::allowed($locked)) {
                throw new BusinessRuleViolation(
                    'ORDER_NOT_CANCELLABLE',
                    $locked->payment_status->isPaid()
                        ? "{$locked->number} is paid; please contact us to cancel it."
                        : "{$locked->number} is {$locked->status->label()} and can no longer be cancelled.",
                    ['status' => $locked->status->value, 'payment_status' => $locked->payment_status->value],
                );
            }

            return $this->cancel->cancelLocked($locked, $reason, null, 'customer');
        });

        event(new OrderCancelledByCustomer($cancelled->organization_id, $cancelled->id, $siteUrl));

        return $cancelled;
    }
}
