<?php

namespace App\Modules\Reports\Infrastructure\Notifications;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/**
 * R1: the owners' daily summary — in the inbox at once (sync) and as a queued e-mail with the
 * same figures (the recipient's branch scope).
 */
class DailySummaryNotification extends Notification implements ShouldQueue
{
    use Queueable;

    /**
     * @param  array<string, mixed>  $payload
     */
    public function __construct(public readonly array $payload) {}

    /**
     * @return list<string>
     */
    public function via(object $notifiable): array
    {
        return ['database', 'mail'];
    }

    /**
     * @return array<string, string>
     */
    public function viaConnections(): array
    {
        return ['database' => 'sync'];
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(object $notifiable): array
    {
        return $this->payload;
    }

    public function databaseType(object $notifiable): string
    {
        return 'reports.daily_summary';
    }

    public function toMail(object $notifiable): MailMessage
    {
        $p = $this->payload;
        $money = fn (string $amount) => $amount.' '.$p['currency'];
        $mail = (new MailMessage)
            ->subject($p['title'])
            ->line('Sales: '.$money($p['sales_total']).' from '.$p['sales_count'].' sale(s)')
            ->line('Web orders placed: '.$p['web_orders'])
            ->line('Cash collected: '.$money($p['cash_collected']))
            ->line('Refunds: '.$money($p['refunds']))
            ->line('Items low on stock: '.$p['low_stock_count']);
        if ($p['top_products'] !== []) {
            $mail->line('Top products: '.implode(', ', array_map(fn (array $t) => $t['name'].' ('.$money($t['net_sales']).')', $p['top_products'])));
        }

        return $mail->action('Open the dashboard', rtrim((string) config('pos.frontend_url'), '/').'/admin'.$p['link']);
    }
}
