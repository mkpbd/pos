<?php

namespace App\Modules\Storefront\Infrastructure\Notifications;

use Illuminate\Bus\Queueable;
use Illuminate\Notifications\Notification;

/**
 * B8b: in-app alert for staff with forms.view — a visitor sent a builder form. `link` opens the
 * submission in the admin (`/content/forms/<id>`).
 */
class FormSubmissionNotification extends Notification
{
    use Queueable;

    public const TYPE = 'storefront.form_submitted';

    /**
     * @param  array<string, mixed>  $payload
     */
    public function __construct(private readonly array $payload) {}

    /**
     * @return list<string>
     */
    public function via(object $notifiable): array
    {
        return ['database'];
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(object $notifiable): array
    {
        return $this->payload;
    }

    public function databaseType(object $notifiable): string
    {
        return self::TYPE;
    }
}
