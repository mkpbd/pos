<?php

namespace App\Modules\Orders\Tests\Feature;

use App\Modules\Audit\Infrastructure\Models\AuditLog;
use App\Modules\CustomerAccounts\Infrastructure\Models\CustomerAccount;
use App\Modules\CustomerAccounts\Tests\Concerns\ActsAsShopper;
use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Orders\Infrastructure\Notifications\OrderConfirmation;
use App\Modules\Orders\Tests\Concerns\BuildsCheckout;
use App\Modules\Promotions\Infrastructure\Models\PromotionRedemption;
use App\Modules\Promotions\Tests\Concerns\BuildsPromotions;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * BD1b §1: orders staff enter (taken by phone, Facebook, WhatsApp…). Shop from BuildsCheckout:
 * Shirt 450 (5 in stock), Juice 120 + VAT 15%, Pills 100 (batches EARLY 2, LATE 5), delivery
 * inside Dhaka 60 (free from 2000, no COD fee).
 */
class StaffOrdersTest extends TestCase
{
    use ActsAsShopper, BuildsCheckout, BuildsOnlineCatalog, BuildsPromotions, InteractsWithTenancy, RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Notification::fake();
        $this->buildShop();
        $this->staff();
    }

    private function staff(): void
    {
        $this->clearBrowser();
        $this->actingAsUser($this->tenant['admin']);
    }

    /**
     * @param  array<string, string|int>  $items  sku => quantity
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    private function body(array $items, string $expectedTotal, array $overrides = []): array
    {
        return $overrides + [
            'contact' => ['name' => 'Karim Uddin', 'phone' => '+880 1812-345678', 'email' => 'karim@example.test'],
            'lines' => array_map(fn (string $sku, $q) => ['variant_id' => $this->v[$sku], 'quantity' => (string) $q], array_keys($items), array_values($items)),
            'address' => ['recipient_name' => 'Karim Uddin', 'phone' => '01812345678', 'division_id' => self::DHAKA_DIVISION, 'district_id' => self::DHAKA, 'area' => 'Mirpur', 'address_line' => 'House 9, Road 4', 'postcode' => '1216'],
            'shipping_method_id' => $this->methods['inside'],
            'payment_method' => 'cod',
            'channel' => 'phone',
            'notes' => 'Call before delivery',
            'expected_total' => $expectedTotal,
        ];
    }

    /**
     * @param  array<string, mixed>  $body
     */
    private function enter(array $body, ?string $key = null): TestResponse
    {
        return $this->postJson('/api/v1/web-orders', $body, ['Idempotency-Key' => $key ?? (string) Str::uuid()]);
    }

    public function test_the_quote_prices_lines_like_checkout_and_writes_nothing(): void
    {
        $quote = $this->postJson('/api/v1/web-orders/quote', [
            'lines' => [['variant_id' => $this->v['SHIRT'], 'quantity' => '2'], ['variant_id' => $this->v['JUICE'], 'quantity' => '1']],
            'address' => ['district_id' => self::DHAKA],
            'payment_method' => 'cod',
        ])->assertOk()->json('data');

        // 900 + 120 + 18 VAT + 60 delivery (the only method is picked).
        $this->assertSame(['1020.00', '18.00', '60.00', '1098.00', $this->methods['inside'], 'cod'], [$quote['subtotal'], $quote['tax_total'], $quote['shipping_total'], $quote['total'], $quote['shipping_method_id'], $quote['payment_method']]);
        $this->assertSame(['Shirt', '5.000', $this->v['SHIRT'], '2', '450.00'], [$quote['lines'][0]['product_name'], $quote['lines'][0]['available'], $quote['lines'][0]['variant_id'], $quote['lines'][0]['quantity'], $quote['lines'][0]['unit_price']]);
        $this->assertArrayHasKey('image_url', $quote['lines'][0]);
        $this->assertEqualsCanonicalizing(['cod', 'bank_transfer'], array_column($quote['payment_methods'], 'code'));
        $this->assertSame([], $quote['issues']);

        // Short stock is an issue, not an error.
        $this->postJson('/api/v1/web-orders/quote', ['lines' => [['variant_id' => $this->v['SHIRT'], 'quantity' => '9']]])->assertOk()->assertJsonPath('data.issues', ['exceeds_stock']);
        $this->postJson('/api/v1/web-orders/quote', ['lines' => []])->assertUnprocessable()->assertJsonStructure(['error' => ['details' => ['lines']]]);
        $this->postJson('/api/v1/web-orders/quote', ['customer_id' => (string) Str::uuid(), 'lines' => [['variant_id' => $this->v['SHIRT'], 'quantity' => '1']]])
            ->assertUnprocessable()->assertJsonStructure(['error' => ['details' => ['customer_id']]]);

        $this->assertSame(0, Order::query()->withoutGlobalScopes()->count());
        $this->assertSame('5.000', $this->level('SHIRT'));
    }

    public function test_staff_enter_a_cash_on_delivery_order_that_starts_confirmed(): void
    {
        // The shop's guest-checkout setting does not apply to staff.
        DB::table('storefront_settings')->where('organization_id', $this->tenant['organization']->id)->update(['guest_checkout_enabled' => false]);

        $order = $this->enter($this->body(['SHIRT' => 2, 'PILLS' => 3], '1260.00'))->assertCreated()->json('data');

        $this->assertSame(['WEB-000001', 'confirmed', 'staff', 'phone', 1, '1260.00'], [$order['number'], $order['status'], $order['source'], $order['channel'], $order['revision'], $order['total']]);
        $this->assertSame($this->tenant['admin']->id, $order['created_by']['id']);
        $this->assertSame(['Karim Uddin', '01812345678', 'karim@example.test'], [$order['contact_name'], $order['contact_phone'], $order['contact_email']]);
        $this->assertSame([self::DHAKA_DIVISION, self::DHAKA, 'Mirpur'], [$order['shipping_address']['division_id'], $order['shipping_address']['district_id'], $order['shipping_address']['area']]);
        $this->assertSame([$this->v['SHIRT'], '2'], [$order['lines'][0]['variant_id'], $order['lines'][0]['quantity']]);
        $this->assertSame([$this->methods['inside'], null, 'Call before delivery', []], [$order['shipping_method_id'], $order['customer_id'], $order['notes'], $order['edits']]);
        $this->assertSame(['confirmed', 'Order entered by staff (Phone)', 'staff', $this->tenant['admin']->id], [
            $order['history'][0]['status'], $order['history'][0]['note'], $order['history'][0]['actor_type'], $order['history'][0]['actor']['id'],
        ]);
        $this->assertContains('edit', $order['allowed_actions']);

        $row = Order::query()->withoutGlobalScopes()->findOrFail($order['id']);
        $this->assertNull($row->access_token_hash);
        $this->assertSame('en', $row->locale);
        $this->assertNotNull($row->confirmed_at);
        // Stock left FEFO: the earlier pill batch first.
        $this->assertSame('3.000', $this->level('SHIRT'));
        $this->assertSame(['EARLY' => '0.000', 'LATE' => '4.000'], $this->pillLevels());

        $audit = AuditLog::query()->withoutGlobalScopes()->where('action', 'web_order.created')->sole();
        $this->assertSame(['staff', 'phone', '1260.00'], [$audit->new_values['source'], $audit->new_values['channel'], $audit->new_values['total']]);
        Notification::assertSentOnDemand(OrderConfirmation::class);

        // The board filters staff orders and shows the channel.
        $list = $this->getJson('/api/v1/web-orders?source=staff')->assertOk();
        $this->assertSame([1, 'staff', 'phone'], [$list->json('meta.pagination.total'), $list->json('data.0.source'), $list->json('data.0.channel')]);
        $this->getJson('/api/v1/web-orders?source=storefront')->assertJsonPath('meta.pagination.total', 0);
    }

    public function test_bank_transfer_orders_await_payment_and_the_language_can_be_chosen(): void
    {
        $order = $this->enter($this->body(['JUICE' => 1], '198.00', ['payment_method' => 'bank_transfer', 'channel' => 'whatsapp', 'locale' => 'bn']))->assertCreated()->json('data');

        $this->assertSame(['pending_payment', 'whatsapp', 'Order entered by staff (WhatsApp)'], [$order['status'], $order['channel'], $order['history'][0]['note']]);
        $this->assertSame('bn', Order::query()->withoutGlobalScopes()->findOrFail($order['id'])->locale);
        $this->assertContains('confirm_payment', $order['allowed_actions']);
    }

    public function test_an_order_for_an_existing_customer_shows_in_their_account(): void
    {
        $this->registerShopper(self::HOST, 'karim@example.test');
        $account = CustomerAccount::query()->withoutGlobalScopes()->where('email', 'karim@example.test')->sole();
        $this->staff();

        $order = $this->enter($this->body(['SHIRT' => 1], '510.00', ['customer_id' => $account->customer_id, 'channel' => 'facebook']))->assertCreated()->json('data');

        $this->assertSame([$account->customer_id, $account->customer_id], [$order['customer_id'], $order['customer']['id']]);
        $this->assertSame($account->id, $order['customer_account_id']);
        $this->enter($this->body(['SHIRT' => 1], '510.00', ['customer_id' => (string) Str::uuid()]))->assertUnprocessable()->assertJsonStructure(['error' => ['details' => ['customer_id']]]);
    }

    public function test_checkout_errors_apply_to_staff_orders(): void
    {
        $changed = $this->enter($this->body(['SHIRT' => 1], '500.00'))->assertStatus(409)->assertJsonPath('error.code', 'TOTAL_CHANGED');
        $this->assertSame('510.00', $changed->json('error.details.preview.total'));
        $this->assertSame(['5.000', 'Shirt'], [$changed->json('error.details.preview.lines.0.available'), $changed->json('error.details.preview.lines.0.product_name')]);
        $this->assertNotEmpty($changed->json('error.details.preview.payment_methods'));
        $this->enter($this->body(['SHIRT' => 6], '2700.00'))->assertUnprocessable()->assertJsonPath('error.code', 'ITEMS_UNAVAILABLE');
        $this->enter($this->body(['SHIRT' => 1], '630.00', ['shipping_method_id' => $this->methods['outside']]))->assertUnprocessable()->assertJsonPath('error.code', 'SHIPPING_UNAVAILABLE');
        $this->enter($this->body(['SHIRT' => '1.5'], '735.00'))->assertUnprocessable()->assertJsonStructure(['error' => ['details' => ['lines.0.quantity']]]);
        $this->enter($this->body(['SHIRT' => 1], '510.00', ['channel' => 'telegram']))->assertUnprocessable()->assertJsonStructure(['error' => ['details' => ['channel']]]);
        $this->enter($this->body(['SHIRT' => 1], '510.00', ['contact' => ['name' => 'X', 'phone' => '12345']]))->assertUnprocessable()->assertJsonStructure(['error' => ['details' => ['contact.phone']]]);
        $this->assertSame(0, Order::query()->withoutGlobalScopes()->count());
        $this->assertSame('5.000', $this->level('SHIRT'));

        DB::table('storefront_settings')->where('organization_id', $this->tenant['organization']->id)->update(['fulfilment_store_id' => null]);
        $this->enter($this->body(['SHIRT' => 1], '510.00'))->assertUnprocessable()->assertJsonPath('error.code', 'CHECKOUT_UNAVAILABLE');
    }

    public function test_a_coupon_is_redeemed_on_a_staff_order(): void
    {
        $this->makePromotion($this->tenant['organization'], ['name' => 'Fifty', 'type' => 'fixed', 'value' => '50', 'trigger' => 'coupon', 'coupon_code' => 'FIFTY']);

        $quote = $this->postJson('/api/v1/web-orders/quote', ['lines' => [['variant_id' => $this->v['SHIRT'], 'quantity' => '1']], 'coupon_code' => 'fifty', 'address' => ['district_id' => self::DHAKA]])->assertOk()->json('data');
        $this->assertSame(['460.00', 'FIFTY'], [$quote['total'], $quote['coupon_code']]);

        $order = $this->enter($this->body(['SHIRT' => 1], '460.00', ['coupon_code' => 'FIFTY']))->assertCreated()->json('data');
        $this->assertSame(['FIFTY', '50.00'], [$order['coupon_code'], $order['discount_total']]);
        $this->assertSame(1, PromotionRedemption::query()->withoutGlobalScopes()->where('order_id', $order['id'])->count());
    }

    public function test_entering_is_idempotent_and_needs_the_permission(): void
    {
        $key = (string) Str::uuid();
        $first = $this->enter($this->body(['SHIRT' => 1], '510.00'), $key)->assertCreated();
        $this->enter($this->body(['SHIRT' => 1], '510.00'), $key)->assertCreated()->assertHeader('Idempotent-Replayed', 'true')->assertJsonPath('data.id', $first->json('data.id'));
        $this->assertSame(1, Order::query()->withoutGlobalScopes()->count());
        $this->postJson('/api/v1/web-orders', $this->body(['SHIRT' => 1], '510.00'))->assertStatus(428);

        $accountant = $this->createUserWithRole($this->tenant['organization'], SystemRole::Accountant);
        $this->actingAsUser($accountant);
        $this->getJson('/api/v1/web-orders/'.$first->json('data.id'))->assertOk()->assertJsonPath('data.allowed_actions', []);
        $this->enter($this->body(['SHIRT' => 1], '510.00'))->assertForbidden();
        $this->postJson('/api/v1/web-orders/quote', ['lines' => [['variant_id' => $this->v['SHIRT'], 'quantity' => '1']]])->assertForbidden();

        $manager = $this->createUserWithRole($this->tenant['organization'], SystemRole::OnlineStoreManager);
        $this->actingAsUser($manager);
        $this->postJson('/api/v1/web-orders/quote', ['lines' => [['variant_id' => $this->v['SHIRT'], 'quantity' => '1']]])->assertOk();
        $this->enter($this->body(['SHIRT' => 1], '510.00'))->assertCreated()->assertJsonPath('data.created_by.id', $manager->id);
    }

    public function test_unknown_variants_cannot_be_ordered(): void
    {
        $unknown = (string) Str::uuid();
        $this->postJson('/api/v1/web-orders/quote', ['lines' => [['variant_id' => $unknown, 'quantity' => '1']]])->assertOk()->assertJsonPath('data.issues', ['unavailable']);
        $this->enter(['lines' => [['variant_id' => $unknown, 'quantity' => '1']]] + $this->body(['SHIRT' => 1], '60.00'))->assertUnprocessable()->assertJsonPath('error.code', 'ITEMS_UNAVAILABLE');
    }

    private function level(string $sku): string
    {
        return (string) DB::table('stock_levels')->where('variant_id', $this->v[$sku])->where('store_id', $this->tenant['store']->id)->value('quantity');
    }

    /**
     * @return array<string, string>
     */
    private function pillLevels(): array
    {
        return DB::table('stock_levels')->leftJoin('batches', 'batches.id', '=', 'stock_levels.batch_id')
            ->where('stock_levels.variant_id', $this->v['PILLS'])->orderBy('batches.batch_number')
            ->pluck('stock_levels.quantity', 'batches.batch_number')->map(fn ($q) => (string) $q)->all();
    }
}
