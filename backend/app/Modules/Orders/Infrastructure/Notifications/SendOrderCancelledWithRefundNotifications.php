<?php

namespace App\Modules\Orders\Infrastructure\Notifications;

use App\Modules\Orders\Application\Events\OrderCancelledWithRefund;
use App\Modules\Orders\Domain\RefundMethod;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Orders\Presentation\Http\Support\OrderPresenter;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\ValueObjects\Money;
use App\Modules\Storefront\Application\Queries\StorefrontConfig;
use Illuminate\Support\Facades\Notification;

/**
 * After staff cancelled a paid order with a refund (E11): an e-mail to the order's contact
 * address with the amount and method (and a link to the account order page on the primary
 * storefront domain for customers with an account).
 */
class SendOrderCancelledWithRefundNotifications
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly OrderPresenter $presenter,
        private readonly StorefrontConfig $storefront,
    ) {}

    public function handle(OrderCancelledWithRefund $event): void
    {
        $this->tenant->runAs($event->organizationId, function () use ($event) {
            /** @var Order|null $order */
            $order = Order::query()->find($event->orderId);
            if ($order === null) {
                return;
            }
            $site = $this->storefront->primaryUrl();
            $url = $site === null || $order->customer_id === null ? null : $site.'/account/orders/'.$order->number;

            Notification::route('mail', $order->contact_email)->notify(new OrderCancelledWithRefundEmail(
                $this->storefront->settings()->site_name,
                $this->presenter->storefront($order) + ['cancel_reason' => $order->cancel_reason],
                Money::of((string) $order->refunded_total, $order->currency)->amount(),
                RefundMethod::from($event->method)->label(),
                $url,
            ));
        });
    }
}
