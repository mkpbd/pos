<?php

namespace App\Modules\Authentication\Infrastructure\Notifications;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/**
 * G1a: e-mail to a staff user when two-factor sign-in on their account was turned on, turned
 * off, or reset by an administrator — so an unexpected change does not go unnoticed.
 */
class TwoFactorChangedNotification extends Notification implements ShouldQueue
{
    use Queueable;

    public const ENABLED = 'enabled';

    public const DISABLED = 'disabled';

    public const RESET = 'reset';

    /**
     * @param  self::ENABLED|self::DISABLED|self::RESET  $change
     */
    public function __construct(public readonly string $change) {}

    /**
     * @return list<string>
     */
    public function via(object $notifiable): array
    {
        return ['mail'];
    }

    public function toMail(object $notifiable): MailMessage
    {
        $message = match ($this->change) {
            self::ENABLED => (new MailMessage)
                ->subject('Two-factor sign-in was turned on')
                ->line('Two-factor sign-in was turned on for your account. From now on you sign in with your password and a code from your authenticator app.')
                ->line('Keep your recovery codes somewhere safe: each one lets you sign in once if you lose your phone.'),
            self::DISABLED => (new MailMessage)
                ->subject('Two-factor sign-in was turned off')
                ->line('Two-factor sign-in was turned off for your account. You now sign in with your password only.'),
            default => (new MailMessage)
                ->subject('Your two-factor sign-in was reset')
                ->line('An administrator reset two-factor sign-in for your account. Your authenticator app and recovery codes no longer work.')
                ->line('If your organization requires two-factor sign-in, you will be asked to set it up again the next time you sign in.'),
        };

        return $message
            ->line("If this wasn't you, change your password and contact your administrator right away.")
            ->action('Open your profile', rtrim((string) config('pos.frontend_url'), '/').'/admin/profile');
    }
}
