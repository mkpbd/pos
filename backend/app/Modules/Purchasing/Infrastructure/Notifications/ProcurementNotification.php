<?php

namespace App\Modules\Purchasing\Infrastructure\Notifications;

use Illuminate\Bus\Queueable;
use Illuminate\Notifications\Notification;

/**
 * In-app procurement notifications (SC2), one class for every type:
 * `purchasing.requisition_submitted` / `_approved` / `_rejected`,
 * `purchasing.order_pending_approval` / `purchasing.order_approved` / `purchasing.order_rejected`,
 * `purchasing.rfq_replies_overdue`. Payload: title, message, link (+ ids).
 */
class ProcurementNotification extends Notification
{
    use Queueable;

    /**
     * @param  array<string, mixed>  $payload
     */
    public function __construct(public readonly string $type, public readonly array $payload) {}

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
        return $this->type;
    }
}
