<?php

namespace App\Modules\Inventory\Tests\Feature;

use App\Modules\Inventory\Application\Contracts\StockLedger;
use App\Modules\Inventory\Domain\MovementType;
use App\Modules\Inventory\Domain\StockChange;
use App\Modules\Inventory\Domain\StockReference;
use App\Modules\Inventory\Tests\Concerns\InteractsWithStock;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\DatabaseTruncation;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Critical concurrency guarantees of the stock ledger, verified with two real PostgreSQL
 * connections (committed data, so DatabaseTruncation instead of RefreshDatabase).
 * Skipped on other drivers: SQLite has no row-level locks.
 */
class StockLockingTest extends TestCase
{
    use DatabaseTruncation, InteractsWithStock, InteractsWithTenancy;

    protected function setUp(): void
    {
        // Decided before the application boots: DatabaseTruncation would otherwise mark the
        // in-memory SQLite schema as migrated and break the RefreshDatabase tests run after it.
        if ((getenv('DB_CONNECTION') ?: ($_ENV['DB_CONNECTION'] ?? null)) !== 'pgsql') {
            $this->markTestSkipped('Row-level locking tests require PostgreSQL.');
        }

        parent::setUp();

        config(['database.connections.pgsql_second' => config('database.connections.pgsql')]);
    }

    public function test_stock_rows_are_locked_until_the_posting_transaction_ends(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $variant = $this->stockedVariant($org);
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin)->adjust($store, 'opening', ['variant_id' => $variant->id, 'quantity' => '1', 'unit_cost' => '1']);

        app(TenantContext::class)->runAs($org->id, function () use ($variant, $store) {
            DB::beginTransaction();
            app(StockLedger::class)->post([new StockChange($store, $variant->id, null, MovementType::AdjustmentOut, '1')], new StockReference('test', $variant->id));

            // A second connection (another request) cannot touch the row while the first holds it.
            $second = DB::connection('pgsql_second');
            $second->statement("SET lock_timeout = '300ms'");
            try {
                $second->transaction(fn () => $second->table('stock_levels')->where('variant_id', $variant->id)->lockForUpdate()->get());
                $this->fail('The stock row should have been locked.');
            } catch (QueryException $e) {
                $this->assertSame('55P03', $e->getCode()); // lock_not_available
            }

            DB::commit();
        });
    }

    public function test_the_last_unit_cannot_be_issued_twice(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $variant = $this->stockedVariant($org);
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin)->adjust($store, 'opening', ['variant_id' => $variant->id, 'quantity' => '1', 'unit_cost' => '1']);

        app(TenantContext::class)->runAs($org->id, function () use ($variant, $store) {
            $issue = fn () => DB::transaction(fn () => app(StockLedger::class)->post(
                [new StockChange($store, $variant->id, null, MovementType::AdjustmentOut, '1')],
                new StockReference('test', $variant->id),
            ));

            $issue();
            $this->expectException(BusinessRuleViolation::class);
            $issue();
        });
    }
}
