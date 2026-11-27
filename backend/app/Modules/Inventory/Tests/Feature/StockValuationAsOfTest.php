<?php

namespace App\Modules\Inventory\Tests\Feature;

use App\Modules\Inventory\Application\Actions\ResolveBatch;
use App\Modules\Inventory\Application\Contracts\StockLedger;
use App\Modules\Inventory\Application\Contracts\StockValuation;
use App\Modules\Inventory\Domain\MovementType;
use App\Modules\Inventory\Domain\StockChange;
use App\Modules\Inventory\Domain\StockReference;
use App\Modules\Inventory\Domain\StockRevaluation;
use App\Modules\Inventory\Infrastructure\Ledger\AverageCostReplay;
use App\Modules\Inventory\Tests\Concerns\InteractsWithStock;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Shared\Tests\Concerns\ReadsExports;
use App\Modules\Users\Domain\Roles\SystemRole;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * ST2d §1: stock value as of a past date (average_cost_after on every movement) and the
 * replay backfill that fills it for existing ledgers. Tenants run in Asia/Dhaka (UTC+6).
 */
class StockValuationAsOfTest extends TestCase
{
    use InteractsWithStock, InteractsWithTenancy, ReadsExports, RefreshDatabase;

    private function at(string $local): void
    {
        $this->travelTo(CarbonImmutable::parse($local, 'Asia/Dhaka'));
    }

    public function test_the_month_end_value_ignores_later_movements(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $juice = $this->stockedVariant($org);
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);

        $this->at('2026-10-15 10:00');
        $this->adjust($store, 'opening', ['variant_id' => $juice->id, 'quantity' => '10', 'unit_cost' => '5']);
        $this->at('2026-11-05 10:00');
        $this->adjust($store, 'correction', ['variant_id' => $juice->id, 'quantity' => '10', 'unit_cost' => '8']); // avg 6.5
        $this->at('2026-11-10 10:00');
        $this->adjust($store, 'damage', ['variant_id' => $juice->id, 'quantity' => '-5']);

