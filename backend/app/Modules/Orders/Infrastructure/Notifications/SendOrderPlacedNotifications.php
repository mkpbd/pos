<?php

namespace App\Modules\Orders\Infrastructure\Notifications;

use App\Modules\Orders\Application\Events\OrderPlaced;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Orders\Presentation\Http\Support\OrderPresenter;
use App\Modules\Organizations\Application\Contracts\OrganizationDirectory;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Storefront\Application\Queries\StorefrontConfig;
use App\Modules\Users\Application\Contracts\UserDirectory;
use Illuminate\Support\Facades\Notification;

/**
 * After a web order is placed: the confirmation e-mail to the shopper's contact address and
 * an inbox notification "New online order WEB-000123" to every staff user with
 * `web_orders.view`.
 */
class SendOrderPlacedNotifications
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly UserDirectory $users,
        private readonly OrderPresenter $presenter,
        private readonly StorefrontConfig $storefront,
        private readonly OrganizationDirectory $organizations,
    ) {}

    public function handle(OrderPlaced $event): void
    {
        $this->tenant->runAs($event->organizationId, function () use ($event) {
            /** @var Order|null $order */
            $order = Order::query()->find($event->orderId);
            if ($order === null) {
                return;
            }
            $view = $this->presenter->storefront($order);
            $url = rtrim($event->siteUrl, '/').'/order/'.$order->number.($event->accessToken === null ? '' : '?token='.$event->accessToken);

            // P2a: a landing page order may have no e-mail address (phone only).
            if ($order->contact_email !== null) {
                Notification::route('mail', $order->contact_email)
                    ->notify(new OrderConfirmation($this->storefront->settings()->site_name, $view, $url, $this->organizations->summary($event->organizationId)['timezone'] ?? 'UTC'));
            }

            $recipients = $this->users->withPermission($event->organizationId, 'web_orders.view');
            if ($recipients->isNotEmpty()) {
                Notification::send($recipients, new NewOnlineOrderNotification([
                    'title' => "New online order {$order->number}",
                    'message' => sprintf('%s ordered %s %s (%s).', $order->contact_name, $view['total'], $order->currency, $view['payment_method_label']),
                    'order_id' => $order->id,
                    'number' => $order->number,
                    'total' => $view['total'],
                    'url' => '/web-orders/'.$order->id,
                    'link' => '/web-orders/'.$order->id,
                ]));
            }
        });
    }
}
