<?php

namespace App\Modules\Purchasing\Infrastructure\Notifications;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/**
 * Queued e-mail with a request for quotation attached as PDF (SC2), sent on demand to the
 * supplier's address. The PDF is rendered when the RFQ is sent (so a rendering failure stops
 * the send) and travels base64-encoded in the queued job.
 */
class RfqRequestMail extends Notification implements ShouldQueue
{
    use Queueable;

    /**
     * @param  array{number: string, title: string, reply_by: ?string, needed_by: ?string, notes: ?string, line_count: int}  $rfq
     */
    public function __construct(
        public readonly string $organizationName,
        public readonly ?string $replyTo,
        public readonly string $supplierName,
        public readonly array $rfq,
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
            ->subject("Request for quotation {$this->rfq['number']} — {$this->organizationName}")
            ->greeting("Dear {$this->supplierName},")
            ->line("{$this->organizationName} invites you to quote for: {$this->rfq['title']} ({$this->rfq['line_count']} ".($this->rfq['line_count'] === 1 ? 'item' : 'items').').')
            ->line('The attached request lists the items and quantities. Please quote your unit prices (excluding tax), lead times and how long your prices are valid.');
        if ($this->rfq['reply_by'] !== null) {
            $mail->line("Please reply by {$this->rfq['reply_by']}, quoting {$this->rfq['number']}.");
        }
        if ($this->rfq['needed_by'] !== null) {
            $mail->line("We need the goods by {$this->rfq['needed_by']}.");
        }
        if (filled($this->rfq['notes'])) {
            $mail->line((string) $this->rfq['notes']);
        }
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
