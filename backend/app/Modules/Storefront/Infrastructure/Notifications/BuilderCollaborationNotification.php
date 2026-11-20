<?php

namespace App\Modules\Storefront\Infrastructure\Notifications;

use Illuminate\Bus\Queueable;
use Illuminate\Notifications\Notification;

/**
 * B16: in-app alerts of working together in the store builder (BuilderCollaborationNotifier):
 * someone took over editing, asks to edit, mentioned you or replied in a comment thread. `url`
 * (and `link`) open the page in the editor.
 */
class BuilderCollaborationNotification extends Notification
{
    use Queueable;

    public const LOCK_TAKEN_OVER = 'storefront.builder_lock_taken_over';

    public const EDIT_REQUESTED = 'storefront.builder_edit_requested';

    public const COMMENT_MENTION = 'storefront.builder_comment_mention';

    public const COMMENT_REPLY = 'storefront.builder_comment_reply';

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
