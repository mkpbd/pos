<?php

namespace App\Modules\Storefront\Infrastructure\Notifications;

use App\Modules\Storefront\Infrastructure\Models\BuilderComment;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;
use App\Modules\Users\Application\Contracts\UserDirectory;
use Illuminate\Support\Facades\Notification;

/**
 * B16: bell notifications of working together in the store builder (database channel, active
 * users of the document's organization only):
 *
 * - `storefront.builder_lock_taken_over` → the previous editor; `storefront.builder_edit_requested`
 *   → the current editor; link `/storefront/builder/<document id>`.
 * - `storefront.builder_comment_mention` → the mentioned staff; `storefront.builder_comment_reply`
 *   → the thread's other participants; link `/storefront/builder/<document id>?comment=<thread id>`.
 *
 * Payload: `{title, message, document_id, document_title, comment_id?, thread_id?, url, link}`.
 * Comment bodies are not copied into notifications.
 */
class BuilderCollaborationNotifier
{
    public function __construct(private readonly UserDirectory $users) {}

    public function tookOver(BuilderDocument $document, string $previousUserId, string $byName): void
    {
        $this->send([$previousUserId], BuilderCollaborationNotification::LOCK_TAKEN_OVER, $document, [
            'title' => "{$byName} took over editing {$document->title}",
            'message' => 'Your editor is now view-only. Changes you had not saved are kept in your browser: use "Copy my changes" to keep them.',
        ]);
    }

    public function editRequested(BuilderDocument $document, string $holderId, string $byName): void
    {
        $this->send([$holderId], BuilderCollaborationNotification::EDIT_REQUESTED, $document, [
            'title' => "{$byName} asks to edit {$document->title}",
            'message' => 'Save your changes and close the editor (or stop editing) so they can take over.',
        ]);
    }

    /**
     * @param  list<string>  $userIds
     */
    public function mentioned(BuilderDocument $document, BuilderComment $comment, array $userIds, string $byName): void
    {
        $this->send($userIds, BuilderCollaborationNotification::COMMENT_MENTION, $document, [
            'title' => "{$byName} mentioned you on {$document->title}",
            'message' => 'Open the page to read the comment and reply.',
        ], $comment);
    }

    /**
     * @param  list<string>  $userIds
     */
    public function replied(BuilderDocument $document, BuilderComment $comment, array $userIds, string $byName): void
    {
        $this->send($userIds, BuilderCollaborationNotification::COMMENT_REPLY, $document, [
            'title' => "{$byName} replied on {$document->title}",
            'message' => 'Open the page to read the reply.',
        ], $comment);
    }

    /**
     * @param  list<string>  $userIds
     * @param  array{title: string, message: string}  $text
     */
    private function send(array $userIds, string $type, BuilderDocument $document, array $text, ?BuilderComment $comment = null): void
    {
        $userIds = array_values(array_unique(array_filter($userIds)));
        if ($userIds === []) {
            return;
        }
        $recipients = $this->users->active($document->organization_id, $userIds);
        if ($recipients->isEmpty()) {
            return;
        }
        $thread = $comment === null ? null : ($comment->parent_id ?? $comment->id);
        $link = '/storefront/builder/'.$document->id.($thread === null ? '' : '?comment='.$thread);
        Notification::send($recipients, new BuilderCollaborationNotification($type, $text + [
            'document_id' => $document->id,
            'document_title' => $document->title,
        ] + ($comment === null ? [] : ['comment_id' => $comment->id, 'thread_id' => $thread]) + [
            'url' => $link,
            'link' => $link,
        ]));
    }
}
