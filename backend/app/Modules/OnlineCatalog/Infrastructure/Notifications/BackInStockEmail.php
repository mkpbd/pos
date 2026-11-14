<?php

namespace App\Modules\OnlineCatalog\Infrastructure\Notifications;

use App\Modules\Shared\Application\Localization\LocaleContext;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/**
 * P1a: the one-shot "back in stock" e-mail, in the language the shopper used (English or
 * Bangla). There is nothing to unsubscribe from: the request ends with this e-mail.
 */
class BackInStockEmail extends Notification implements ShouldQueue
{
    use Queueable;

    public function __construct(
        public readonly string $storeName,
        public readonly string $productName,
        public readonly ?string $variantLabel,
        public readonly string $url,
        public readonly string $language,
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
        $item = $this->variantLabel === null ? $this->productName : "{$this->productName} ({$this->variantLabel})";

        if ($this->language === LocaleContext::BN) {
            return (new MailMessage)
                ->subject("আবার স্টকে এসেছে: {$this->productName}")
                ->greeting('সুখবর!')
                ->line("{$item} আবার {$this->storeName}-এ পাওয়া যাচ্ছে।")
                ->action('পণ্যটি দেখুন', $this->url)
                ->line('স্টক সীমিত, তাই আমরা এটি আপনার জন্য আলাদা করে রাখতে পারি না।')
                ->line('আপনি একবার জানাতে বলেছিলেন — এ বিষয়ে এটিই একমাত্র ই-মেইল, তাই আনসাবস্ক্রাইব করার কিছু নেই।');
        }

        return (new MailMessage)
            ->subject("Back in stock: {$this->productName}")
            ->greeting('Good news!')
            ->line("{$item} is back in stock at {$this->storeName}.")
            ->action('View the product', $this->url)
            ->line('Stock is limited and we cannot hold it for you.')
            ->line('You asked us to tell you once: this is the only e-mail about it, so there is nothing to unsubscribe from.');
    }
}
