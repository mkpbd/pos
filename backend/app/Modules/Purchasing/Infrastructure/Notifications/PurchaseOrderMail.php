<?php

namespace App\Modules\Purchasing\Infrastructure\Notifications;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/**
 * Queued e-mail with a purchase order attached as PDF (ST2b), sent on demand to the supplier.
 * As RfqRequestMail: the PDF is rendered before queueing (a rendering failure stops the send)
 * and travels base64-encoded in the queued job.
 */
class PurchaseOrderMail extends Notification implements ShouldQueue
{
    use Queueable;

    /**
     * @param  array{number: string, expected_date: ?string, total: string, currency: string}  $order
     */
    public function __construct(
        public readonly string $organizationName,
        public readonly ?string $replyTo,
        public readonly string $supplierName,
        public readonly array $order,
        public readonly string $filename,
        public readonly string $pdfBase64,
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
            ->subject("Purchase order {$this->order['number']} — {$this->organizationName}")
            ->greeting("Dear {$this->supplierName},")
            ->line("Please find attached our purchase order {$this->order['number']} for {$this->order['currency']} {$this->order['total']}.");
        if ($this->order['expected_date'] !== null) {
            $mail->line("We expect delivery by {$this->order['expected_date']}.");
        }
        $mail->line("Please quote {$this->order['number']} on your delivery note and invoice.");
        if ($this->replyTo !== null) {
            $mail->replyTo($this->replyTo, $this->organizationName);
        }

        return $mail->salutation("Regards,\n{$this->organizationName}")
            ->attachData((string) base64_decode($this->pdfBase64, true), $this->filename, ['mime' => 'application/pdf']);
    }

    public function pdf(): string
    {
        return (string) base64_decode($this->pdfBase64, true);
    }
}
