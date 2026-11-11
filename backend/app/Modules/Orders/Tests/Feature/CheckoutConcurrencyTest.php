<?php

namespace App\Modules\Orders\Tests\Feature;

use App\Modules\CustomerAccounts\Tests\Concerns\ActsAsShopper;
use App\Modules\Inventory\Application\Actions\PostStockAdjustment;
use App\Modules\Inventory\Infrastructure\Models\StockLevel;
use App\Modules\OnlineCatalog\Tests\Concerns\BuildsOnlineCatalog;
use App\Modules\Orders\Infrastructure\Models\Order;
use App\Modules\Orders\Tests\Concerns\BuildsCheckout;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Shared\Tests\Concerns\TruncatesCommittedData;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Tests\TestCase;

/**
 * Two checkouts racing for the last unit, with a second database connection standing in
 * for the competing request (committed data, so TruncatesCommittedData). Skipped on other
 * drivers: SQLite has no row-level locks.
 */
class CheckoutConcurrencyTest extends TestCase
{
    use ActsAsShopper, BuildsCheckout, BuildsOnlineCatalog, InteractsWithTenancy, TruncatesCommittedData;

    protected function setUp(): void
    {
        // Decided before the application boots: DatabaseTruncation would otherwise mark the
        // in-memory SQLite schema as migrated and break the RefreshDatabase tests run after it.
        if ((getenv('DB_CONNECTION') ?: ($_ENV['DB_CONNECTION'] ?? null)) !== 'pgsql') {
            $this->markTestSkipped('Row-level locking tests require PostgreSQL.');
        }

        parent::setUp();

        config(['database.connections.pgsql_second' => config('database.connections.pgsql')]);
        Notification::fake();
        $this->buildShop();
    }

    public function test_two_checkouts_cannot_both_take_the_last_unit(): void
    {
        $this->inTenant($this->tenant['organization'], fn () => app(PostStockAdjustment::class)($this->tenant['admin']->fresh(), [
            'store_id' => $this->tenant['store']->id,
            'reason' => 'damage',
            'lines' => [['variant_id' => $this->v['SHIRT'], 'quantity' => '-4']],
        ]));
        $this->asVisitor();

        // Both shoppers put the last shirt in their cart while it is still available.
        $this->addToCart('SHIRT', 1);
        $first = $this->jar;
        $this->clearBrowser();
        $this->addToCart('SHIRT', 1);
        $second = $this->jar;

        // The first checkout holds the stock row until its transaction ends.
        DB::beginTransaction();
        $this->jar = $first;
        $this->placeOrder($this->checkoutBody('510.00'))->assertCreated();

        $other = DB::connection('pgsql_second');
        $other->statement("SET lock_timeout = '300ms'");
        try {
            $other->transaction(fn () => $other->table('stock_levels')->where('variant_id', $this->v['SHIRT'])->lockForUpdate()->get());
            $this->fail('The stock row should be locked by the placing checkout.');
        } catch (QueryException $e) {
            $this->assertSame('55P03', $e->getCode()); // lock_not_available
        }
        DB::commit();

        // The second checkout sees the stock gone: no order, no oversell.
        $this->jar = $second;
        $code = $this->placeOrder($this->checkoutBody('510.00'))->assertStatus(422)->json('error.code');
        $this->assertContains($code, ['INSUFFICIENT_STOCK', 'CART_HAS_ISSUES']);

        $this->assertSame(1, Order::query()->withoutGlobalScopes()->count());
        $this->assertSame('0.000', (string) StockLevel::query()->withoutGlobalScopes()->where('variant_id', $this->v['SHIRT'])->value('quantity'));
    }
}
