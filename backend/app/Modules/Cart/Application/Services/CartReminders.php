<?php

namespace App\Modules\Cart\Application\Services;

use App\Modules\Cart\Infrastructure\Models\Cart;
use App\Modules\Cart\Infrastructure\Notifications\CartReminderEmail;
use App\Modules\Customers\Application\Contracts\CustomerDirectory;
use App\Modules\Customers\Application\Contracts\CustomerWebOrders;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\BangladeshMobile;
use App\Modules\Sms\Application\Contracts\SmsSender;
use App\Modules\Storefront\Application\Queries\StorefrontConfig;
use Carbon\CarbonImmutable;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Notification;
use Throwable;

/**
 * BD2b: abandoned-cart reminders to signed-in shoppers (runs in the organization's context).
 *
 * A cart is due while the store is open and `cart_reminders` is on: it belongs to a customer,
 * is not converted, has items, was last changed between `cart_reminder_after_hours` and 7 days
 * ago and has had no reminder; the customer is active, not archived, and placed no web order
 * since the cart's last change. Each cart is claimed once (`reminder_sent_at` set by one
 * conditional update), then gets a queued e-mail when the customer has an address, else the
 * `cart_reminder` SMS while SMS is ready and the text is on; a cart that can be reached neither
 * way is left unclaimed. A failure on one cart is reported and the others go on.
 */
class CartReminders
{
    public const MAX_AGE_DAYS = 7;

    /** "Ordered" in the summary: an order within this many days after the reminder. */
    public const ORDERED_WITHIN_DAYS = 7;

    public function __construct(
        private readonly TenantContext $tenant,
        private readonly StorefrontConfig $storefront,
        private readonly CustomerDirectory $customers,
        private readonly CustomerWebOrders $orders,
        private readonly SmsSender $sms,
        private readonly CartPricer $pricer,
    ) {}

    /** Sends the organization's due reminders; returns how many went out. */
    public function send(): int
    {
        $settings = $this->storefront->settings();
        $site = $this->storefront->primaryUrl();
        if (! $settings->cart_reminders || ! $settings->is_enabled || $site === null) {
            return 0;
        }

        $organizationId = $this->tenant->requireOrganization();
        $context = [
            'organization_id' => $organizationId,
            'shop' => (string) $settings->site_name,
            'link' => rtrim($site, '/').'/cart',
            'locale' => $settings->bangla_enabled && $settings->default_locale === 'bn' ? 'bn' : 'en',
            'sms' => $this->sms->ready($organizationId) && $this->sms->templateEnabled($organizationId, SmsSender::CART_REMINDER),
        ];
        $now = CarbonImmutable::now();
        $sent = 0;

        Cart::query()
            ->whereNotNull('customer_id')->whereNull('converted_order_id')->whereNull('reminder_sent_at')
            ->where('updated_at', '<=', $now->subHours(max(1, (int) $settings->cart_reminder_after_hours))->utc())
            ->where('updated_at', '>=', $now->subDays(self::MAX_AGE_DAYS)->utc())
            ->whereHas('items')
            ->chunkById(100, function (Collection $carts) use ($context, &$sent) {
                $customers = $this->customers->summaries($context['organization_id'], $carts->pluck('customer_id')->unique()->values()->all());
                $ordered = array_flip($this->orders->orderedWithin($carts->mapWithKeys(fn (Cart $c) => [
                    $c->id => ['customer_id' => (string) $c->customer_id, 'from' => $c->updated_at, 'to' => null],
                ])->all()));

                foreach ($carts as $cart) {
                    $customer = $customers[$cart->customer_id] ?? null;
                    if ($customer === null || ! $customer['is_active'] || $customer['archived'] || isset($ordered[$cart->id])) {
                        continue;
                    }
                    try {
                        $sent += $this->remind($cart, $customer, $context) ? 1 : 0;
                    } catch (Throwable $e) {
                        report($e);
                    }
                }
            });

        return $sent;
    }

    /**
     * Reminders sent in the last 30 days, and how many of those customers placed a web order
     * within 7 days after their reminder.
     *
     * @return array{sent_30d: int, ordered_30d: int}
     */
    public function summary(): array
    {
        $sent = 0;
        $ordered = 0;
        Cart::query()->whereNotNull('customer_id')
            ->where('reminder_sent_at', '>=', CarbonImmutable::now()->subDays(30)->utc())
            ->select(['id', 'customer_id', 'reminder_sent_at'])
            ->chunkById(500, function (Collection $carts) use (&$sent, &$ordered) {
                $sent += $carts->count();
                $ordered += count($this->orders->orderedWithin($carts->mapWithKeys(fn (Cart $c) => [$c->id => [
                    'customer_id' => (string) $c->customer_id,
                    'from' => $c->reminder_sent_at,
                    'to' => $c->reminder_sent_at?->addDays(self::ORDERED_WITHIN_DAYS),
                ]])->all()));
            });

        return ['sent_30d' => $sent, 'ordered_30d' => $ordered];
    }

    /**
     * @param  array{name: string, phone: ?string, email: ?string}  $customer
     * @param  array{organization_id: string, shop: string, link: string, locale: string, sms: bool}  $context
     */
    private function remind(Cart $cart, array $customer, array $context): bool
    {
        $email = trim((string) $customer['email']);
        $phone = $email === '' && $context['sms'] ? BangladeshMobile::normalize($customer['phone']) : null;
        if (($email === '' && $phone === null) || ! $this->claim($cart)) {
            return false;
        }

        if ($email !== '') {
            $view = $this->pricer->price($cart);
            $items = array_map(fn (array $line) => [
                'name' => $line['product']['name'].($line['variant_name'] ? " ({$line['variant_name']})" : ''),
                'quantity' => (string) $line['quantity'],
                'price' => (string) $line['unit_price'],
            ], $view['items']);
            Notification::route('mail', $email)->notify(new CartReminderEmail($context['shop'], $customer['name'], $items, (string) $view['currency'], $context['link']));

            return true;
        }

        $text = $this->sms->renderTemplate($context['organization_id'], SmsSender::CART_REMINDER, $context['locale'], ['name' => $customer['name'], 'link' => $context['link']]);

        return $this->sms->queue($context['organization_id'], (string) $phone, SmsSender::CART_REMINDER, $text, "cart_reminder:{$cart->id}", 'cart', $cart->id) !== null;
    }

    /** Sets `reminder_sent_at` unless another run did (the cart's `updated_at` stays its last change). */
    private function claim(Cart $cart): bool
    {
        return Cart::query()->whereKey($cart->id)->whereNull('reminder_sent_at')->toBase()
            ->update(['reminder_sent_at' => CarbonImmutable::now()->utc()]) === 1;
    }
}
