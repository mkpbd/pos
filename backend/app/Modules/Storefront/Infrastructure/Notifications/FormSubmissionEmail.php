<?php

namespace App\Modules\Storefront\Infrastructure\Notifications;

use Illuminate\Bus\Queueable;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/**
 * B8b: a plain e-mail to a form's extra recipient (`notify_email`): the field labels and the
 * answers; replying goes to the visitor's reply-to address when the form has one.
 */
class FormSubmissionEmail extends Notification
{
    use Queueable;

    /**
     * @param  list<array{label: string, value: string}>  $answers
     */
    public function __construct(
        public readonly string $storeName,
        public readonly string $formTitle,
        public readonly array $answers,
        public readonly ?string $replyTo,
        public readonly ?string $pagePath,
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
        $message = (new MailMessage)
            ->subject("New form submission: {$this->formTitle}")
            ->line("Someone sent the form \"{$this->formTitle}\" on {$this->storeName}".($this->pagePath === null ? '.' : " (page {$this->pagePath})."));
        foreach ($this->answers as $answer) {
            $message->line("{$answer['label']}: {$answer['value']}");
        }
        if ($this->replyTo !== null) {
            $message->replyTo($this->replyTo)->line('Reply to this e-mail to answer the visitor.');
        }

        return $message;
    }
}
