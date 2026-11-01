<?php

namespace App\Modules\Orders\Tests\Feature;

use App\Modules\CustomerAccounts\Tests\Concerns\ActsAsShopper;
use App\Modules\Customers\Infrastructure\Models\Customer;
use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Orders\Application\Actions\OrderWorkflow;
use App\Modules\Orders\Tests\Concerns\BuildsCheckout;
use App\Modules\Orders\Tests\Concerns\BuildsCustomerOrders;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * E10b: the admin customer card's "Web activity" — account, orders, returns, reviews,
 * wishlist and cart of one customer, composed through the Customers contracts.
 */
class CustomerWebActivityTest extends TestCase
{
    use ActsAsShopper, BuildsCheckout, BuildsCustomerOrders, BuildsOnlineCatalog, InteractsWithTenancy, RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Notification::fake();
        config(['pos.review_rate_limit' => 100]);
        $this->buildShop();
    }

    public function test_web_activity_numbers_of_a_customer(): void
    {
        $this->registerShopper(self::HOST, 'rina@example.test');
        // Delivered and paid (Juice ×3 + delivery 60 = 474.00), with a refunded return of one juice (138.00).
        $paid = $this->customerOrder(['JUICE' => 3]);
        $this->advance($paid, 'delivered');
        $admin = (string) $this->tenant['admin']->id;
        $this->inTenant($this->tenant['organization'], fn () => app(OrderWorkflow::class)->recordCodPayment($this->orderModel($paid), 'COD', $admin));
        $this->travel(1)->minutes();
        // Open and unpaid (Shirt 450 + 60), then a cancelled one.
        $open = $this->customerOrder(['SHIRT' => 1]);
        $this->travel(1)->minutes();
        $cancelled = $this->customerOrder(['RICE' => 1]);
        $this->browse('POST', $this->storeUrl("account/orders/{$cancelled}/cancel"), [], ['Idempotency-Key' => (string) Str::uuid()])->assertOk();

        $lines = collect($this->browse('GET', $this->storeUrl("account/orders/{$paid}"))->json('data.lines'))->keyBy('sku');
        $this->browse('POST', $this->storeUrl("account/orders/{$paid}/returns"), ['reason_code' => 'damaged', 'lines' => [['order_line_id' => $lines['JUICE']['id'], 'quantity' => 1]]], ['Idempotency-Key' => (string) Str::uuid()])->assertCreated();
        $this->browse('POST', $this->storeUrl('account/reviews'), ['product_id' => $lines['JUICE']['product_id'], 'rating' => 4, 'body' => 'Tasty juice, good value.'])->assertCreated();
        $this->browse('POST', $this->storeUrl('wishlist/items'), ['product_id' => $lines['JUICE']['product_id']])->assertSuccessful();
        $this->addToCart('SHIRT', 2);
        $this->addToCart('JUICE', 1);

        $this->actingAsUser($this->tenant['admin']);
        $returnId = $this->getJson('/api/v1/web-order-returns')->json('data.0.id');
        foreach (['approve' => [], 'receive' => ['lines' => []], 'refund' => ['method' => 'bank_transfer']] as $step => $body) {
            $this->postJson("/api/v1/web-order-returns/{$returnId}/{$step}", $body, ['Idempotency-Key' => (string) Str::uuid()])->assertOk();
        }

        $customerId = $this->orderModel($paid)->customer_id;
        $activity = $this->getJson("/api/v1/customers/{$customerId}/web-activity")->assertOk()->json('data');
        $this->assertSame(['rina@example.test', false, 'active'], [$activity['account']['email'], $activity['account']['verified'], $activity['account']['status']]);
        $this->assertNotNull($activity['account']['created_at']);
        $this->assertNotNull($activity['account']['last_login_at']);
        // 2 orders not cancelled; spent 474 − 138 = 336 over the one paid order.
        $this->assertSame(['count' => 2, 'total_spent' => '336.00', 'last_order_at' => $this->orderModel($cancelled)->placed_at->toIso8601String(), 'average_order' => '336.00'], $activity['orders']);
        $this->assertSame(1, $activity['returns_count']);
        $this->assertSame(['count' => 1, 'pending' => 1], $activity['reviews']);
        $this->assertSame(1, $activity['wishlist_count']);
        $this->assertSame('3', $activity['cart']['item_count']);
        $this->assertNotNull($activity['cart']['updated_at']);
        $this->assertSame([$cancelled, $open, $paid], array_column($activity['recent_orders'], 'number'));
        $this->assertSame(['cancelled', 'confirmed', 'partially_refunded'], [$activity['recent_orders'][0]['status'], $activity['recent_orders'][1]['status'], $activity['recent_orders'][2]['payment_status']]);

        // A walk-in customer has no web activity.
        $walkIn = $this->postJson('/api/v1/customers', ['name' => 'Walk In'])->assertCreated()->json('data.id');
        $this->assertSame([
            'account' => null,
            'orders' => ['count' => 0, 'total_spent' => '0.00', 'last_order_at' => null, 'average_order' => '0.00'],
            'returns_count' => 0,
            'reviews' => ['count' => 0, 'pending' => 0],
            'wishlist_count' => 0,
            'cart' => null,
            'recent_orders' => [],
        ], $this->getJson("/api/v1/customers/{$walkIn}/web-activity")->assertOk()->json('data'));

        // customers.view is needed; other organizations get a 404.
        $this->actingAsUser($this->createUserWithRole($this->tenant['organization'], SystemRole::InventoryManager));
        $this->getJson("/api/v1/customers/{$customerId}/web-activity")->assertForbidden();
        $this->actingAsUser($this->createUserWithRole($this->tenant['organization'], SystemRole::Cashier, [$this->tenant['store']->branch_id]));
        $this->getJson("/api/v1/customers/{$customerId}/web-activity")->assertOk();
        $this->openStore('Other Shop', 'other.example.test');
        $this->getJson("/api/v1/customers/{$customerId}/web-activity")->assertNotFound();
        $this->assertTrue(Customer::query()->withoutGlobalScopes()->whereKey($customerId)->exists());
    }
}
