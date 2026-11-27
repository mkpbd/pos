<?php

namespace App\Modules\Cart\Tests\Feature;

use App\Modules\Audit\Infrastructure\Models\AuditLog;
use App\Modules\Cart\Infrastructure\Models\Cart;
use App\Modules\Cart\Infrastructure\Models\CartItem;
use App\Modules\Cart\Infrastructure\Notifications\CartReminderEmail;
use App\Modules\CustomerAccounts\Tests\Concerns\ActsAsShopper;
use App\Modules\Customers\Infrastructure\Models\Customer;
use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Orders\Tests\Concerns\BuildsCheckout;
use App\Modules\Orders\Tests\Concerns\BuildsCustomerOrders;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Sms\Domain\SmsTemplate;
use App\Modules\Sms\Infrastructure\Models\SmsMessage;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Notifications\AnonymousNotifiable;
use Illuminate\Support\Facades\Notification;
use Tests\TestCase;

/**
 * BD2b §1: abandoned-cart reminders to signed-in shoppers (`cart:reminders`) — the settings,
 * which carts are due (hours, 7 days, items, orders since, customer state, sent once), e-mail
 * vs the `cart_reminder` SMS, settings off, the 30-day summary and tenant isolation.
 */
class CartRemindersTest extends TestCase
{
    use ActsAsShopper, BuildsCheckout, BuildsCustomerOrders, BuildsOnlineCatalog, InteractsWithTenancy, RefreshDatabase;

    private const SUMMARY = '/api/v1/storefront/cart-reminders/summary';

    protected function setUp(): void
    {
        parent::setUp();
        Notification::fake();
        config(['logging.channels.sms' => config('logging.channels.null')]);
        $this->buildShop();
        $this->settings(['cart_reminders' => true]);
        $this->clearBrowser();
        $this->registerShopper(self::HOST);
        $this->addToCart('SHIRT', 2);
    }

    /**
     * @param  array<string, mixed>  $values
     */
    private function settings(array $values): void
    {
        $this->asAdmin()->patchJson('/api/v1/storefront/settings', $values)->assertOk();
    }

    private function asAdmin(): static
    {
        $this->app['auth']->forgetGuards();

        return $this->actingAsUser($this->tenant['admin']);
    }

    private function cart(): Cart
    {
        return Cart::query()->withoutGlobalScopes()->where('organization_id', $this->tenant['organization']->id)
            ->whereNotNull('customer_id')->whereNull('converted_order_id')->firstOrFail();
    }

    private function customer(): Customer
    {
        return Customer::query()->withoutGlobalScopes()->withTrashed()->findOrFail($this->cart()->customer_id);
    }

    /** Last changed this many hours ago (without touching anything else). */
    private function age(float $hours, ?Cart $cart = null): void
    {
        Cart::query()->withoutGlobalScopes()->whereKey(($cart ?? $this->cart())->id)->toBase()
            ->update(['updated_at' => now()->subMinutes((int) round($hours * 60))->utc()]);
    }

    private function sendReminders(): void
    {
        $this->artisan('cart:reminders')->assertSuccessful();
    }

    private function assertMails(int $times): void
    {
        Notification::assertSentOnDemandTimes(CartReminderEmail::class, $times);
    }

    /** @return list<SmsMessage> */
    private function texts(): array
    {
        return SmsMessage::query()->withoutGlobalScopes()->where('purpose', 'cart_reminder')->orderBy('created_at')->get()->all();
    }

    public function test_settings_defaults_validation_and_audit(): void
    {
        $this->settings(['cart_reminders' => false]);
        $data = $this->asAdmin()->getJson('/api/v1/storefront/settings')->assertOk()->json('data');
        $this->assertSame([false, 3], [$data['cart_reminders'], $data['cart_reminder_after_hours']]);

        $this->patchJson('/api/v1/storefront/settings', ['cart_reminder_after_hours' => 0])->assertUnprocessable();
        $this->patchJson('/api/v1/storefront/settings', ['cart_reminder_after_hours' => 73])->assertUnprocessable();
        $this->patchJson('/api/v1/storefront/settings', ['cart_reminders' => true, 'cart_reminder_after_hours' => 72])->assertOk()
            ->assertJsonPath('data.cart_reminders', true)->assertJsonPath('data.cart_reminder_after_hours', 72);

        $this->assertTrue(AuditLog::query()->withoutGlobalScopes()->where('action', 'storefront.settings_updated')->get()
            ->contains(fn (AuditLog $log) => ($log->new_values['cart_reminders'] ?? null) === true && ($log->new_values['cart_reminder_after_hours'] ?? null) === 72));

        // The SMS template is listed, on by default, in English and Bangla.
        $sms = $this->getJson('/api/v1/sms/settings')->assertOk()->json('data');
        $this->assertSame(SmsTemplate::defaults()['cart_reminder'], $sms['templates']['cart_reminder']);
        $this->assertTrue($sms['templates']['cart_reminder']['enabled']);
        $this->assertStringContainsString('{link}', $sms['default_templates']['cart_reminder']['bn']);

        // Scheduled hourly.
        $event = collect(app(Schedule::class)->events())->first(fn ($e) => str_contains((string) $e->command, 'cart:reminders'));
        $this->assertSame('0 * * * *', $event?->expression);
    }

