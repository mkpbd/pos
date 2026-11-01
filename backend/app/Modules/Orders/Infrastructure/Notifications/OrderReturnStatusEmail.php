<?php

namespace App\Modules\Orders\Infrastructure\Notifications;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/**
 * E-mail to the shopper when staff approve, reject or refund their return (E10b).
 */
class OrderReturnStatusEmail extends Notification implements ShouldQueue
{
    use Queueable;

    /**
     * @param  array<string, mixed>  $return  ReturnPresenter::customer()
     * @param  string  $step  approved | rejected | refunded
     */
    public function __construct(
        public readonly string $storeName,
        public readonly string $contactName,
        public readonly array $return,
        public readonly string $step,
        public readonly ?string $orderUrl,
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
        $r = $this->return;
        $mail = (new MailMessage)->greeting("Hello {$this->contactName},");

        match ($this->step) {
            'approved' => $mail->subject("Your return {$r['number']} at {$this->storeName} was approved")
                ->line("We approved your return {$r['number']} for order {$r['order_number']}.")
                ->line('Please send the items back to us; we refund '.$r['refund_amount'].' '.$r['currency'].' once they arrive.'),
            'rejected' => $mail->subject("Your return {$r['number']} at {$this->storeName} was not accepted")
                ->line("We could not accept your return {$r['number']} for order {$r['order_number']}.")
                ->line('Reason: '.($r['rejection_reason'] ?? '—')),
            default => $mail->subject("Your refund for {$r['number']} at {$this->storeName}")
                ->line("We refunded {$r['refund_amount']} {$r['currency']} for your return {$r['number']} (order {$r['order_number']}) by ".mb_strtolower((string) $r['refund_method_label']).'.'),
        };

        foreach ($r['lines'] as $line) {
            if ($line['quantity'] !== '0') {
                $mail->line("• {$line['quantity']} × {$line['product_name']}".($line['variant_name'] ? " ({$line['variant_name']})" : ''));
            }
        }

        return $this->orderUrl === null ? $mail : $mail->action('View your order', $this->orderUrl);
    }
}
