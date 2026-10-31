<?php

namespace App\Modules\Cms\Infrastructure\Notifications;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/**
 * Double opt-in e-mail: the subscription becomes active only through the confirm link.
 */
class ConfirmNewsletterSubscription extends Notification implements ShouldQueue
{
    use Queueable;

    public function __construct(
        public readonly string $storeName,
        public readonly string $confirmUrl,
        public readonly string $unsubscribeUrl,
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
        return (new MailMessage)
            ->subject("Confirm your subscription to {$this->storeName}")
            ->line("Someone (hopefully you) asked to receive news and offers from {$this->storeName} at this address.")
            ->action('Confirm subscription', $this->confirmUrl)
            ->line('If you did not ask for this, ignore this e-mail and you will not hear from us.')
            ->line("Changed your mind later? Unsubscribe at any time: {$this->unsubscribeUrl}");
    }
}
