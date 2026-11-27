<?php

namespace App\Modules\Inventory\Tests\Feature;

use App\Modules\Inventory\Application\Contracts\SerialRegister;
use App\Modules\Inventory\Domain\SerialStatus;
use App\Modules\Inventory\Domain\StockReference;
use App\Modules\Inventory\Tests\Concerns\InteractsWithStock;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Shared\Domain\Exceptions\BusinessRuleViolation;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Shared\Tests\Concerns\TruncatesCommittedData;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use LogicException;
use Tests\TestCase;

/**
 * ST2d: the same serial sold at two tills is sold once. Two real PostgreSQL connections
 * (committed data, so TruncatesCommittedData instead of RefreshDatabase).
 */
class SerialConcurrencyTest extends TestCase
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

    public function test_the_same_serial_sold_at_two_tills_is_sold_once(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $phone = $this->stockedVariant($org, 'Phone', ['track_serials' => true]);
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin)->adjust($store, 'opening', ['variant_id' => $phone->id, 'quantity' => '1', 'unit_cost' => '100', 'serials' => ['IMEI-1']]);
        $sell = fn (string $serial) => app(SerialRegister::class)->issue($store, $phone->id, [$serial], SerialStatus::Sold, new StockReference('sale', (string) Str::uuid7()));

        app(TenantContext::class)->runAs($org->id, function () use ($sell, $phone) {
            // Till 1 sells it and has not committed yet.
            DB::beginTransaction();
            $sell('imei-1');

            // Till 2 cannot read the serial for its own sale until till 1 is done (no stale "in stock").
            $second = DB::connection('pgsql_second');
            $second->statement("SET lock_timeout = '300ms'");
            try {
                $second->transaction(fn () => $second->table('serial_numbers')->where('variant_id', $phone->id)->lockForUpdate()->get());
                $this->fail('The serial row should have been locked.');
            } catch (QueryException $e) {
                $this->assertSame('55P03', $e->getCode()); // lock_not_available
            }
            DB::commit();

            // Till 2 now finds it sold.
            try {
                DB::transaction(fn () => $sell('IMEI-1'));
                $this->fail('The serial was sold twice.');
            } catch (BusinessRuleViolation $e) {
                $this->assertSame('SERIAL_NOT_IN_STOCK', $e->errorCode);
            }
        });

        $this->assertSame('sold', DB::table('serial_numbers')->where('variant_id', $phone->id)->value('status'));
        $this->assertSame(1, DB::table('serial_number_events')->where('type', 'sold')->count());
    }

    public function test_a_new_serial_inserted_at_two_tills_is_created_once(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $phone = $this->stockedVariant($org, 'Phone', ['track_serials' => true]);
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);

        app(TenantContext::class)->runAs($org->id, function () use ($org, $phone, $store) {
            DB::beginTransaction();
            app(SerialRegister::class)->receive($store, $phone->id, ['NEW-1'], new StockReference('test', (string) Str::uuid7()));

            // The other till's insert of the same serial waits on the unique index instead of duplicating it.
            $second = DB::connection('pgsql_second');
            $second->statement("SET lock_timeout = '300ms'");
            try {
                $second->table('serial_numbers')->insertOrIgnore([
                    'id' => (string) Str::uuid7(), 'organization_id' => $org->id, 'variant_id' => $phone->id,
                    'serial' => 'new-1', 'store_id' => $store, 'status' => 'in_stock', 'updated_at' => now(),
                ]);
                $this->fail('The second insert should have waited for the first.');
            } catch (QueryException $e) {
                $this->assertSame('55P03', $e->getCode());
            }
            DB::commit();
        });

        $this->assertSame(1, DB::table('serial_numbers')->where('variant_id', $phone->id)->count());
    }

    public function test_the_register_only_changes_inside_a_transaction(): void
    {
        ['organization' => $org] = $this->provisionTenant();
        $phone = $this->stockedVariant($org, 'Phone', ['track_serials' => true]);
        $store = $this->mainStoreId($org);

        $this->expectException(LogicException::class);
        app(TenantContext::class)->runAs($org->id, fn () => app(SerialRegister::class)->receive($store, $phone->id, ['A-1'], new StockReference('test', (string) Str::uuid7())));
    }
}
