<?php

namespace App\Modules\System\Infrastructure\Notifications;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/**
 * G1b: operations alert e-mail (new or returning error, failed backup, failed restore check) to
 * POS_OPS_ALERT_EMAILS. The texts are already sanitised by the sender.
 */
class OpsAlertNotification extends Notification implements ShouldQueue
{
    use Queueable;

    /**
     * @param  list<string>  $lines
     */
    public function __construct(
        public readonly string $kind,
        public readonly string $subject,
        public readonly array $lines,
        public readonly ?string $actionUrl = null,
        public readonly ?string $actionText = null,
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
        $mail = (new MailMessage)->error()->subject($this->subject);
        foreach ($this->lines as $line) {
            $mail->line($line);
        }
        if ($this->actionUrl !== null) {
            $mail->action($this->actionText ?? 'Open', $this->actionUrl);
        }

        return $mail;
    }
}
