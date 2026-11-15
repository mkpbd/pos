<?php

namespace App\Modules\Storefront\Infrastructure\Notifications;

use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Storefront\Infrastructure\Models\BuilderDocument;
use App\Modules\Storefront\Infrastructure\Models\BuilderReview;
use App\Modules\Storefront\Infrastructure\Models\BuilderSchedule;
use App\Modules\Users\Application\Contracts\UserDirectory;
use Illuminate\Support\Facades\Notification;

/**
 * B11: bell notifications of the builder's publishing workflow (database channel, written in the
 * caller's transaction):
 *
 * - `storefront.builder_review_submitted` → every active user with storefront.publish but the
 *   submitter; link `/storefront/pages?review=<review id>`.
 * - `storefront.builder_review_approved` / `storefront.builder_review_sent_back` → the submitter
 *   (when still active); link `/storefront/builder/<document id>`.
 * - `storefront.builder_schedule_failed` → whoever scheduled it; link `/storefront/builder/<document
 *   id>` (the theme: `/storefront/theme`).
 *
 * Payload: `{title, message, document_id, document_title, review_id?, schedule_id?, url, link}`.
 */
class BuilderPublishingNotifier
{
    public function __construct(
        private readonly UserDirectory $users,
        private readonly TenantContext $tenant,
    ) {}

    public function reviewSubmitted(BuilderReview $review, BuilderDocument $document, ?string $submitterName): void
    {
        $recipients = $this->users->withPermission($this->tenant->requireOrganization(), 'storefront.publish')
            ->reject(fn ($user) => (string) $user->getAuthIdentifier() === $review->submitted_by)->values();
        if ($recipients->isEmpty()) {
            return;
        }
        $link = '/storefront/pages?review='.$review->id;
        Notification::send($recipients, new BuilderPublishingNotification(BuilderPublishingNotification::REVIEW_SUBMITTED, [
            'title' => "Waiting for your approval: {$document->title}",
            'message' => ($submitterName ?? 'Someone').' sent changes to this page for review.'.($review->note === null ? '' : ' Note: '.$review->note),
            'document_id' => $document->id,
            'document_title' => $document->title,
            'review_id' => $review->id,
            'url' => $link,
            'link' => $link,
        ]));
    }

    public function reviewDecided(BuilderReview $review, BuilderDocument $document, ?BuilderSchedule $schedule = null): void
    {
        if ($review->submitted_by === null) {
            return;
        }
        $recipients = $this->users->active($this->tenant->requireOrganization(), [$review->submitted_by]);
        if ($recipients->isEmpty()) {
            return;
        }
        $approved = $review->status === BuilderReview::APPROVED;
        $link = '/storefront/builder/'.$document->id;
        Notification::send($recipients, new BuilderPublishingNotification(
            $approved ? BuilderPublishingNotification::REVIEW_APPROVED : BuilderPublishingNotification::REVIEW_SENT_BACK,
            [
                'title' => ($approved ? 'Approved: ' : 'Sent back: ').$document->title,
                'message' => match (true) {
                    ! $approved => 'Your changes need more work: '.$review->comment,
                    $schedule !== null => 'Your changes were approved and will be published at the scheduled time ('.$schedule->publish_at->toIso8601String().').',
                    default => 'Your changes were approved and are now live.',
                },
                'document_id' => $document->id,
                'document_title' => $document->title,
                'review_id' => $review->id,
                'schedule_id' => $schedule?->id,
                'publish_at' => $schedule?->publish_at->toIso8601String(),
                'url' => $link,
                'link' => $link,
            ],
        ));
    }

    public function scheduleFailed(BuilderSchedule $schedule, BuilderDocument $document): void
    {
        if ($schedule->created_by === null) {
            return;
        }
        $recipients = $this->users->active($this->tenant->requireOrganization(), [$schedule->created_by]);
        if ($recipients->isEmpty()) {
            return;
        }
        $theme = $document->kind === BuilderDocument::KIND_THEME;
        $link = $theme ? '/storefront/theme' : '/storefront/builder/'.$document->id;
        Notification::send($recipients, new BuilderPublishingNotification(BuilderPublishingNotification::SCHEDULE_FAILED, [
            'title' => 'Scheduled publish failed: '.($theme ? 'Theme' : $document->title),
            'message' => ($schedule->failure['message'] ?? 'The changes could not be published.').' Nothing was changed on the store.',
            'document_id' => $document->id,
            'document_title' => $theme ? 'Theme' : $document->title,
            'schedule_id' => $schedule->id,
            'url' => $link,
            'link' => $link,
        ]));
    }
}
