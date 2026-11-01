<?php

namespace App\Modules\Orders\Infrastructure\Notifications;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/**
 * E-mail to the shopper's contact address after staff cancelled their paid order and
 * refunded it (E11).
 */
class OrderCancelledWithRefundEmail extends Notification implements ShouldQueue
{
    use Queueable;

    /**
     * @param  array<string, mixed>  $order  the storefront order view
     */
    public function __construct(
        public readonly string $storeName,
        public readonly array $order,
        public readonly string $refundAmount,
        public readonly string $methodLabel,
        public readonly ?string $orderUrl,
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
        $mail = (new MailMessage)
            ->subject("Your order {$o['number']} at {$this->storeName} was cancelled and refunded")
            ->greeting("Hello {$o['contact']['name']},")
            ->line("We cancelled your order {$o['number']}".(($o['cancel_reason'] ?? null) ? ": {$o['cancel_reason']}" : '.'))
            ->line("We refunded {$this->refundAmount} {$o['currency']} by ".mb_strtolower($this->methodLabel).'. Depending on your bank or provider it can take a few days to arrive.');

        return $this->orderUrl === null ? $mail : $mail->action('View your order', $this->orderUrl);
    }
}
