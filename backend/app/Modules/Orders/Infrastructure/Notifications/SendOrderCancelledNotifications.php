<?php

namespace App\Modules\Orders\Infrastructure\Notifications;

use App\Modules\Orders\Application\Events\OrderCancelledByCustomer;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Orders\Presentation\Http\Support\OrderPresenter;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Storefront\Application\Queries\StorefrontConfig;
use App\Modules\Users\Application\Contracts\UserDirectory;
use Illuminate\Support\Facades\Notification;

/**
 * After a customer cancelled their order: a confirmation e-mail to the order's contact
 * address and an inbox notification "Order WEB-000123 cancelled by the customer" to every
 * staff user with `web_orders.view`.
 */
class SendOrderCancelledNotifications
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly UserDirectory $users,
        private readonly OrderPresenter $presenter,
        private readonly StorefrontConfig $storefront,
    ) {}

    public function handle(OrderCancelledByCustomer $event): void
    {
        $this->tenant->runAs($event->organizationId, function () use ($event) {
            /** @var Order|null $order */
            $order = Order::query()->find($event->orderId);
            if ($order === null) {
                return;
            }
            $view = $this->presenter->storefront($order);
            $siteUrl = rtrim($event->siteUrl, '/');

            Notification::route('mail', $order->contact_email)
                ->notify(new OrderCancellationConfirmation($this->storefront->settings()->site_name, $view, $siteUrl.'/account/orders/'.$order->number));

            $recipients = $this->users->withPermission($event->organizationId, 'web_orders.view');
            if ($recipients->isNotEmpty()) {
                Notification::send($recipients, new OrderCancelledNotification([
                    'title' => "Order {$order->number} cancelled by the customer",
                    'message' => $order->cancel_reason === null
                        ? "{$order->contact_name} cancelled the order."
                        : "{$order->contact_name} cancelled the order: {$order->cancel_reason}",
                    'order_id' => $order->id,
                    'number' => $order->number,
                    'reason' => $order->cancel_reason,
                    'url' => '/web-orders/'.$order->id,
                    'link' => '/web-orders/'.$order->id,
                ]));
            }
        });
    }
}
