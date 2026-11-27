<?php

namespace App\Modules\Cart\Infrastructure\Notifications;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/**
 * BD2b: the abandoned-cart reminder e-mail to a signed-in shopper — the items left in the cart
 * (name, quantity, current price) and a link to the store's cart page. From the store's name.
 */
class CartReminderEmail extends Notification implements ShouldQueue
{
    use Queueable;

    /**
     * @param  list<array{name: string, quantity: string, price: string}>  $items
     */
    public function __construct(
        public readonly string $storeName,
        public readonly string $customerName,
        public readonly array $items,
        public readonly string $currency,
        public readonly string $cartUrl,
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
        $mail = (new MailMessage)
            ->subject("You left something in your cart at {$this->storeName}")
            ->greeting("Hello {$this->customerName},")
            ->line('You left these items in your cart:');
        $from = config('mail.from.address');
        if (is_string($from) && $from !== '') {
            $mail->from($from, $this->storeName);
        }

        foreach ($this->items as $item) {
            $mail->line("{$item['quantity']} × {$item['name']} — {$item['price']} {$this->currency}");
        }

        return $mail->line('Prices and stock may change until you place your order.')
            ->action('Go to your cart', $this->cartUrl);
    }
}
