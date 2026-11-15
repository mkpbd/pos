<?php

namespace App\Modules\Storefront\Infrastructure\Notifications;

use Illuminate\Bus\Queueable;
use Illuminate\Notifications\Notification;

/**
 * B11: in-app alerts of the store builder's publishing workflow (BuilderPublishingNotifier):
 * a page waiting for approval, approved, sent back, or a scheduled publish that failed. `url`
 * (and `link`) open the page in the admin.
 */
class BuilderPublishingNotification extends Notification
{
    use Queueable;

    public const REVIEW_SUBMITTED = 'storefront.builder_review_submitted';

    public const REVIEW_APPROVED = 'storefront.builder_review_approved';

    public const REVIEW_SENT_BACK = 'storefront.builder_review_sent_back';

    public const SCHEDULE_FAILED = 'storefront.builder_schedule_failed';

    /**
     * @param  array<string, mixed>  $payload
     */
    public function __construct(private readonly string $type, private readonly array $payload) {}

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
        return $this->type;
    }
}
