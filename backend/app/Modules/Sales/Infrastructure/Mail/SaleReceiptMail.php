<?php

namespace App\Modules\Sales\Infrastructure\Mail;

use App\Modules\Shared\Domain\ValueObjects\Decimal;
use Carbon\CarbonImmutable;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Address;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

/**
 * POS1d: a till sale's digital receipt by e-mail — the public receipt (header, lines, totals,
 * payments, exchange, footer) as HTML, plus the link to the receipt page when the store has
 * one. From the organization's name; queued and dispatched only after the sending transaction
 * commits.
 */
class SaleReceiptMail extends Mailable implements ShouldQueue
{
    use Queueable, SerializesModels;

    /**
     * @param  array<string, mixed>  $receipt  the public receipt view (PublicReceiptPresenter)
     */
    public function __construct(
        public readonly string $organizationName,
        public readonly array $receipt,
        public readonly ?string $receiptUrl,
    ) {
        $this->afterCommit();
    }

    public function envelope(): Envelope
    {
        $from = (string) config('mail.from.address');

        return new Envelope(
            from: $from !== '' ? new Address($from, $this->organizationName) : null,
            subject: "Your receipt {$this->receipt['number']} from {$this->organizationName}",
        );
    }

    public function content(): Content
    {
        return new Content(htmlString: $this->receiptHtml());
    }

    public function receiptHtml(): string
    {
        $r = $this->receipt;
        $e = fn (mixed $value) => e((string) $value);
        $money = fn (mixed $amount) => $e($amount).' '.$e($r['currency']);
        $row = fn (string $label, string $value, bool $strong = false) => '<tr><td style="padding:2px 0">'.($strong ? "<strong>{$label}</strong>" : $label).'</td>'
            .'<td style="padding:2px 0;text-align:right">'.($strong ? "<strong>{$value}</strong>" : $value).'</td></tr>';
        $header = $r['receipt'];
        $timezone = is_string($header['timezone'] ?? null) && $header['timezone'] !== '' ? $header['timezone'] : 'UTC';

        $html = '<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;color:#111">';
        $html .= '<h2 style="margin:0 0 4px;text-align:center">'.$e($header['organization_name'] ?? $this->organizationName).'</h2>';
        $branch = $header['branch'] ?? null;
        if (is_array($branch)) {
            $html .= '<p style="margin:0;text-align:center;color:#555">'.$e(implode(' · ', array_filter([$branch['name'] ?? null, $branch['address'] ?? null, $branch['phone'] ?? null]))).'</p>';
        }
        if (filled($header['header'] ?? null)) {
            $html .= '<p style="text-align:center;white-space:pre-line">'.$e($header['header']).'</p>';
        }
        if ($header['is_tax_invoice'] ?? false) {
            $html .= '<p style="text-align:center;margin:4px 0">Tax invoice · BIN '.$e($header['tax_number']).'</p>';
        }
        if ($r['status'] === 'cancelled') {
            $html .= '<p style="text-align:center;color:#b91c1c;font-weight:bold">This sale has been cancelled.</p>';
        }

        $html .= '<p style="margin:12px 0 4px">Receipt <strong>'.$e($r['number']).'</strong><br>'
            .$e(CarbonImmutable::parse($r['sold_at'])->setTimezone($timezone)->format('j M Y, g:i A'));
        if ($r['customer'] !== null && filled($r['customer']['name'] ?? null)) {
            $html .= '<br>Customer: '.$e($r['customer']['name']);
        }
        if ($r['cashier'] !== null) {
            $html .= '<br>Served by: '.$e($r['cashier']['name']);
        }
        $html .= '</p>';

        $html .= '<table style="width:100%;border-collapse:collapse;border-top:1px solid #ddd;border-bottom:1px solid #ddd;margin:8px 0">';
        foreach ($r['lines'] as $line) {
            $name = $e($line['product_name']).(filled($line['variant_name']) ? ' ('.$e($line['variant_name']).')' : '');
            $detail = $e($line['quantity']).' × '.$e($line['unit_price']);
            if (! Decimal::isZero((string) ($line['discount_amount'] ?? '0'))) {
                $detail .= ' − '.$e($line['discount_amount']);
            }
            $html .= '<tr><td style="padding:4px 0">'.$name.'<br><span style="color:#555;font-size:12px">'.$detail.'</span></td>'
                .'<td style="padding:4px 0;text-align:right;vertical-align:top">'.$e($line['line_total']).'</td></tr>';
        }
        $html .= '</table><table style="width:100%;border-collapse:collapse">';
        $html .= $row('Subtotal', $money($r['subtotal']));
        $discount = Decimal::add((string) $r['item_discount_total'], (string) $r['invoice_discount_total'], 2);
        if (! Decimal::isZero($discount)) {
            $html .= $row('Discount', '−'.$money($discount));
        }
        $html .= $row($r['tax_mode'] === 'inclusive' ? 'VAT included' : 'VAT', $money($r['tax_total']));
        $html .= $row('Total', $money($r['total']), true);
        foreach ($r['payments'] as $payment) {
            $label = $e($payment['method_label']).($payment['gift_card_last4'] !== null ? ' ••••'.$e($payment['gift_card_last4']) : '');
            $html .= $row($label, $money($payment['amount']));
        }
        if (Decimal::compare((string) $r['change_total'], '0') > 0) {
            $html .= $row('Change', $money($r['change_total']));
        }
        if (Decimal::compare((string) $r['due_total'], '0') > 0) {
            $html .= $row('Due', $money($r['due_total']));
        }
        $html .= '</table>';

        $exchange = $r['exchange'];
        if ($exchange !== null) {
            $html .= '<p style="margin:12px 0 4px"><strong>Exchanged from '.$e($exchange['original_sale_number']).'</strong> (return '.$e($exchange['return_number']).')</p><ul style="margin:0;padding-left:18px">';
            foreach ($exchange['lines'] as $line) {
                $html .= '<li>'.$e($line['quantity']).' × '.$e($line['product_name']).(filled($line['variant_name']) ? ' ('.$e($line['variant_name']).')' : '').' — '.$e($line['line_total']).'</li>';
            }
            $html .= '</ul><p style="margin:4px 0">Exchange credit used: '.$money($exchange['applied']).'</p>';
        }

        if (filled($header['footer'] ?? null)) {
            $html .= '<p style="text-align:center;white-space:pre-line;margin-top:16px">'.$e($header['footer']).'</p>';
        }
        if ($this->receiptUrl !== null) {
            $html .= '<p style="text-align:center;margin-top:16px"><a href="'.$e($this->receiptUrl).'">View or print your receipt</a></p>';
        }

        return $html.'</div>';
    }
}
