<?php

namespace App\Modules\Orders\Infrastructure\Notifications;

use App\Modules\Orders\Application\Events\OrderReturnRequested;
use App\Modules\Orders\Application\Events\OrderReturnUpdated;
use App\Modules\Orders\Infrastructure\Models\OrderReturn;
use App\Modules\Orders\Presentation\Http\Support\ReturnPresenter;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Storefront\Application\Queries\StorefrontConfig;
use App\Modules\Users\Application\Contracts\UserDirectory;
use Illuminate\Support\Facades\Notification;

/**
 * Online return notifications (E10b): a customer's new request → inbox notification to every
 * staff user with `web_orders.refund`; approved, rejected and refunded → e-mail to the order's
 * contact address (with a link to the account order page on the primary storefront domain).
 */
class SendOrderReturnNotifications
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly UserDirectory $users,
        private readonly ReturnPresenter $presenter,
        private readonly StorefrontConfig $storefront,
    ) {}

    public function requested(OrderReturnRequested $event): void
    {
        $this->tenant->runAs($event->organizationId, function () use ($event) {
            /** @var OrderReturn|null $return */
            $return = OrderReturn::query()->with('order')->find($event->returnId);
            if ($return === null) {
                return;
            }
            $recipients = $this->users->withPermission($event->organizationId, 'web_orders.refund');
            if ($recipients->isEmpty()) {
                return;
            }
            Notification::send($recipients, new OrderReturnRequestedNotification([
                'title' => "Return {$return->number} requested for order {$return->order->number}",
                'message' => "{$return->order->contact_name} asked to return items ({$return->reason_code->label()}) worth {$return->refund_amount} {$return->currency}.",
                'return_id' => $return->id,
                'number' => $return->number,
                'order_id' => $return->order_id,
                'order_number' => $return->order->number,
                'url' => '/web-returns/'.$return->id,
                'link' => '/web-returns/'.$return->id,
            ]));
        });
    }

    public function updated(OrderReturnUpdated $event): void
    {
        $this->tenant->runAs($event->organizationId, function () use ($event) {
            /** @var OrderReturn|null $return */
            $return = OrderReturn::query()->with('order')->find($event->returnId);
            if ($return === null || $return->order->contact_email === null) {
                // P2a: a landing page order may have no e-mail address.
                return;
            }
            $site = $this->storefront->primaryUrl();
            $url = $site === null || $return->order->customer_id === null ? null : $site.'/account/orders/'.$return->order->number;

            Notification::route('mail', $return->order->contact_email)->notify(new OrderReturnStatusEmail(
                $this->storefront->settings()->site_name,
                $return->order->contact_name,
                $this->presenter->customer($return),
                $event->step,
                $url,
            ));
        });
    }
}
