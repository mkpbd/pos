<?php

namespace App\Modules\CustomerAccounts\Infrastructure\Notifications;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/**
 * Password reset link for a store account.
 */
class ResetCustomerPassword extends Notification implements ShouldQueue
{
    use Queueable;

    public function __construct(
        public readonly string $storeName,
        public readonly string $resetUrl,
        public readonly int $validMinutes,
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
            ->subject("Reset your {$this->storeName} password")
            ->line("We received a request to reset the password of your {$this->storeName} account.")
            ->action('Choose a new password', $this->resetUrl)
            ->line("The link is valid for {$this->validMinutes} minutes. If you did not ask for this, you can ignore this e-mail.");
    }
}
