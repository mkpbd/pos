<?php

namespace App\Modules\Cms\Infrastructure\Notifications;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;
use Illuminate\Support\HtmlString;
use Illuminate\Support\Str;
use Symfony\Component\Mime\Email;

/**
 * BD2b: one newsletter campaign e-mail. The markdown body is rendered with raw HTML escaped
 * and unsafe links (javascript:, data: …) dropped. Subscriber copies carry the signed
 * unsubscribe link, also as a `List-Unsubscribe` header; a test copy has "[Test]" in the subject.
 */
class NewsletterCampaignMail extends Notification implements ShouldQueue
{
    use Queueable;

    public function __construct(
        public readonly string $storeName,
        public readonly string $subject,
        public readonly string $body,
        public readonly ?string $unsubscribeUrl,
        public readonly bool $test = false,
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
        $mail = (new MailMessage)
            ->subject(($this->test ? '[Test] ' : '').$this->subject)
            ->greeting($this->subject)
            ->line(self::html($this->body))
            ->salutation($this->storeName);

        $url = $this->unsubscribeUrl;
        if ($url === null) {
            return $mail->line('This is a test copy: subscribers get an unsubscribe link here.');
        }

        return $mail
            ->line(new HtmlString('You receive this e-mail because you subscribed to news from '.e($this->storeName).'. <a href="'.e($url).'">Unsubscribe</a>'))
            ->withSymfonyMessage(fn (Email $message) => $message->getHeaders()->addTextHeader('List-Unsubscribe', "<{$url}>"));
    }

    public static function html(string $markdown): HtmlString
    {
        return new HtmlString(Str::markdown($markdown, ['html_input' => 'escape', 'allow_unsafe_links' => false]));
    }
}
