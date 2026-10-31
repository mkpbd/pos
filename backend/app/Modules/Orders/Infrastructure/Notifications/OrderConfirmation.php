<?php

namespace App\Modules\Orders\Infrastructure\Notifications;

use Carbon\CarbonImmutable;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/**
 * Order confirmation e-mail to the shopper's contact address: lines, totals, delivery
 * address, payment instructions (bank transfer) and the link to the order page.
 */
class OrderConfirmation extends Notification implements ShouldQueue
{
    use Queueable;

    /**
     * @param  array<string, mixed>  $order  the storefront order view
     */
    public function __construct(
        public readonly string $storeName,
        public readonly array $order,
        public readonly string $orderUrl,
        public readonly string $timezone = 'UTC',
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
        $o = $this->order;
        $money = fn (string $amount) => $amount.' '.$o['currency'];
        $mail = (new MailMessage)
            ->subject("Your order {$o['number']} at {$this->storeName}")
            ->greeting("Thank you, {$o['contact']['name']}!")
            ->line("We received your order {$o['number']} ({$o['status_label']}).");

        foreach ($o['lines'] as $line) {
            $name = $line['product_name'].($line['variant_name'] ? " ({$line['variant_name']})" : '');
            $mail->line("{$line['quantity']} × {$name} — {$money($line['line_total'])}");
        }

        $mail->line('Subtotal: '.$money($o['subtotal']));
        foreach ($o['promotions'] ?? [] as $promotion) {
            if ($promotion['kind'] !== 'shipping') {
                $mail->line("Discount ({$promotion['name']}): −".$money($promotion['amount']));
            }
        }
        if (($o['coupon_code'] ?? null) !== null) {
            $mail->line("Coupon: {$o['coupon_code']}");
        }
        $mail->line(($o['prices_include_tax'] ? 'VAT included: ' : 'VAT: ').$money($o['tax_total']))
            ->line("Delivery ({$o['shipping_method_name']}): ".$money($o['shipping_total']));
        if (($o['shipping_discount'] ?? '0.00') !== '0.00') {
            $mail->line('Free delivery: '.$money($o['shipping_discount']).' saved');
        }
        if ($o['cod_fee'] !== '0.00') {
            $mail->line('Cash on delivery fee: '.$money($o['cod_fee']));
        }
        $mail->line('Total: '.$money($o['total']))
            ->line("Payment: {$o['payment_method_label']}");

        $a = $o['shipping_address'];
        if ($a !== null) {
            $mail->line('Deliver to: '.implode(', ', array_filter([
                $a['recipient_name'], $a['phone'], $a['address_line'], $a['area'], $a['district'], $a['postcode'],
            ])));
        }
        if ($o['payment_instructions'] !== null) {
            $mail->line('How to pay:')->line($o['payment_instructions']);
            if ($o['expires_at'] !== null) {
                $deadline = CarbonImmutable::parse($o['expires_at'])->setTimezone($this->timezone)->format('j M Y, g:i A');
                $mail->line('Please pay before '.$deadline.' ('.$this->timezone.'); unpaid orders are cancelled after that.');
            }
        }

        return $mail->action('View your order', $this->orderUrl);
    }
}
