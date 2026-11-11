<?php

namespace App\Modules\Promotions\Tests\Feature;

use App\Modules\CustomerAccounts\Tests\Concerns\ActsAsShopper;
use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Orders\Tests\Concerns\BuildsCheckout;
use App\Modules\Promotions\Infrastructure\Models\Coupon;
use App\Modules\Promotions\Infrastructure\Models\PromotionRedemption;
use App\Modules\Promotions\Tests\Concerns\BuildsPromotions;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Shared\Tests\Concerns\TruncatesCommittedData;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Tests\TestCase;

/**
 * Two checkouts racing for a coupon that may be used once, with a second database
 * connection standing in for the competing request (committed data, so TruncatesCommittedData).
 * Skipped on other drivers: SQLite has no row-level locks.
 */
class PromotionConcurrencyTest extends TestCase
{
    use ActsAsShopper, BuildsCheckout, BuildsOnlineCatalog, BuildsPromotions, InteractsWithTenancy, TruncatesCommittedData;

    protected function setUp(): void
    {
        // Decided before the application boots (see CheckoutConcurrencyTest).
        if ((getenv('DB_CONNECTION') ?: ($_ENV['DB_CONNECTION'] ?? null)) !== 'pgsql') {
            $this->markTestSkipped('Row-level locking tests require PostgreSQL.');
        }

        parent::setUp();

        config(['database.connections.pgsql_second' => config('database.connections.pgsql'), 'pos.coupon_rate_limit' => 1000]);
        Notification::fake();
        $this->buildShop();
    }

    public function test_two_checkouts_cannot_both_redeem_a_single_use_coupon(): void
    {
        $promotion = $this->makePromotion($this->tenant['organization'], ['name' => 'Once', 'type' => 'fixed', 'value' => '50', 'trigger' => 'coupon']);
        $coupon = $this->makeCoupon($this->tenant['organization'], $promotion, 'ONLYONCE', 1);
        $this->asVisitor();

        // Both shoppers apply the code while it is still unused.
        $this->addToCart('SHIRT', 1);
        $this->browse('POST', $this->storeUrl('cart/coupon'), ['code' => 'ONLYONCE'])->assertOk();
        $first = $this->jar;
        $this->clearBrowser();
        $this->addToCart('SHIRT', 1);
        $this->browse('POST', $this->storeUrl('cart/coupon'), ['code' => 'ONLYONCE'])->assertOk();
        $second = $this->jar;

        // The first placement holds the coupon row until its transaction ends.
        DB::beginTransaction();
        $this->jar = $first;
        $this->placeOrder($this->checkoutBody('460.00'))->assertCreated();

        $other = DB::connection('pgsql_second');
        $other->statement("SET lock_timeout = '300ms'");
        try {
            $other->transaction(fn () => $other->table('coupons')->where('id', $coupon->id)->lockForUpdate()->get());
            $this->fail('The coupon row should be locked by the placing checkout.');
        } catch (QueryException $e) {
            $this->assertSame('55P03', $e->getCode()); // lock_not_available
        }
        DB::commit();

        // The second checkout finds the code used up: the total changed, nothing redeemed twice.
        $this->jar = $second;
        $this->placeOrder($this->checkoutBody('460.00'))->assertStatus(409)->assertJsonPath('error.code', 'TOTAL_CHANGED')
            ->assertJsonPath('error.details.preview.coupon.reason', 'usage_limit_reached');

        $this->assertSame(1, Order::query()->withoutGlobalScopes()->count());
        $this->assertSame(1, PromotionRedemption::query()->withoutGlobalScopes()->count());
        $this->assertSame(1, (int) Coupon::query()->withoutGlobalScopes()->whereKey($coupon->id)->value('used_count'));
    }
}
