<?php

namespace App\Modules\Orders\Tests\Feature;

use App\Modules\CustomerAccounts\Tests\Concerns\ActsAsShopper;
use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Orders\Infrastructure\Notifications\OrderShippingStatusEmail;
use App\Modules\Orders\Infrastructure\Notifications\SendOrderSms;
use App\Modules\Orders\Tests\Concerns\BuildsCheckout;
use App\Modules\Orders\Tests\Fakes\FakeSmsSender;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Shipping\Application\Contracts\CourierDirectory;
use App\Modules\Sms\Application\Contracts\SmsSender;
use App\Modules\Storefront\Application\Queries\StorefrontConfig;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Notifications\AnonymousNotifiable;
use Illuminate\Support\Facades\Exceptions;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use RuntimeException;
use Tests\TestCase;

/**
 * BD2b §2: the shopper's "on its way" and "delivered" e-mails on OrderStatusChanged — content
 * with tracking, links (track page; account order page to review), the store's settings,
 * orders without an e-mail address, other statuses, and the workflow standing when mail fails.
 */
class OrderStatusEmailsTest extends TestCase
{
    use ActsAsShopper, BuildsCheckout, BuildsOnlineCatalog, InteractsWithTenancy, RefreshDatabase;

    private string $courier;

    protected function setUp(): void
    {
        parent::setUp();
        Notification::fake();
        $this->app->instance(SmsSender::class, new FakeSmsSender);
        $this->buildShop();
        $this->actingAsUser($this->tenant['admin']);
        $this->courier = $this->postJson('/api/v1/shipping/couriers', [
            'name' => 'Pathao', 'tracking_url_template' => 'https://merchant.pathao.com/tracking?consignment_id={tracking}',
        ])->assertCreated()->json('data.id');
        $this->asVisitor();
    }

    /**
     * A guest cash-on-delivery order (confirmed at placement).
     *
     * @param  array<string, mixed>  $contact
     * @return array{id: string, number: string}
     */
    private function order(array $contact = []): array
    {
        $this->clearBrowser();
        $this->addToCart('SHIRT', 1);
        $body = $this->checkoutBody('510.00');
        $body['contact'] = $contact + $body['contact'];
        $number = $this->placeOrder(array_filter($body, fn ($v) => $v !== null))->assertCreated()->json('data.order.number');

        return ['id' => (string) Order::query()->withoutGlobalScopes()->where('number', $number)->value('id'), 'number' => $number];
    }

    /**
     * @param  array<string, mixed>  $body
     */
    private function act(string $orderId, string $action, array $body = []): TestResponse
    {
        $this->clearBrowser();
        $this->actingAsUser($this->tenant['admin']);

        return $this->postJson("/api/v1/web-orders/{$orderId}/{$action}", $body, ['Idempotency-Key' => (string) Str::uuid()]);
    }

    /**
     * @param  array<string, mixed>  $values
     */
    private function settings(array $values): void
    {
        $this->clearBrowser();
        $this->actingAsUser($this->tenant['admin']);
        $this->patchJson('/api/v1/storefront/settings', $values)->assertOk();
    }

    public function test_shipped_and_delivered_emails_with_tracking_and_links(): void
    {
        $data = $this->actingAsUser($this->tenant['admin'])->getJson('/api/v1/storefront/settings')->assertOk()->json('data');
        $this->assertTrue($data['email_shipped']);
        $this->assertTrue($data['email_delivered']);

        $order = $this->order();
        $this->act($order['id'], 'process')->assertOk();
        Notification::assertSentOnDemandTimes(OrderShippingStatusEmail::class, 0);

        $this->act($order['id'], 'ship', ['courier_id' => $this->courier, 'tracking_number' => 'TRK 1/A'])->assertOk();
        Notification::assertSentOnDemand(OrderShippingStatusEmail::class, function (OrderShippingStatusEmail $n, array $channels, AnonymousNotifiable $to) use ($order) {
            $mail = $n->toMail($to);

            return $to->routes['mail'] === 'rina@example.test' && $n->step === 'shipped'
                && $mail->subject === "Your order {$order['number']} at Berry Kids is on its way"
                && $mail->from === [config('mail.from.address'), 'Berry Kids']
                && in_array('Courier: Pathao', $mail->introLines, true)
                && in_array('Tracking number: TRK 1/A', $mail->introLines, true)
                && in_array('Track with the courier: https://merchant.pathao.com/tracking?consignment_id=TRK%201%2FA', $mail->introLines, true)
                && $mail->actionUrl === 'http://'.self::HOST.'/track-order?number='.$order['number'];
        });

        $this->act($order['id'], 'deliver')->assertOk();
        Notification::assertSentOnDemand(OrderShippingStatusEmail::class, function (OrderShippingStatusEmail $n, array $channels, AnonymousNotifiable $to) use ($order) {
            $mail = $n->toMail($to);

            // A guest order: the track page (no account page to review from).
            return $n->step === 'delivered' && ! $n->reviewable
                && $mail->subject === "Your order {$order['number']} at Berry Kids was delivered"
                && $mail->actionText === 'View your order'
                && $mail->actionUrl === 'http://'.self::HOST.'/track-order?number='.$order['number'];
        });
        Notification::assertSentOnDemandTimes(OrderShippingStatusEmail::class, 2);
    }

