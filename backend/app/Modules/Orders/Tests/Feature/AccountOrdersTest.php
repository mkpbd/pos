<?php

namespace App\Modules\Orders\Tests\Feature;

use App\Modules\CustomerAccounts\Tests\Concerns\ActsAsShopper;
use App\Modules\Inventory\Application\Actions\PostStockAdjustment;
use App\Modules\Inventory\Infrastructure\Models\StockLevel;
use App\Modules\Inventory\Infrastructure\Models\StockMovement;
use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Orders\Application\Actions\OrderWorkflow;
use App\Modules\Orders\Infrastructure\Notifications\OrderCancellationConfirmation;
use App\Modules\Orders\Infrastructure\Notifications\OrderCancelledNotification;
use App\Modules\Orders\Tests\Concerns\BuildsCheckout;
use App\Modules\Orders\Tests\Concerns\BuildsCustomerOrders;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Notifications\AnonymousNotifiable;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * E9: the signed-in customer's order history, order page, cancel and re-order.
 */
class AccountOrdersTest extends TestCase
{
    use ActsAsShopper, BuildsCheckout, BuildsCustomerOrders, BuildsOnlineCatalog, InteractsWithTenancy, RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Notification::fake();
        $this->buildShop();
    }

    private function cancel(string $number, array $body = [], ?string $key = null, string $host = self::HOST): TestResponse
    {
        return $this->browse('POST', $this->storeUrl("account/orders/{$number}/cancel", $host), $body, ['Idempotency-Key' => $key ?? (string) Str::uuid()]);
    }

    private function stockOf(string $sku): string
    {
        $levels = StockLevel::query()->withoutGlobalScopes()->where('variant_id', $this->v[$sku])->pluck('quantity')->all();

        return number_format(array_sum(array_map('floatval', $levels)), 3, '.', '');
    }

    public function test_order_history_lists_own_orders_newest_first_with_status_groups_and_pages(): void
    {
        $this->registerShopper(self::HOST);
        $first = $this->customerOrder(['SHIRT' => 2, 'JUICE' => 1]);
        $this->travel(1)->minutes();
        $second = $this->customerOrder(['RICE' => '1']);
        $this->travel(1)->minutes();
        $third = $this->customerOrder(['JUICE' => 1]);
        $this->advance($first, 'delivered');
        $this->cancel($third)->assertOk();

        $list = $this->browse('GET', $this->storeUrl('account/orders'))->assertOk()->assertHeader('Cache-Control', 'no-store, private');
        $this->assertSame([$third, $second, $first], array_column($list->json('data'), 'number'));
        $row = $list->json('data.2');
        $this->assertSame([
            'number', 'placed_at', 'status', 'status_label', 'payment_status', 'payment_method_label', 'item_count', 'total', 'currency', 'first_item',
        ], array_keys($row));
        $this->assertSame(['delivered', 'Delivered', 'unpaid', 'Cash on delivery', '3', 'BDT'], [
            $row['status'], $row['status_label'], $row['payment_status'], $row['payment_method_label'], $row['item_count'], $row['currency'],
        ]);
        $this->assertSame('Shirt', $row['first_item']['name']);
        $this->assertSame(['current_page' => 1, 'per_page' => 10, 'total' => 3, 'last_page' => 1], $list->json('meta.pagination'));

        $this->assertSame([$second], array_column($this->browse('GET', $this->storeUrl('account/orders?status=open'))->json('data'), 'number'));
        $this->assertSame([$first], array_column($this->browse('GET', $this->storeUrl('account/orders?status=delivered'))->json('data'), 'number'));
        $this->assertSame([$third], array_column($this->browse('GET', $this->storeUrl('account/orders?status=cancelled'))->json('data'), 'number'));
        $this->browse('GET', $this->storeUrl('account/orders?status=shipped'))->assertUnprocessable();

        // 10 per page.
        for ($i = 0; $i < 9; $i++) {
            $this->customerOrder(['RICE' => '1']);
        }
        $page2 = $this->browse('GET', $this->storeUrl('account/orders?page=2'))->assertOk();
        $this->assertSame([$second, $first], array_column($page2->json('data'), 'number'));
        $this->assertSame(2, $page2->json('meta.pagination.last_page'));
    }

    public function test_guest_orders_with_the_same_email_are_not_attached(): void
    {
        // A guest order with the e-mail the shopper registers with later.
        $this->addToCart('RICE', 1);
        $total = $this->previewCheckout(['address' => ['district_id' => self::DHAKA], 'shipping_method_id' => $this->methods['inside'], 'payment_method' => 'cod'])->json('data.total');
        $guestOrder = $this->placeOrder($this->checkoutBody($total, ['contact' => ['name' => 'Rina Akter', 'email' => 'shopper@example.test', 'phone' => '01712345678']]))->assertCreated()->json('data.order.number');

        $this->clearBrowser();
        $this->registerShopper(self::HOST, 'shopper@example.test');
        $this->browse('GET', $this->storeUrl('account/orders'))->assertOk()->assertJsonPath('data', []);
        $this->browse('GET', $this->storeUrl("account/orders/{$guestOrder}"))->assertNotFound();
        $this->browse('POST', $this->storeUrl("account/orders/{$guestOrder}/reorder"))->assertNotFound();
        $this->cancel($guestOrder)->assertNotFound();
    }

    public function test_order_detail_view(): void
    {
        $this->registerShopper(self::HOST);
        $number = $this->customerOrder(['SHIRT' => 1, 'JUICE' => 2]);

        $view = $this->browse('GET', $this->storeUrl("account/orders/{$number}"))->assertOk()->assertHeader('Cache-Control', 'no-store, private')->json('data');
        $this->assertSame($number, $view['number']);
        $this->assertTrue($view['can_cancel']);
        $this->assertNull($view['cancel_reason']);
        foreach (['subtotal', 'discount_total', 'tax_total', 'shipping_total', 'promotions', 'coupon_code', 'shipping_address', 'history', 'courier_name', 'tracking_number', 'tracking_url', 'payment_instructions'] as $key) {
            $this->assertArrayHasKey($key, $view);
        }
        $line = $view['lines'][0];
        $this->assertSame('Shirt', $line['product_name']);
        $this->assertNotEmpty($line['product_id']);
        $this->assertSame($this->v['SHIRT'], $line['variant_id']);
        $this->assertArrayHasKey('discount_amount', $line);
        $this->assertNull($line['review']);
        $this->assertFalse($line['reviewable']);

        // Shipped: tracking shows, no longer cancellable; delivered: reviewable.
        $this->advance($number, 'shipped');
        $view = $this->browse('GET', $this->storeUrl("account/orders/{$number}"))->json('data');
        $this->assertSame(['shipped', 'Pathao', 'TRK-1', false], [$view['status'], $view['courier_name'], $view['tracking_number'], $view['can_cancel']]);
        $this->assertSame('https://track.example.test/p?id=TRK-1', $view['tracking_url']);
        $admin = (string) $this->tenant['admin']->id;
        $this->inTenant($this->tenant['organization'], fn () => app(OrderWorkflow::class)->deliver($this->orderModel($number), $admin));
        $view = $this->browse('GET', $this->storeUrl("account/orders/{$number}"))->json('data');
        $this->assertSame([true, true], array_column($view['lines'], 'reviewable'));
    }

    public function test_customer_a_never_sees_or_acts_on_customer_b_orders(): void
    {
        $this->registerShopper(self::HOST, 'a@example.test');
        $number = $this->customerOrder(['SHIRT' => 1]);

        $this->clearBrowser();
        $this->registerShopper(self::HOST, 'b@example.test');
        $this->browse('GET', $this->storeUrl('account/orders'))->assertOk()->assertJsonPath('data', []);
        $this->browse('GET', $this->storeUrl("account/orders/{$number}"))->assertNotFound();
        $this->cancel($number)->assertNotFound();
        $this->browse('POST', $this->storeUrl("account/orders/{$number}/reorder"))->assertNotFound();
        $this->browse('GET', $this->storeUrl('cart'))->assertJsonPath('data.items', []);
        $this->assertSame('confirmed', $this->orderModel($number)->status->value);

        // Guests: 401 everywhere.
        $this->clearBrowser();
        $this->browse('GET', $this->storeUrl('account/orders'))->assertUnauthorized();
        $this->browse('GET', $this->storeUrl("account/orders/{$number}"))->assertUnauthorized();
        $this->cancel($number)->assertUnauthorized();
        $this->browse('POST', $this->storeUrl("account/orders/{$number}/reorder"))->assertUnauthorized();
    }

    public function test_another_organization_never_sees_these_orders(): void
    {
        $this->registerShopper(self::HOST);
        $this->customerOrder(['RICE' => 1]);
        $number = $this->customerOrder(['SHIRT' => 1]); // WEB-000002

        // Another store with its own customer; its order numbers start at WEB-000001 too.
        $this->openStore('Other Shop', 'other.example.test');
        $this->asVisitor();
        $this->clearBrowser();
        $this->registerShopper('other.example.test', 'shopper@example.test');
        $this->browse('GET', $this->storeUrl('account/orders', 'other.example.test'))->assertOk()->assertJsonPath('data', []);
        $this->browse('GET', $this->storeUrl("account/orders/{$number}", 'other.example.test'))->assertNotFound();
        $this->cancel($number, host: 'other.example.test')->assertNotFound();
        $this->browse('POST', $this->storeUrl("account/orders/{$number}/reorder", 'other.example.test'))->assertNotFound();

        // The first store's session is anonymous on the other host and vice versa.
        $this->signIn('shopper@example.test');
        $this->browse('GET', $this->storeUrl('account/orders', 'other.example.test'))->assertUnauthorized();
        $this->assertSame('confirmed', $this->orderModel($number)->status->value);
    }

    public function test_customer_cancels_an_unpaid_order_with_restock_history_and_notifications(): void
    {
        $this->registerShopper(self::HOST);
        $number = $this->customerOrder(['SHIRT' => 2, 'PILLS' => 3]);
        $this->assertSame('3.000', $this->stockOf('SHIRT'));

        $key = (string) Str::uuid();
        $view = $this->cancel($number, ['reason' => '  Ordered by mistake '], $key)->assertOk()->json('data');
        $this->assertSame(['cancelled', false, 'Ordered by mistake'], [$view['status'], $view['can_cancel'], $view['cancel_reason']]);
        $this->assertNotNull($view['cancelled_at']);
        $this->assertSame('5.000', $this->stockOf('SHIRT'));
        $this->assertSame('7.000', $this->stockOf('PILLS'));
        $restocks = StockMovement::query()->withoutGlobalScopes()->where('type', 'online_order_cancel')->count();

        // Replay: same answer, no second restock.
        $this->cancel($number, ['reason' => '  Ordered by mistake '], $key)->assertOk()->assertHeader('Idempotent-Replayed', 'true')->assertJsonPath('data.status', 'cancelled');
        $this->assertSame($restocks, StockMovement::query()->withoutGlobalScopes()->where('type', 'online_order_cancel')->count());
        $this->assertSame('5.000', $this->stockOf('SHIRT'));
        // A new key on a cancelled order.
        $this->cancel($number)->assertUnprocessable()->assertJsonPath('error.code', 'ORDER_NOT_CANCELLABLE')->assertJsonPath('error.details.status', 'cancelled');
        // The key is required.
        $this->browse('POST', $this->storeUrl("account/orders/{$number}/cancel"))->assertStatus(428);

        // Staff see who cancelled it and why; inbox + e-mail went out.
        $this->actingAsUser($this->tenant['admin']);
        $staff = $this->getJson('/api/v1/web-orders/'.$this->orderModel($number)->id)->assertOk()->json('data');
        $last = end($staff['history']);
        $this->assertSame(['cancelled', 'customer', 'Ordered by mistake', null], [$last['status'], $last['actor_type'], $last['note'], $last['actor']]);
        $this->assertSame('customer', $staff['history'][0]['actor_type']);
        $this->assertNull($staff['cancelled_by']);
        Notification::assertSentTo($this->tenant['admin'], OrderCancelledNotification::class, fn (OrderCancelledNotification $n, array $channels, object $notifiable) => $n->toArray($notifiable)['number'] === $number
            && $n->toArray($notifiable)['reason'] === 'Ordered by mistake');
        Notification::assertSentTo(new AnonymousNotifiable, OrderCancellationConfirmation::class, fn (OrderCancellationConfirmation $n, array $channels, AnonymousNotifiable $notifiable) => $notifiable->routes['mail'] === 'rina@example.test'
            && $n->orderUrl === 'http://'.self::HOST.'/account/orders/'.$number);
        Notification::assertSentTimes(OrderCancelledNotification::class, 1);
    }

    public function test_only_unpaid_orders_awaiting_payment_or_confirmed_can_be_cancelled(): void
    {
        $this->registerShopper(self::HOST);

        // Bank transfer awaiting payment: cancellable, without a reason.
        $pending = $this->customerOrder(['RICE' => 1], 'bank_transfer');
        $this->assertTrue($this->browse('GET', $this->storeUrl("account/orders/{$pending}"))->json('data.can_cancel'));
        $this->cancel($pending)->assertOk()->assertJsonPath('data.cancel_reason', null);

        // Paid (bank transfer confirmed by staff): not cancellable.
        $paid = $this->customerOrder(['RICE' => 1], 'bank_transfer');
        $admin = (string) $this->tenant['admin']->id;
        $this->inTenant($this->tenant['organization'], fn () => app(OrderWorkflow::class)->confirmPayment($this->orderModel($paid), 'REF-1', $admin));
        $this->assertFalse($this->browse('GET', $this->storeUrl("account/orders/{$paid}"))->json('data.can_cancel'));
        $this->cancel($paid)->assertUnprocessable()->assertJsonPath('error.code', 'ORDER_NOT_CANCELLABLE')
            ->assertJsonPath('error.details.status', 'confirmed')->assertJsonPath('error.details.payment_status', 'paid');

        // Processing: not cancellable by the customer (staff still can).
        $processing = $this->customerOrder(['RICE' => 1]);
        $this->advance($processing, 'processing');
        $this->cancel($processing)->assertUnprocessable()->assertJsonPath('error.details.status', 'processing');
        $this->assertSame('processing', $this->orderModel($processing)->status->value);

        $this->cancel($this->customerOrder(['RICE' => 1]), ['reason' => str_repeat('x', 201)])->assertUnprocessable()->assertJsonPath('error.code', 'VALIDATION_FAILED')->assertJsonStructure(['error' => ['details' => ['reason']]]);
    }

    public function test_reorder_adds_lines_at_todays_prices_and_reports_skipped_ones(): void
    {
        $this->registerShopper(self::HOST);
        $number = $this->customerOrder(['SHIRT' => 1, 'JUICE' => 2, 'RICE' => '1', 'PILLS' => 1]);
        $lines = collect($this->browse('GET', $this->storeUrl("account/orders/{$number}"))->json('data.lines'))->keyBy('sku');

        // Rice is unpublished, Juice sold out (a guest buys the rest), Shirt: the cart already holds all 4 left.
        $this->actingAsUser($this->tenant['admin']);
        $this->putJson("/api/v1/online-catalog/products/{$lines['RICE']['product_id']}", ['is_published' => false, 'is_featured' => false])->assertOk();
        $t = $this->tenant;
        $this->inTenant($t['organization'], fn () => app(PostStockAdjustment::class)($t['admin']->fresh(), [
            'store_id' => $t['store']->id,
            'reason' => 'damage',
            'lines' => [['variant_id' => $this->v['JUICE'], 'quantity' => '-8']],
        ]));
        $this->browse('DELETE', $this->storeUrl('cart'))->assertOk();
        $this->addToCart('SHIRT', 4);

        $result = $this->browse('POST', $this->storeUrl("account/orders/{$number}/reorder"))->assertOk()->json('data');
        $this->assertSame([['variant_id' => $this->v['PILLS'], 'name' => 'Pills', 'quantity' => '1']], $result['added']);
        $this->assertEqualsCanonicalizing([
            ['name' => 'Shirt', 'reason' => 'limit'],
            ['name' => 'Juice', 'reason' => 'out_of_stock'],
            ['name' => 'Rice', 'reason' => 'unavailable'],
        ], $result['skipped']);
        $items = collect($result['cart']['items'])->keyBy('variant_id');
        $this->assertSame(['4', '1'], [$items[$this->v['SHIRT']]['quantity'], $items[$this->v['PILLS']]['quantity']]);
        $this->assertSame('100.00', $items[$this->v['PILLS']]['unit_price']);

        // Merging: a second re-order adds another pill to the same line.
        $again = $this->browse('POST', $this->storeUrl("account/orders/{$number}/reorder"))->assertOk()->json('data');
        $this->assertSame('2', collect($again['cart']['items'])->keyBy('variant_id')[$this->v['PILLS']]['quantity']);
    }

    public function test_storefront_shell_knows_the_account_order_and_review_pages(): void
    {
        $shell = sys_get_temp_dir().'/storefront-shell-'.Str::random(6).'.html';
        file_put_contents($shell, '<html><head><title>x</title></head><body></body></html>');
        config(['storefront.shell_path' => $shell]);

        foreach (['/account/orders', '/account/orders/WEB-000123', '/account/reviews', '/account/returns'] as $path) {
            $this->get('http://'.self::HOST.$path)->assertOk()->assertHeader('X-Robots-Tag', 'noindex');
        }
        $this->get('http://'.self::HOST.'/account/orders/a/b')->assertNotFound();
        @unlink($shell);
    }
}
