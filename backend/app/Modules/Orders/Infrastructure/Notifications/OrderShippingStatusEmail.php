<?php

namespace App\Modules\Orders\Infrastructure\Notifications;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/**
 * BD2b: e-mail to the shopper when their web order is handed to the courier (`shipped`: courier,
 * tracking number, the courier's tracking link and the store's track page) or delivered
 * (`delivered`: the account order page to review the items, or the track page for guests).
 * Styled like OrderConfirmation; from the store's name.
 */
class OrderShippingStatusEmail extends Notification implements ShouldQueue
{
    use Queueable;

    /**
     * @param  string  $step  shipped | delivered
     * @param  array{courier?: ?string, tracking?: ?string, tracking_link?: ?string}  $tracking
     * @param  ?string  $url  the track page, or the account order page of a delivered account order
     */
    public function __construct(
        public readonly string $storeName,
        public readonly string $contactName,
        public readonly string $orderNumber,
        public readonly string $step,
        public readonly array $tracking,
        public readonly ?string $url,
        public readonly bool $reviewable = false,
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
        $mail = (new MailMessage)->greeting("Hello {$this->contactName},");
        $from = config('mail.from.address');
        if (is_string($from) && $from !== '') {
            $mail->from($from, $this->storeName);
        }

        if ($this->step === 'shipped') {
            $mail->subject("Your order {$this->orderNumber} at {$this->storeName} is on its way")
                ->line("Your order {$this->orderNumber} is on its way.");
            if (($this->tracking['courier'] ?? null) !== null) {
                $mail->line("Courier: {$this->tracking['courier']}");
            }
            if (($this->tracking['tracking'] ?? null) !== null) {
                $mail->line("Tracking number: {$this->tracking['tracking']}");
            }
            if (($this->tracking['tracking_link'] ?? null) !== null) {
                $mail->line("Track with the courier: {$this->tracking['tracking_link']}");
            }

            return $this->url === null ? $mail : $mail->action('Track your order', $this->url);
        }

        $mail->subject("Your order {$this->orderNumber} at {$this->storeName} was delivered")
            ->line("Your order {$this->orderNumber} was delivered. Thank you for shopping with us!");
        if ($this->reviewable) {
            $mail->line('Tell other shoppers what you think of your items.');
        }

        return $this->url === null ? $mail : $mail->action($this->reviewable ? 'Review your items' : 'View your order', $this->url);
    }
}