    public function test_a_delivered_account_order_links_its_order_page_to_review(): void
    {
        $this->registerShopper(self::HOST, 'rina@example.test');
        $this->addToCart('SHIRT', 1);
        $number = $this->placeOrder($this->checkoutBody('510.00'))->assertCreated()->json('data.order.number');
        $id = (string) Order::query()->withoutGlobalScopes()->where('number', $number)->value('id');
        $this->act($id, 'process')->assertOk();
        $this->act($id, 'ship', ['courier_id' => $this->courier])->assertOk();
        $this->act($id, 'deliver')->assertOk();

        Notification::assertSentOnDemand(OrderShippingStatusEmail::class, function (OrderShippingStatusEmail $n, array $channels, AnonymousNotifiable $to) use ($number) {
            $mail = $n->toMail($to);

            return $n->step === 'delivered' && $n->reviewable && $mail->actionText === 'Review your items'
                && $mail->actionUrl === 'http://'.self::HOST.'/account/orders/'.$number;
        });
        // Shipped without a tracking number: no tracking lines.
        Notification::assertSentOnDemand(OrderShippingStatusEmail::class, fn (OrderShippingStatusEmail $n, array $c, AnonymousNotifiable $to) => $n->step === 'shipped'
            && $n->toMail($to)->introLines === ["Your order {$number} is on its way.", 'Courier: Pathao']);
    }

    public function test_no_email_address_settings_off_and_other_statuses_send_nothing(): void
    {
        // No contact e-mail (optional at checkout).
        $noEmail = $this->order(['email' => null]);
        $this->act($noEmail['id'], 'process')->assertOk();
        $this->act($noEmail['id'], 'ship', ['courier_id' => $this->courier])->assertOk();
        $this->act($noEmail['id'], 'deliver')->assertOk();
        Notification::assertSentOnDemandTimes(OrderShippingStatusEmail::class, 0);

        // Switched off (audited with the other settings).
        $this->settings(['email_shipped' => false, 'email_delivered' => false]);
        $off = $this->order();
        $this->act($off['id'], 'process')->assertOk();
        $this->act($off['id'], 'ship', ['courier_id' => $this->courier])->assertOk();
        $this->act($off['id'], 'deliver')->assertOk();
        Notification::assertSentOnDemandTimes(OrderShippingStatusEmail::class, 0);

        // Only the delivered one on: just that one.
        $this->settings(['email_delivered' => true]);
        $one = $this->order();
        $this->act($one['id'], 'process')->assertOk();
        $this->act($one['id'], 'ship', ['courier_id' => $this->courier])->assertOk();
        Notification::assertSentOnDemandTimes(OrderShippingStatusEmail::class, 0);
        $this->act($one['id'], 'deliver')->assertOk();
        Notification::assertSentOnDemandTimes(OrderShippingStatusEmail::class, 1);

        // Processing and cancellation are not e-mailed here.
        $this->settings(['email_shipped' => true]);
        $cancelled = $this->order();
        $this->act($cancelled['id'], 'process')->assertOk();
        $this->act($cancelled['id'], 'cancel', ['reason' => 'Out of stock'])->assertOk();
        Notification::assertSentOnDemandTimes(OrderShippingStatusEmail::class, 1);

        $this->patchJson('/api/v1/storefront/settings', ['email_shipped' => 'yes'])->assertUnprocessable();
    }

    public function test_the_workflow_stands_when_the_email_fails(): void
    {
        $order = $this->order();
        $this->act($order['id'], 'process')->assertOk();
        Exceptions::fake([RuntimeException::class]);
        // Building the shipped e-mail fails (the courier's tracking link lookup throws).
        $this->app->bind(SendOrderSms::class, fn ($app) => new class($app->make(TenantContext::class), $app->make(SmsSender::class), $app->make(StorefrontConfig::class), $app->make(CourierDirectory::class)) extends SendOrderSms
        {
            public function trackingLink(Order $order): ?string
            {
                throw new RuntimeException('tracking down');
            }
        });

        $this->act($order['id'], 'ship', ['courier_id' => $this->courier])->assertOk()->assertJsonPath('data.status', 'shipped');
        $this->act($order['id'], 'deliver')->assertOk()->assertJsonPath('data.status', 'delivered');
        Exceptions::assertReported(fn (RuntimeException $e) => $e->getMessage() === 'tracking down');
        Notification::assertSentOnDemand(OrderShippingStatusEmail::class, fn (OrderShippingStatusEmail $n) => $n->step === 'delivered');
        Notification::assertSentOnDemandTimes(OrderShippingStatusEmail::class, 1);
    }
}