    public function test_an_email_reminder_after_the_hours_and_only_once(): void
    {
        $before = $this->cart();
        $this->age(2.5);
        $this->sendReminders();
        $this->assertMails(0);

        $this->age(3.5);
        $this->sendReminders();
        Notification::assertSentOnDemand(CartReminderEmail::class, function (CartReminderEmail $n, array $channels, AnonymousNotifiable $to) {
            $mail = $n->toMail($to);

            return $to->routes['mail'] === 'shopper@example.test'
                && $mail->subject === 'You left something in your cart at Berry Kids'
                && $mail->from === [config('mail.from.address'), 'Berry Kids']
                && $mail->greeting === 'Hello Rina Akter,'
                && in_array('2 × Shirt — 450.00 BDT', $mail->introLines, true)
                && $mail->actionUrl === 'http://'.self::HOST.'/cart';
        });
        $cart = $this->cart();
        $this->assertNotNull($cart->reminder_sent_at);
        // The claim does not count as a change of the cart.
        $this->assertTrue($cart->updated_at->lessThan(now()->subHours(3)));
        $this->assertSame($before->id, $cart->id);

        $this->sendReminders();
        $this->age(5);
        $this->sendReminders();
        $this->assertMails(1);
    }

    public function test_old_empty_and_guest_carts_and_inactive_customers_get_none(): void
    {
        // Older than 7 days.
        $this->age(24 * 7 + 1);
        $this->sendReminders();
        $this->assertMails(0);

        // No items.
        CartItem::query()->where('cart_id', $this->cart()->id)->delete();
        $this->age(4);
        $this->sendReminders();
        $this->assertMails(0);

        // A guest cart has no one to remind.
        $this->clearBrowser();
        $this->addToCart('JUICE', 1);
        Cart::query()->withoutGlobalScopes()->whereNull('customer_id')->toBase()->update(['updated_at' => now()->subHours(4)->utc()]);
        $this->sendReminders();
        $this->assertMails(0);

        // Inactive, then archived customer (the customer's cart has items again).
        CartItem::query()->create(['cart_id' => $this->cart()->id, 'variant_id' => $this->v['RICE'], 'quantity' => '1']);
        $this->age(4);
        $this->customer()->forceFill(['is_active' => false])->save();
        $this->sendReminders();
        $this->customer()->forceFill(['is_active' => true])->save();
        $this->customer()->delete();
        $this->sendReminders();
        $this->assertMails(0);
        $this->assertNull($this->cart()->reminder_sent_at);

        $this->customer()->restore();
        $this->sendReminders();
        $this->assertMails(1);
    }

    public function test_no_reminder_when_the_customer_ordered_since_the_cart_changed(): void
    {
        $this->customerOrder(['SHIRT' => 1]);
        $this->addToCart('JUICE', 1);
        // The new cart was last changed before the order was placed.
        $this->age(5);
        $this->sendReminders();
        $this->assertMails(0);

        // An order before the cart's last change does not count.
        Order::query()->withoutGlobalScopes()->toBase()->update(['placed_at' => now()->subHours(6)->utc()]);
        $this->sendReminders();
        $this->assertMails(1);
    }

    public function test_sms_without_an_email_address_when_sms_is_ready(): void
    {
        $this->customer()->forceFill(['email' => null, 'phone' => '+880 1712-345678'])->save();
        $this->age(4);

        // SMS not set up: nothing, and the cart stays unclaimed.
        $this->sendReminders();
        $this->assertSame([], $this->texts());
        $this->assertNull($this->cart()->reminder_sent_at);

        // The text switched off.
        $this->asAdmin()->patchJson('/api/v1/sms/settings', ['is_enabled' => true, 'driver' => 'log', 'templates' => ['cart_reminder' => ['enabled' => false]]])->assertOk();
        $this->sendReminders();
        $this->assertSame([], $this->texts());

        $this->patchJson('/api/v1/sms/settings', ['templates' => ['cart_reminder' => ['enabled' => true]]])->assertOk();
        $this->sendReminders();
        $this->sendReminders();
        [$text] = $this->texts();
        $this->assertCount(1, $this->texts());
        $this->assertSame(['01712345678', 'cart', $this->cart()->id], [$text->to_phone, $text->related_type, $text->related_id]);
        $this->assertSame('Berry Kids: Hi Rina Akter, you left something in your cart. Complete your order: http://'.self::HOST.'/cart', $text->body);
        $this->assertMails(0);

        // In Bangla when it is the store's language.
        $this->assertStringContainsString('আপনার কার্টে', SmsTemplate::render(SmsTemplate::defaults()['cart_reminder']['bn'], ['shop' => 'B', 'name' => 'R', 'link' => 'x']));
    }

