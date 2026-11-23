<?php

namespace App\Modules\Authentication\Infrastructure\Notifications;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/**
 * G1a: e-mail to a staff user whose account was locked after many failed sign-ins.
 */
class AccountLockedNotification extends Notification implements ShouldQueue
{
    use Queueable;

    public function __construct(public readonly int $minutes) {}

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
            ->subject('Your account was locked')
            ->line("Your account was locked after many failed sign-ins. You can try again in {$this->minutes} minutes, or ask your administrator to unlock it.")
            ->line("If this wasn't you, someone may know your e-mail address: reset your password and consider turning on two-factor sign-in.")
            ->action('Reset your password', rtrim((string) config('pos.frontend_url'), '/').'/admin/forgot-password');
    }
}
