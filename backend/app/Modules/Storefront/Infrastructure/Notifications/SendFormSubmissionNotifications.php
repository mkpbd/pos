<?php

namespace App\Modules\Storefront\Infrastructure\Notifications;

use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Storefront\Application\Events\FormSubmitted;
use App\Modules\Storefront\Application\Queries\StorefrontConfig;
use App\Modules\Storefront\Domain\Forms\FormAnswers;
use App\Modules\Storefront\Infrastructure\Models\BuilderFormSubmission;
use App\Modules\Users\Application\Contracts\UserDirectory;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Notification;
use Throwable;

/**
 * B8b: after a visitor sent a builder form (queued, after commit): an inbox notification "New
 * form submission: <form title>" to every staff user with `forms.view`, and a plain e-mail to the
 * form's extra recipient when it has one (Reply-To: the visitor's reply-to answer). A mail
 * failure is logged and never undoes the submission or the inbox notification.
 */
class SendFormSubmissionNotifications implements ShouldQueue
{
    public function __construct(
        private readonly TenantContext $tenant,
        private readonly UserDirectory $users,
        private readonly StorefrontConfig $storefront,
    ) {}

    public function handle(FormSubmitted $event): void
    {
        $this->tenant->runAs($event->organizationId, function () use ($event) {
            /** @var BuilderFormSubmission|null $submission */
            $submission = BuilderFormSubmission::query()->find($event->submissionId);
            if ($submission === null) {
                return;
            }

            $recipients = $this->users->withPermission($event->organizationId, 'forms.view');
            if ($recipients->isNotEmpty()) {
                $link = '/content/forms/'.$submission->id;
                Notification::send($recipients, new FormSubmissionNotification([
                    'title' => "New form submission: {$submission->form_title}",
                    'message' => FormAnswers::summary($submission->fields, $submission->values),
                    'submission_id' => $submission->id,
                    'document_id' => $submission->document_id,
                    'element_id' => $submission->element_id,
                    'form_title' => $submission->form_title,
                    'url' => $link,
                    'link' => $link,
                ]));
            }

            if ($event->notifyEmail !== null) {
                try {
                    Notification::route('mail', $event->notifyEmail)->notify(new FormSubmissionEmail(
                        $this->storefront->settings()->site_name,
                        $submission->form_title,
                        array_map(fn (array $field) => ['label' => $field['label'], 'value' => FormAnswers::text($submission->values[$field['id']] ?? null)], $submission->fields),
                        $submission->reply_to,
                        $submission->page_path,
                    ));
                } catch (Throwable $e) {
                    Log::warning('Form submission e-mail failed', ['submission_id' => $submission->id, 'error' => $e->getMessage()]);
                }
            }
        });
    }
}
