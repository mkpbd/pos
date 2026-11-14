<?php

namespace App\Modules\Orders\Tests\Feature;

use App\Modules\CustomerAccounts\Tests\Concerns\ActsAsShopper;
use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Orders\Application\Contracts\OrderBaskets;
use App\Modules\Orders\Tests\Concerns\BuildsCheckout;
use App\Modules\Orders\Tests\Concerns\BuildsCustomerOrders;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * P1b: web orders as baskets of distinct products for "frequently bought together" — only
 * orders that stand as sales (not cancelled, not awaiting payment, not refunded), inside the
 * window and the organization.
 */
class OrderBasketsTest extends TestCase
{
    use ActsAsShopper, BuildsCheckout, BuildsCustomerOrders, BuildsOnlineCatalog, InteractsWithTenancy, RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Notification::fake();
        $this->buildShop();
    }

    /**
     * @return list<list<string>> each basket's SKUs, sorted
     */
    private function baskets(string $organizationId, int $days = 180): array
    {
        $skus = DB::table('product_variants')->pluck('sku', 'product_id')->all();
        $result = [];
        foreach (app(OrderBaskets::class)->since($organizationId, now()->subDays($days)) as $basket) {
            $names = array_map(fn (string $id) => $skus[$id], $basket);
            sort($names);
            $result[] = $names;
        }
        sort($result);

        return $result;
    }

    public function test_orders_that_stand_as_sales_are_baskets_of_distinct_products(): void
    {
        $org = $this->tenant['organization']->id;
        $this->customerOrder(['SHIRT' => 1, 'RICE' => 2, 'JUICE' => 1]);
        $processing = $this->customerOrder(['SHIRT' => 1, 'JUICE' => 1]);
        $this->advance($processing, 'delivered');
        $this->customerOrder(['RICE' => 1]); // one product: no pair
        $cancelled = $this->customerOrder(['JUICE' => 1, 'PILLS' => 1]);
        $this->actingAsUser($this->tenant['admin']);
        $this->postJson("/api/v1/web-orders/{$this->orderModel($cancelled)->id}/cancel", ['reason' => 'Duplicate'], ['Idempotency-Key' => (string) Str::uuid()])->assertOk();
        $this->asVisitor();
        $this->customerOrder(['RICE' => 1, 'PILLS' => 1], 'bank_transfer'); // awaiting payment
        $refunded = $this->customerOrder(['RICE' => 1, 'JUICE' => 1]);
        $old = $this->customerOrder(['PILLS' => 1, 'SHIRT' => 1]);

        DB::table('orders')->where('id', $this->orderModel($refunded)->id)->update(['payment_status' => 'refunded']);
        DB::table('orders')->where('id', $this->orderModel($old)->id)->update(['placed_at' => now()->subDays(200)]);

        $this->assertSame([['JUICE', 'SHIRT'], ['JUICE', 'RICE', 'SHIRT']], $this->baskets($org));
        $this->assertCount(3, $this->baskets($org, 365), 'The window decides which orders count.');

        // Another organization's orders are never part of these baskets.
        $other = $this->openStore('Other Shop', 'other.test');
        $this->assertSame([], $this->baskets($other['organization']->id));
    }
}
