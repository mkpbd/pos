<?php

namespace App\Modules\StoredValue\Tests\Feature;

use App\Modules\Sales\Tests\Concerns\InteractsWithSales;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Shared\Tests\Concerns\TruncatesCommittedData;
use App\Modules\StoredValue\Infrastructure\Models\StoreCreditEntry;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * Two tills spending the same store credit: the first checkout holds the customer's store
 * credit lock until it commits, so the second one sees what is left (committed data, so
 * TruncatesCommittedData; a second connection plays the competing till).
 */
class StoreCreditConcurrencyTest extends TestCase
{
    use InteractsWithSales, InteractsWithTenancy, TruncatesCommittedData;

    protected function setUp(): void
    {
        if ((getenv('DB_CONNECTION') ?: ($_ENV['DB_CONNECTION'] ?? null)) !== 'pgsql') {
            $this->markTestSkipped('Locking tests require PostgreSQL.');
        }

        parent::setUp();

        config(['database.connections.pgsql_second' => config('database.connections.pgsql')]);
    }

    public function test_two_tills_cannot_spend_the_same_credit(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $rice = $this->sellable($org, 'Rice', '100.00');
        $store = $this->mainStoreId($org);
        $rina = $this->customer($org, 'Rina');
        $this->actingAsUser($admin);
        $this->stockUp($store, $rice, '10');
        $this->postJson("/api/v1/customers/{$rina->id}/store-credit/adjustments", ['amount' => '150', 'reason' => 'Opening'], ['Idempotency-Key' => (string) Str::uuid()])->assertCreated();

        DB::beginTransaction();
        $this->checkout($this->cart($store, [[$rice, '1']], [['store_credit', '100']], ['customer_id' => $rina->id]))->assertCreated();

        // The competing till cannot take the customer's store credit lock while the sale is open.
        $other = DB::connection('pgsql_second');
        $key = "store-credit:{$rina->id}";
        $this->assertFalse((bool) $other->selectOne('SELECT pg_try_advisory_lock(hashtextextended(?, 0)) AS ok', [$key])->ok);
        DB::commit();
        $this->assertTrue((bool) $other->selectOne('SELECT pg_try_advisory_lock(hashtextextended(?, 0)) AS ok', [$key])->ok);
        $other->selectOne('SELECT pg_advisory_unlock(hashtextextended(?, 0))', [$key]);

        // After the first sale committed, only 50 is left.
        $this->checkout($this->cart($store, [[$rice, '1']], [['store_credit', '100']], ['customer_id' => $rina->id]))
            ->assertStatus(422)->assertJsonPath('error.code', 'INSUFFICIENT_STORE_CREDIT')->assertJsonPath('error.details.balance', '50.00');
        $this->assertSame(2, StoreCreditEntry::query()->withoutGlobalScopes()->count());
        $this->getJson("/api/v1/customers/{$rina->id}/store-credit")->assertJsonPath('data.balance', '50.00');
    }
}
