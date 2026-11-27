<?php

namespace App\Modules\Orders\Infrastructure\Notifications;

use App\Modules\Orders\Application\Events\OrderPlaced;
use App\Modules\Orders\Application\Events\OrderStatusChanged;
use App\Modules\Orders\Domain\OrderStatus;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Infrastructure\Export\ExportValues;
use App\Modules\Shipping\Application\Contracts\CourierDirectory;
use App\Modules\Sms\Application\Contracts\SmsSender;
use App\Modules\Storefront\Application\Queries\StorefrontConfig;
use Closure;
use Throwable;

/**
 * BD1a: the shopper's order text messages, queued through SmsSender::orderEvent (which skips
 * switched-off templates, an SMS set-up that is not ready, and duplicates per order + event):
 * placed (`order_placed`), payment confirmed (`order_confirmed`, only pending_payment →
 * confirmed), handed to the courier (`order_shipped`, with courier, tracking number and the
 * courier's tracking link), delivered (`order_delivered`) and cancelled (`order_cancelled`).
 *
 * To the order's contact mobile number, in the order's language. `{link}`: a guest's order page
 * with its one-time token on `order_placed` (the token exists only then), else the store's
 * "track my order" page for the number. A failure is reported, never thrown — the order and
 * its workflow stand.
 */
class SendOrderSms
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly SmsSender $sms,
        private readonly StorefrontConfig $storefront,
        private readonly CourierDirectory $couriers,
    ) {}

    public function placed(OrderPlaced $event): void
    {
        $this->safely($event->organizationId, $event->orderId, function (Order $order) use ($event) {
            $site = rtrim($event->siteUrl, '/');
            $link = $event->accessToken === null
                ? self::trackLink($site, $order)
                : $site.'/order/'.rawurlencode($order->number).'?token='.rawurlencode($event->accessToken);

            return ['order_placed', ['link' => $link]];
        });
    }

    public function statusChanged(OrderStatusChanged $event): void
    {
        $name = match ($event->to) {
            OrderStatus::Confirmed->value => $event->from === OrderStatus::PendingPayment->value ? 'order_confirmed' : null,
            OrderStatus::Shipped->value => 'order_shipped',
            OrderStatus::Delivered->value => 'order_delivered',
            OrderStatus::Cancelled->value => 'order_cancelled',
            default => null,
        };
        if ($name === null) {
            return;
        }

        $this->safely($event->organizationId, $event->orderId, function (Order $order) use ($name) {
            $site = $this->storefront->primaryUrl();
            $vars = ['link' => $site === null ? null : self::trackLink($site, $order)];
            if ($name === 'order_shipped') {
                $vars += [
                    'courier' => $order->courier_name,
                    'tracking' => $order->tracking_number,
                    'tracking_link' => $this->trackingLink($order),
                ];
            }

            return [$name, $vars];
        });
    }

    /**
     * @param  Closure(Order): (array{0: string, 1: array<string, string|null>}|null)  $message
     */
    private function safely(string $organizationId, string $orderId, Closure $message): void
    {
        try {
            $this->tenant->runAs($organizationId, function () use ($organizationId, $orderId, $message) {
                /** @var Order|null $order */
                $order = Order::query()->find($orderId);
                if ($order === null || $order->contact_phone === '') {
                    return;
                }
                $result = $message($order);
                if ($result === null) {
                    return;
                }
                [$event, $vars] = $result;

                $this->sms->orderEvent($organizationId, $event, $order->contact_phone, $order->locale ?? 'en', $vars + [
                    'name' => $order->contact_name,
                    'order' => $order->number,
                    'total' => ExportValues::grouped((string) $order->total, 2),
                ], $order->id);
            });
        } catch (Throwable $e) {
            report($e);
        }
    }

    /** The store's "track my order" page for the order (BD2b: also linked by SendOrderStatusEmails). */
    public static function trackLink(string $site, Order $order): string
    {
        return rtrim($site, '/').'/track-order?number='.rawurlencode($order->number);
    }

    /** The courier's tracking page for the order's shipment, or null (BD2b: also for the e-mails). */
    public function trackingLink(Order $order): ?string
    {
        $shipment = $order->shipment;
        if ($shipment === null || $shipment->courier_id === null || $shipment->tracking_number === null) {
            return null;
        }
        $courier = $this->couriers->find($shipment->courier_id);

        return $this->couriers->trackingUrl($courier['tracking_url_template'] ?? null, $shipment->tracking_number);
    }
}
