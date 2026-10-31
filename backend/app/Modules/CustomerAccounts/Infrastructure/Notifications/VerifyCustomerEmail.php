<?php

namespace App\Modules\CustomerAccounts\Infrastructure\Notifications;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/**
 * Link that confirms a shopper owns the e-mail address of their store account.
 */
class VerifyCustomerEmail extends Notification implements ShouldQueue
{
    use Queueable;

    public function __construct(
        public readonly string $storeName,
        public readonly string $verifyUrl,
        public readonly int $validHours,
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
            ->subject("Confirm your e-mail address for {$this->storeName}")
            ->line("Thanks for creating an account at {$this->storeName}. Please confirm that this is your e-mail address.")
            ->action('Confirm e-mail address', $this->verifyUrl)
            ->line("The link is valid for {$this->validHours} hours. If you did not create an account, ignore this e-mail.");
    }
}