    public function test_settings_off_or_store_closed_send_nothing(): void
    {
        $this->age(4);
        $this->settings(['cart_reminders' => false]);
        $this->sendReminders();
        $this->settings(['cart_reminders' => true, 'is_enabled' => false]);
        $this->sendReminders();
        $this->assertMails(0);
        $this->assertNull($this->cart()->reminder_sent_at);

        $this->settings(['is_enabled' => true, 'cart_reminder_after_hours' => 5]);
        $this->sendReminders();
        $this->assertMails(0);
    }

    public function test_the_summary_counts_reminders_and_orders_within_seven_days(): void
    {
        $this->asAdmin()->getJson(self::SUMMARY)->assertOk()->assertJsonPath('data', ['sent_30d' => 0, 'ordered_30d' => 0]);

        $this->age(4);
        $this->sendReminders();
        $this->getJson(self::SUMMARY)->assertOk()->assertJsonPath('data', ['sent_30d' => 1, 'ordered_30d' => 0]);

        // The shopper checks out the reminded cart (the cart row stays, converted).
        $total = $this->previewCheckout(['address' => ['district_id' => self::DHAKA], 'shipping_method_id' => $this->methods['inside'], 'payment_method' => 'cod'])->json('data.total');
        $this->placeOrder($this->checkoutBody($total))->assertCreated();
        $this->asAdmin()->getJson(self::SUMMARY)->assertOk()->assertJsonPath('data', ['sent_30d' => 1, 'ordered_30d' => 1]);

        // An order more than 7 days after the reminder does not count.
        Cart::query()->withoutGlobalScopes()->whereNotNull('reminder_sent_at')->toBase()->update(['reminder_sent_at' => now()->subDays(10)->utc()]);
        $this->getJson(self::SUMMARY)->assertOk()->assertJsonPath('data', ['sent_30d' => 1, 'ordered_30d' => 0]);

        $this->travel(21)->days();
        $this->getJson(self::SUMMARY)->assertOk()->assertJsonPath('data', ['sent_30d' => 0, 'ordered_30d' => 0]);

        // Needs the online store settings permission.
        $this->actingAsUser($this->createUserWithRole($this->tenant['organization'], SystemRole::Cashier));
        $this->getJson(self::SUMMARY)->assertForbidden();
    }

    public function test_other_organizations_are_isolated(): void
    {
        $shop = $this->tenant;
        $other = $this->provisionTenant('Other Retail');
        $foreign = $this->inTenant($other['organization'], function () use ($other) {
            $customer = Customer::query()->create(['code' => 'CUS-K1', 'name' => 'Karim', 'email' => 'karim@example.test']);
            $reminded = Cart::query()->create(['organization_id' => $other['organization']->id, 'customer_id' => $customer->id]);
            $reminded->forceFill(['reminder_sent_at' => now()->subDay()])->save();

            return $reminded;
        });

        // The other organization's reminder is not in this one's summary.
        $this->age(4);
        $this->sendReminders();
        $this->tenant = $shop;
        $this->asAdmin()->getJson(self::SUMMARY)->assertOk()->assertJsonPath('data', ['sent_30d' => 1, 'ordered_30d' => 0]);
        $this->actingAsUser($other['admin'])->getJson(self::SUMMARY)->assertOk()->assertJsonPath('data', ['sent_30d' => 1, 'ordered_30d' => 0]);

        // Its own due cart waits for its own settings (off by default).
        $this->inTenant($other['organization'], function () use ($other, $foreign) {
            $customer = Customer::query()->create(['code' => 'CUS-S1', 'name' => 'Selim', 'email' => 'selim@example.test']);
            $cart = Cart::query()->create(['organization_id' => $other['organization']->id, 'customer_id' => $customer->id]);
            CartItem::query()->create(['cart_id' => $cart->id, 'variant_id' => $this->v['RICE'], 'quantity' => '1']);
            $this->age(4, $cart);
            $this->assertNotSame($foreign->id, $cart->id);
        });
        $this->sendReminders();
        $this->assertMails(1);
        $this->assertSame(1, Cart::query()->withoutGlobalScopes()->where('organization_id', $other['organization']->id)->whereNotNull('reminder_sent_at')->count());
    }
}
