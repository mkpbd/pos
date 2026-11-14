<?php

namespace App\Modules\Reviews\Infrastructure\Notifications;

use Illuminate\Bus\Queueable;
use Illuminate\Notifications\Notification;

/**
 * P1b: in-app alert for staff with reviews.moderate — a shopper asked a question about a
 * product. `link` opens the pending questions in the admin (`/reviews/questions?status=pending`).
 */
class ProductQuestionNotification extends Notification
{
    use Queueable;

    public const TYPE = 'reviews.question_asked';

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
