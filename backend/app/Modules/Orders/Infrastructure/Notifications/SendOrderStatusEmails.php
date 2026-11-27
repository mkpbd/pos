<?php

namespace App\Modules\Orders\Infrastructure\Notifications;

use App\Modules\Orders\Application\Events\OrderStatusChanged;
use App\Modules\Orders\Domain\OrderStatus;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Storefront\Application\Queries\StorefrontConfig;
use Illuminate\Support\Facades\Notification;
use Throwable;

/**
 * BD2b: the shopper's "on its way" (→ shipped) and "delivered" (→ delivered) e-mails to the
 * order's contact address, while the store's `email_shipped` / `email_delivered` is on. Orders
 * without an e-mail address get none. Links: the store's track page; for a delivered account
 * order the account order page (where the items can be reviewed). A failure is reported, never
 * thrown — the order and its workflow stand.
 */
class SendOrderStatusEmails
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly StorefrontConfig $storefront,
        private readonly SendOrderSms $sms,
    ) {}

    public function __invoke(OrderStatusChanged $event): void
    {
        $step = match ($event->to) {
            OrderStatus::Shipped->value => 'shipped',
            OrderStatus::Delivered->value => 'delivered',
            default => null,
        };
        if ($step === null) {
            return;
        }

        try {
            $this->tenant->runAs($event->organizationId, function () use ($event, $step) {
                $settings = $this->storefront->settings();
                if (! ($step === 'shipped' ? $settings->email_shipped : $settings->email_delivered)) {
                    return;
                }
                /** @var Order|null $order */
                $order = Order::query()->find($event->orderId);
                $email = trim((string) $order?->contact_email);
                if ($order === null || $email === '') {
                    return;
                }

                $site = $this->storefront->primaryUrl();
                $reviewable = $step === 'delivered' && $order->customer_id !== null;
                $url = match (true) {
                    $site === null => null,
                    $reviewable => rtrim($site, '/').'/account/orders/'.rawurlencode($order->number),
                    default => SendOrderSms::trackLink($site, $order),
                };
                $tracking = $step === 'shipped' ? [
                    'courier' => $order->courier_name,
                    'tracking' => $order->tracking_number,
                    'tracking_link' => $this->sms->trackingLink($order),
                ] : [];

                Notification::route('mail', $email)->notify(new OrderShippingStatusEmail(
                    (string) $settings->site_name, $order->contact_name, $order->number, $step, $tracking, $url, $site !== null && $reviewable,
                ));
            });
        } catch (Throwable $e) {
            report($e);
        }
    }
}
