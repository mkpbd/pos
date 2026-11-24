<?php

namespace App\Modules\Orders\Tests\Feature;

use App\Modules\CustomerAccounts\Tests\Concerns\ActsAsShopper;
use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Orders\Application\Events\OrderStatusChanged;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Orders\Infrastructure\Notifications\SendOrderSms;
use App\Modules\Orders\Tests\Concerns\BuildsCheckout;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * BD1a §5 end to end with the real Sms module (log driver, jobs not run): the order messages
 * land in the SMS log once per order + event, rendered in the order's language; nothing while
 * SMS is not set up or the template is switched off.
 */
class OrderSmsDeliveryTest extends TestCase
{
    use ActsAsShopper, BuildsCheckout, BuildsOnlineCatalog, InteractsWithTenancy, RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Notification::fake();
        Queue::fake();
        $this->buildShop();
    }

    /**
     * @param  array<string, mixed>  $settings
     */
    private function smsSettings(array $settings): void
    {
        $this->actingAsUser($this->tenant['admin']);
        $this->patchJson('/api/v1/sms/settings', $settings)->assertOk();
        $this->asVisitor();
    }

    private function place(string $lang = 'en'): string
    {
        $this->clearBrowser();
        $this->addToCart('SHIRT', 1);

        return $this->browse('POST', $this->storeUrl('checkout?lang='.$lang), $this->checkoutBody('510.00'), ['Idempotency-Key' => (string) Str::uuid()])
            ->assertCreated()->json('data.order.number');
    }

    /**
     * @return list<object>
     */
    private function messages(): array
    {
        return DB::table('sms_messages')->orderBy('created_at')->orderBy('id')->get()->all();
    }

    public function test_order_messages_are_logged_once_in_the_orders_language(): void
    {
        // SMS not set up: nothing.
        $this->place();
        $this->assertSame([], $this->messages());

        $this->smsSettings(['is_enabled' => true, 'driver' => 'log']);
        $number = $this->place('bn');
        [$placed] = $this->messages();
        $this->assertSame(['01712345678', 'order_placed', 'queued', 'order'], [$placed->to_phone, $placed->purpose, $placed->status, $placed->related_type]);
        $this->assertStringContainsString($number, $placed->body);
        $this->assertStringContainsString('গৃহীত', $placed->body);
        $this->assertStringContainsString('510.00', $placed->body);
        $this->assertStringContainsString('/order/'.$number.'?token=', $placed->body);

        // Cancelled twice over (a replayed or racing event) → one message.
        $id = (string) Order::query()->withoutGlobalScopes()->where('number', $number)->value('id');
        $this->actingAsUser($this->tenant['admin']);
        $this->postJson("/api/v1/web-orders/{$id}/cancel", ['reason' => 'Out of stock'], ['Idempotency-Key' => (string) Str::uuid()])->assertOk();
        $this->asVisitor();
        $listener = app(SendOrderSms::class);
        $listener->statusChanged(new OrderStatusChanged($this->tenant['organization']->id, $id, 'confirmed', 'cancelled', 'staff'));
        $cancelled = array_values(array_filter($this->messages(), fn ($m) => $m->purpose === 'order_cancelled'));
        $this->assertCount(1, $cancelled);
        $this->assertStringContainsString('/track-order?number='.$number, $cancelled[0]->body);

        // A switched-off template sends nothing.
        $this->smsSettings(['templates' => ['order_placed' => ['enabled' => false]]]);
        $this->place();
        $this->assertCount(2, $this->messages());
    }
}
