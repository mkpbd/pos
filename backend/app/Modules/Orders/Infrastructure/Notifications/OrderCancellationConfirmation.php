<?php

namespace App\Modules\Orders\Infrastructure\Notifications;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/**
 * E-mail to the shopper's contact address after they cancelled their order (E9).
 */
class OrderCancellationConfirmation extends Notification implements ShouldQueue
{
    use Queueable;

    /**
     * @param  array<string, mixed>  $order  the storefront order view
     */
    public function __construct(
        public readonly string $storeName,
        public readonly array $order,
        public readonly string $orderUrl,
    ) {}

    /**
     * @return list<string>
     */
    public function via(object $notifiable): array
    {
        return ['mail'];
    }

    public function toMail(object $notifiable): MailMessage
    {
        $o = $this->order;

        return (new MailMessage)
            ->subject("Your order {$o['number']} at {$this->storeName} was cancelled")
            ->greeting("Hello {$o['contact']['name']},")
            ->line("As you asked, we cancelled your order {$o['number']} ({$o['total']} {$o['currency']}).")
            ->line('Nothing was charged for it.')
            ->action('View your order', $this->orderUrl);
    }
}