        $this->at('2026-11-20 10:00');
        $this->getJson('/api/v1/inventory/valuation?as_of=2026-10-31')->assertOk()
            ->assertJsonPath('data.as_of', '2026-10-31')
            ->assertJsonPath('data.total', '50.00')
            ->assertJsonPath('data.stores.0.products', 1)
            ->assertJsonPath('data.stores.0.value', '50.00');
        $this->getJson('/api/v1/inventory/valuation?as_of=2026-11-05')->assertJsonPath('data.total', '130.00');
        $this->getJson('/api/v1/inventory/valuation?as_of=2026-10-14')->assertJsonPath('data.total', '0.00')->assertJsonCount(0, 'data.stores');
        // Today (and no date) is the current stock value.
        $this->getJson('/api/v1/inventory/valuation?as_of=2026-11-20')->assertJsonPath('data.total', '97.50');
        $this->getJson('/api/v1/inventory/valuation')->assertJsonPath('data.as_of', null)->assertJsonPath('data.total', '97.50');
        // Not in the future (the organization's today), and only a date.
        $this->getJson('/api/v1/inventory/valuation?as_of=2026-11-21')->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['as_of']]]);
        $this->getJson('/api/v1/inventory/valuation?as_of=31-10-2026')->assertStatus(422);
    }

    public function test_the_day_ends_at_midnight_in_the_organizations_timezone(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $juice = $this->stockedVariant($org);
        $store = $this->mainStoreId($org);
        $this->actingAsUser($admin);

        $this->at('2026-10-31 23:59'); // 17:59 UTC
        $this->adjust($store, 'opening', ['variant_id' => $juice->id, 'quantity' => '2', 'unit_cost' => '10']);
        $this->at('2026-11-01 00:01'); // still 31 Oct in UTC (18:01)
        $this->adjust($store, 'correction', ['variant_id' => $juice->id, 'quantity' => '3', 'unit_cost' => '10']);

        $this->at('2026-11-02 09:00');
        $this->getJson('/api/v1/inventory/valuation?as_of=2026-10-31')->assertJsonPath('data.total', '20.00');
        $this->getJson('/api/v1/inventory/valuation?as_of=2026-11-01')->assertJsonPath('data.total', '50.00');
    }

    public function test_branch_scope_and_export(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $main] = $this->provisionTenant();
        $north = $this->createBranch($org, 'NORTH');
        $juice = $this->stockedVariant($org);
        $mainStore = $this->mainStoreId($org);
        $northStore = $north->stores()->firstOrFail()->id;
        $this->actingAsUser($admin);
        $this->at('2026-10-20 10:00');
        $this->adjust($mainStore, 'opening', ['variant_id' => $juice->id, 'quantity' => '4', 'unit_cost' => '10']);
        $this->adjust($northStore, 'opening', ['variant_id' => $juice->id, 'quantity' => '1', 'unit_cost' => '7']);
        $this->at('2026-11-03 10:00');
        $this->adjust($northStore, 'correction', ['variant_id' => $juice->id, 'quantity' => '1', 'unit_cost' => '7']);

        $this->getJson('/api/v1/inventory/valuation?as_of=2026-10-31')->assertJsonPath('data.total', '47.00')->assertJsonCount(2, 'data.stores');
        $this->getJson("/api/v1/inventory/valuation?as_of=2026-10-31&branch_id={$north->id}")->assertJsonPath('data.total', '7.00');

        // A manager of NORTH sees NORTH only, and cannot ask for another branch.
        $manager = $this->createUserWithRole($org, SystemRole::BranchManager, [$north->id]);
        $this->actingAsUser($manager);
        $this->getJson('/api/v1/inventory/valuation?as_of=2026-10-31')->assertJsonPath('data.total', '7.00')->assertJsonCount(1, 'data.stores');
        $this->getJson("/api/v1/inventory/valuation?as_of=2026-10-31&branch_id={$main->id}")->assertNotFound();

        // Another organization's ledger never counts.
        ['admin' => $rival] = $this->provisionTenant('Rival');
        $this->actingAsUser($rival)->getJson('/api/v1/inventory/valuation?as_of=2026-10-31')->assertJsonPath('data.total', '0.00');

        $this->actingAsUser($admin);
        // The export keeps the date: its total row is the month-end value (54.00 today).
        $total = fn (string $query) => (float) collect($this->xlsxRows($this->get("/api/v1/inventory/valuation?{$query}export=xlsx")->assertOk()))
            ->first(fn (array $row) => in_array('Total', $row, true))[3];
        $this->assertSame(47.0, $total('as_of=2026-10-31&'));
        $this->assertSame(54.0, $total(''));
    }

    public function test_the_backfill_replays_every_level_to_its_stored_average(): void
    {
        ['organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $north = $this->createBranch($org, 'NORTH');
        $juice = $this->stockedVariant($org);
        $pills = $this->stockedVariant($org, 'Pills', ['track_batches' => true]);
        $main = $this->mainStoreId($org);
        $northStore = $north->stores()->firstOrFail()->id;
        DB::table('branches')->where('id', $branch->id)->update(['allow_negative_stock' => true]);

        $post = fn (array $changes) => $this->inTenant($org, fn () => DB::transaction(fn () => app(StockLedger::class)->post($changes, new StockReference('test', (string) Str::uuid7()))));
        $in = fn (string $store, string $variant, string $qty, string $cost, MovementType $type = MovementType::PurchaseReceipt, ?string $batch = null) => new StockChange($store, $variant, $batch, $type, $qty, $cost);
        $out = fn (string $store, string $variant, string $qty, MovementType $type = MovementType::Sale) => new StockChange($store, $variant, null, $type, $qty);
        [$b1, $b2] = $this->inTenant($org, fn () => [
            app(ResolveBatch::class)($pills->id, 'B-1', '2030-01-31')->id,
            app(ResolveBatch::class)($pills->id, 'B-2', '2030-06-30')->id,
        ]);

        $post([$in($main, $juice->id, '10', '10')]);
        $post([$in($main, $juice->id, '5', '16')]);                       // avg 12
        $post([$out($main, $juice->id, '4')]);                            // 11 left
        $this->inTenant($org, fn () => DB::transaction(fn () => app(StockValuation::class)->revalue(
            [new StockRevaluation($main, $juice->id, null, '22.00')], new StockReference('landed_cost_voucher', (string) Str::uuid7()),
        )));                                                               // avg 14
        $post([$out($main, $juice->id, '3', MovementType::TransferOut)]);
        $post([$in($northStore, $juice->id, '3', '14', MovementType::TransferIn)]);
        $post([$out($main, $juice->id, '10')]);                           // -2 (negative allowed)
        $post([$in($main, $juice->id, '5', '9'), $in($main, $juice->id, '1', '15')]); // from negative: 9, then (3×9+15)/4
        $post([$in($main, $pills->id, '4', '2', batch: $b1), $in($main, $pills->id, '6', '3', batch: $b2)]);
        $post([new StockChange($main, $pills->id, null, MovementType::Sale, '5', allocateBatches: true)]);
        $post([$in($main, $pills->id, '2', '5', MovementType::SaleReturn, $b1)]);

        $written = DB::table('stock_movements')->orderBy('created_at')->orderBy('id')->pluck('average_cost_after', 'id')->all();
        $this->assertNotContains(null, $written);
        $this->assertSame('10.5000', DB::table('stock_levels')->where('store_id', $main)->where('variant_id', $juice->id)->value('average_cost'));

        DB::statement('ALTER TABLE stock_movements DISABLE TRIGGER stock_movements_append_only');
        DB::table('stock_movements')->update(['average_cost_after' => null]);
        DB::statement('ALTER TABLE stock_movements ENABLE TRIGGER stock_movements_append_only');

        $this->assertSame(0, app(AverageCostReplay::class)->run());
        $this->assertSame($written, DB::table('stock_movements')->orderBy('created_at')->orderBy('id')->pluck('average_cost_after', 'id')->all());

        // The self-check counts a level whose stored average the ledger does not explain.
        DB::table('stock_levels')->where('store_id', $northStore)->update(['average_cost' => '13.0000']);
        $this->assertSame(1, app(AverageCostReplay::class)->run());
        // The append-only guard is back on.
        $this->expectExceptionMessage('append-only');
        DB::table('stock_movements')->limit(1)->update(['average_cost_after' => '1']);
    }
}
