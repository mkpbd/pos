<?php

namespace App\Modules\Inventory\Tests\Feature;

use App\Modules\Imports\Tests\Concerns\UploadsImports;
use App\Modules\Inventory\Infrastructure\Models\StockAdjustment;
use App\Modules\Inventory\Infrastructure\Models\StockMovement;
use App\Modules\Inventory\Tests\Concerns\InteractsWithStock;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use DateTimeImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * ST1: opening stock import — one `opening` adjustment per store, batches, valuation.
 */
class OpeningStockImportTest extends TestCase
{
    use InteractsWithStock, InteractsWithTenancy, RefreshDatabase, UploadsImports;

    private const HEADER = ['sku_or_barcode', 'store', 'quantity', 'unit_cost', 'batch_number', 'expires_on'];

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
    }

    public function test_posts_one_opening_adjustment_per_store_with_batches_and_cost(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $juice = $this->stockedVariant($org, 'Juice');
        $tea = $this->stockedVariant($org, 'Tea');
        $pills = $this->stockedVariant($org, 'Paracetamol', ['track_batches' => true]);
        $main = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $warehouse = $this->postJson("/api/v1/branches/{$branch->id}/stores", ['code' => 'WH', 'name' => 'Warehouse', 'type' => 'warehouse'])->assertCreated()->json('data.id');

        // XLSX: a number cell for quantities and an Excel date cell / serial number for expiry.
        $import = $this->importNow('opening_stock', $this->xlsxFile([
            self::HEADER,
            [$juice->sku, 'MAIN', 10, '12.50', null, null],
            [$tea->sku, 'Main Store', 4, null, null, null],
            [$pills->sku, 'main', 30, 2, 'B-1', new DateTimeImmutable('2027-06-30')],
            [$pills->sku, 'MAIN', 5, 2, 'B-2', 46752],
            [$juice->sku, 'wh', '1,000', 11, null, null],
        ]));
        $this->assertSame([5, 0, 0], [$import['created'], $import['failed_rows'], $import['rows_error']]);

        $adjustments = StockAdjustment::query()->with('lines')->orderBy('number')->get();
        $this->assertCount(2, $adjustments);
        $this->assertSame(['opening', 'opening'], $adjustments->pluck('reason')->map(fn ($r) => $r instanceof \BackedEnum ? $r->value : $r)->all());
        $this->assertEqualsCanonicalizing([$main, $warehouse], $adjustments->pluck('store_id')->all());
        $this->assertSame(4, $adjustments->firstWhere('store_id', $main)->lines->count());

        $this->assertSame('10.000', $this->stockRow($juice->id, $main)['quantity']);
        $this->assertSame('1000.000', $this->stockRow($juice->id, $warehouse)['quantity']);
        $this->assertSame('35.000', $this->stockRow($pills->id, $main)['quantity']);
        // Valued like a receipt: the given cost, else the product's purchase price (10.00).
        $this->assertSame(['12.5000', '10.0000'], [
            StockMovement::query()->where('variant_id', $juice->id)->where('store_id', $main)->value('unit_cost'),
            StockMovement::query()->where('variant_id', $tea->id)->value('unit_cost'),
        ]);
        $this->assertSame(['opening'], StockMovement::query()->where('variant_id', $tea->id)->pluck('type')->map(fn ($t) => $t instanceof \BackedEnum ? $t->value : $t)->all());
        $batches = collect($this->getJson('/api/v1/inventory/batches')->json('data'))->pluck('batch.expires_on', 'batch.batch_number');
        $this->assertSame('2027-06-30', substr((string) $batches['B-1'], 0, 10));
        $this->assertSame('2027-12-31', substr((string) $batches['B-2'], 0, 10));
    }

    public function test_row_errors_and_lines_refused_at_run_time(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        ['organization' => $other] = $this->provisionTenant('Other Shop');
        $juice = $this->stockedVariant($org, 'Juice');
        $rice = $this->stockedVariant($org, 'Rice', decimalUnit: true);
        $pills = $this->stockedVariant($org, 'Paracetamol', ['track_batches' => true]);
        $foreign = $this->stockedVariant($other, 'Foreign', ['variants' => [['sku' => 'FOREIGN-1', 'purchase_price' => '1', 'selling_price' => '2']]]);
        $this->actingAsUser($admin);
        $this->adjust($this->mainStoreId($org), 'opening', ['variant_id' => $pills->id, 'quantity' => '1', 'batch_number' => 'B-1', 'expires_on' => '2027-01-31']);

        $response = $this->upload('opening_stock', $this->csvFile([
            self::HEADER,
            [$juice->sku, 'MAIN', '2.5', '', '', ''],          // whole units only
            [$rice->sku, 'MAIN', '2.5', '', '', ''],           // fine
            [$pills->sku, 'MAIN', '3', '', '', ''],            // batch needed
            [$pills->sku, 'MAIN', '3', '', 'b-1', '2027-02-01'], // expiry mismatch
            [$foreign->sku, 'MAIN', '3', '', '', ''],          // another organization's SKU
            [$juice->sku, 'NOWHERE', '3', '', '', ''],         // unknown store
            [$juice->sku, 'MAIN', '0', '', '', ''],            // not above zero
            [$rice->sku, 'main', '1', '', '', ''],             // duplicate of row 3
            [$juice->sku, 'MAIN', '4', '', '', '2027-13-01'],  // bad date
        ]))->assertCreated();
        $columns = collect($response->json('data.errors'))->groupBy('row')->map(fn ($errors) => $errors[0]['column'])->all();
        $this->assertSame([2 => 'quantity', 4 => 'batch_number', 5 => 'expires_on', 6 => 'sku_or_barcode', 7 => 'store', 8 => 'quantity', 9 => null, 10 => 'expires_on'], $columns);
        $this->assertSame(1, $response->json('data.rows_valid'));

        // Users without inventory.adjust may not import opening stock.
        $this->actingAsUser($this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]));
        $this->upload('opening_stock', $this->csvFile([self::HEADER, [$juice->sku, 'MAIN', '1', '', '', '']]))->assertForbidden();
    }

    public function test_serial_numbered_rows_list_their_serials(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $phoneA = $this->stockedVariant($org, 'Phone A', ['track_serials' => true]);
        $phoneB = $this->stockedVariant($org, 'Phone B', ['track_serials' => true]);
        $phoneC = $this->stockedVariant($org, 'Phone C', ['track_serials' => true]);
        $phoneD = $this->stockedVariant($org, 'Phone D', ['track_serials' => true]);
        $juice = $this->stockedVariant($org, 'Juice');
        $main = $this->mainStoreId($org);
        $this->actingAsUser($admin);
        $this->adjust($main, 'opening', ['variant_id' => $phoneD->id, 'quantity' => '1', 'unit_cost' => '100', 'serials' => ['D-1']]);

        $header = [...self::HEADER, 'serials'];
        $import = $this->importNow('opening_stock', $this->csvFile([
            $header,
            [$phoneA->sku, 'MAIN', '2', '', '', '', 'A-1, A-2'], // fine
            [$phoneB->sku, 'MAIN', '2', '', '', '', ''],         // serials needed
            [$phoneC->sku, 'MAIN', '2', '', '', '', 'C-1'],      // one per unit
            [$juice->sku, 'MAIN', '1', '', '', '', 'J-1'],       // not serial-numbered
            [$phoneD->sku, 'MAIN', '1', '', '', '', 'd-1'],      // already in stock (refused at run time)
        ]));
        $this->assertSame([1, 1, 3], [$import['created'], $import['failed_rows'], $import['rows_error']]);
        $columns = collect($import['errors'])->groupBy('row')->map(fn ($errors) => $errors[0]['column'])->all();
        $this->assertSame([3 => 'serials', 4 => 'serials', 5 => 'serials', 6 => 'serials'], $columns);

        $this->getJson("/api/v1/inventory/stores/{$main}/serials?variant_id={$phoneA->id}")->assertJsonPath('data.*.serial', ['A-1', 'A-2']);
        $this->assertSame('2.000', $this->stockRow($phoneA->id, $main)['quantity']);
        $this->assertSame('1.000', $this->stockRow($phoneD->id, $main)['quantity']);
    }
}
