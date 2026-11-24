<?php

namespace App\Modules\Inventory\Tests\Feature;

use App\Modules\Inventory\Tests\Concerns\InteractsWithStock;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Shared\Tests\Concerns\TruncatesCommittedData;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * ST1: stocktake counting under concurrency, with a second real PostgreSQL connection playing
 * the other counter / the sale / the counter still saving (committed data, so
 * TruncatesCommittedData instead of RefreshDatabase).
 */
class StocktakeConcurrencyTest extends TestCase
{
    use InteractsWithStock, InteractsWithTenancy, TruncatesCommittedData;

    protected function setUp(): void
    {
        if ((getenv('DB_CONNECTION') ?: ($_ENV['DB_CONNECTION'] ?? null)) !== 'pgsql') {
            $this->markTestSkipped('Row-level locking tests require PostgreSQL.');
        }

        parent::setUp();

        config(['database.connections.pgsql_second' => config('database.connections.pgsql')]);
    }

    public function test_two_counters_scanning_the_same_product_add_up(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $variant = $this->stockedVariant($org);
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin)->adjust($store, 'opening', ['variant_id' => $variant->id, 'quantity' => '9', 'unit_cost' => '1']);
        $id = $this->startedStocktake($store);
        $this->scan($id, $variant->sku)->assertOk()->assertJsonPath('data.line.counted_quantity', '1.000');
        $lineId = DB::table('stocktake_lines')->where('stocktake_id', $id)->value('id');

        // The other counter's scan of 2 is in flight (its increment holds the line).
        $second = DB::connection('pgsql_second');
        $second->beginTransaction();
        $second->update('UPDATE stocktake_lines SET counted_quantity = COALESCE(counted_quantity, 0) + 2 WHERE id = ?', [$lineId]);
        DB::statement("SET lock_timeout = '300ms'");
        try {
            $this->withoutExceptionHandling()->postJson("/api/v1/inventory/stocktakes/{$id}/scan", ['barcode' => $variant->sku]);
            $this->fail('The scan should have waited for the other counter.');
        } catch (QueryException $e) {
            $this->assertSame('55P03', $e->getCode()); // lock_not_available: waits, never overwrites
        } finally {
            $second->commit();
            DB::statement('SET lock_timeout = 0');
        }

        $this->withExceptionHandling();
        $this->scan($id, $variant->sku)->assertOk()
            ->assertJsonPath('data.line.counted_quantity', '4.000') // 1 + 2 + 1
            ->assertJsonPath('data.line.system_quantity', '9.000');
    }

    public function test_a_count_snapshot_waits_for_a_sale_in_flight_and_a_post_waits_for_counts_in_flight(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $variant = $this->stockedVariant($org);
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin)->adjust($store, 'opening', ['variant_id' => $variant->id, 'quantity' => '5', 'unit_cost' => '1']);
        $id = $this->startedStocktake($store);
        $second = DB::connection('pgsql_second');

        // A sale holds the stock row: the count must not snapshot a quantity that is about to change.
        $second->beginTransaction();
        $second->table('stock_levels')->where('variant_id', $variant->id)->lockForUpdate()->get();
        DB::statement("SET lock_timeout = '300ms'");
        try {
            $this->withoutExceptionHandling()->putJson("/api/v1/inventory/stocktakes/{$id}/lines", ['lines' => [['variant_id' => $variant->id, 'counted_quantity' => '4']]]);
            $this->fail('The count should have waited for the stock row.');
        } catch (QueryException $e) {
            $this->assertSame('55P03', $e->getCode());
        } finally {
            $second->rollBack();
            DB::statement('SET lock_timeout = 0');
        }
        $this->withExceptionHandling();
        $this->putJson("/api/v1/inventory/stocktakes/{$id}/lines", ['lines' => [['variant_id' => $variant->id, 'counted_quantity' => '4']]])->assertOk();

        // A counter is still saving (holds the stocktake FOR SHARE): posting waits for it.
        $second->beginTransaction();
        $second->select('SELECT id FROM stocktakes WHERE id = ? FOR SHARE', [$id]);
        DB::statement("SET lock_timeout = '300ms'");
        try {
            $this->withoutExceptionHandling()->postJson("/api/v1/inventory/stocktakes/{$id}/post", ['uncounted_policy' => 'ignore']);
            $this->fail('The post should have waited for the count in flight.');
        } catch (QueryException $e) {
            $this->assertSame('55P03', $e->getCode());
        } finally {
            $second->rollBack();
            DB::statement('SET lock_timeout = 0');
        }
        $this->withExceptionHandling();
        $this->postJson("/api/v1/inventory/stocktakes/{$id}/post", ['uncounted_policy' => 'ignore'])->assertOk()->assertJsonPath('data.status', 'posted');
        $this->assertSame('4.000', $this->stockRow($variant->id, $store)['quantity']);
    }

    private function startedStocktake(string $storeId): string
    {
        $id = $this->postJson('/api/v1/inventory/stocktakes', ['store_id' => $storeId, 'scope' => 'all'])->assertCreated()->json('data.id');
        $this->postJson("/api/v1/inventory/stocktakes/{$id}/start")->assertOk();

        return $id;
    }

    private function scan(string $id, string $code): TestResponse
    {
        return $this->postJson("/api/v1/inventory/stocktakes/{$id}/scan", ['barcode' => $code]);
    }
}
