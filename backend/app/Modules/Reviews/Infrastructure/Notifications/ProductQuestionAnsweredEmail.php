<?php

namespace App\Modules\Reviews\Infrastructure\Notifications;

use App\Modules\Shared\Application\Localization\LocaleContext;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/**
 * P1b: the one e-mail a shopper gets when the answer to their question is published, in the
 * language they asked in (English or Bangla), with a link to the product page while it is live.
 */
class ProductQuestionAnsweredEmail extends Notification implements ShouldQueue
{
    use Queueable;

    public function __construct(
        public readonly string $storeName,
        public readonly string $productName,
        public readonly string $question,
        public readonly string $answer,
        public readonly ?string $url,
        public readonly string $language,
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
        if ($this->language === LocaleContext::BN) {
            $message = (new MailMessage)
                ->subject("আপনার প্রশ্নের উত্তর: {$this->productName}")
                ->greeting('শুভেচ্ছা!')
                ->line("{$this->productName} নিয়ে আপনার প্রশ্নের উত্তর দিয়েছে {$this->storeName}।")
                ->line("প্রশ্ন: {$this->question}")
                ->line("উত্তর: {$this->answer}");
            if ($this->url !== null) {
                $message->action('পণ্যটি দেখুন', $this->url);
            }

            return $message->line('এই প্রশ্ন নিয়ে এটিই একমাত্র ই-মেইল।');
        }

        $message = (new MailMessage)
            ->subject("Your question about {$this->productName} was answered")
            ->greeting('Hello!')
            ->line("{$this->storeName} answered your question about {$this->productName}.")
            ->line("Question: {$this->question}")
            ->line("Answer: {$this->answer}");
        if ($this->url !== null) {
            $message->action('View the product', $this->url);
        }

        return $message->line('This is the only e-mail about your question.');
    }
}
