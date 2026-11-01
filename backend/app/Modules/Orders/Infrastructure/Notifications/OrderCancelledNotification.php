<?php

namespace App\Modules\Orders\Infrastructure\Notifications;

use Illuminate\Bus\Queueable;
use Illuminate\Notifications\Notification;

/**
 * In-app alert for staff: a customer cancelled their web order. `url` opens it in the admin.
 */
class OrderCancelledNotification extends Notification
{
    use Queueable;

    /**
     * @param  array<string, mixed>  $payload
     */
    public function __construct(private readonly array $payload) {}

    /**
     * @return list<string>
     */
    public function via(object $notifiable): array
    {
        return ['database'];
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(object $notifiable): array
    {
        return $this->payload;
    }

    public function databaseType(object $notifiable): string
    {
        return 'orders.order_cancelled_by_customer';
    }
}
