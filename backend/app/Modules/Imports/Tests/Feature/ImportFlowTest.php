<?php

namespace App\Modules\Imports\Tests\Feature;

use App\Modules\Imports\Infrastructure\Models\Import;
use App\Modules\Imports\Tests\Concerns\UploadsImports;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Suppliers\Infrastructure\Models\Supplier;
use App\Modules\System\Application\Actions\PruneRecords;
use App\Modules\Users\Domain\Roles\SystemRole;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use OpenSpout\Reader\XLSX\Reader;
use Tests\TestCase;

/**
 * ST1: the import pipeline (upload, header check, dry run, run, errors file, cancel, retention),
 * exercised with the supplier type.
 */
class ImportFlowTest extends TestCase
{
    use InteractsWithTenancy, RefreshDatabase, UploadsImports;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
    }

    public function test_types_follow_the_users_permissions(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        $this->actingAsUser($admin);
        $types = collect($this->getJson('/api/v1/imports/types')->assertOk()->json('data'));
        $this->assertSame(['products', 'price_update', 'suppliers', 'customers', 'opening_stock'], $types->pluck('type')->all());
        $products = $types->firstWhere('type', 'products');
        $this->assertSame('products.manage', $products['permission']);
        $this->assertSame(20000, $products['max_rows']);
        $this->assertSame(['key', 'label', 'required', 'example', 'help', 'type'], array_keys($products['columns'][0]));

        $this->actingAsUser($this->createUserWithRole($org, SystemRole::Cashier, [$branch->id]));
        $this->getJson('/api/v1/imports/types')->assertOk()->assertJsonCount(0, 'data');
        $this->getJson('/api/v1/imports/templates/suppliers')->assertForbidden();
        $this->upload('suppliers', $this->csvFile([['name'], ['X']]))->assertForbidden();

        $this->actingAsUser($this->createUserWithRole($org, SystemRole::InventoryManager, [$branch->id]));
        $this->assertEqualsCanonicalizing(['products', 'price_update', 'suppliers', 'opening_stock'], array_column($this->getJson('/api/v1/imports/types')->json('data'), 'type'));
    }

    public function test_templates_have_the_keys_an_example_and_a_help_sheet(): void
    {
        ['admin' => $admin] = $this->provisionTenant();
        $this->actingAsUser($admin);

        $csv = $this->get('/api/v1/imports/templates/suppliers?format=csv')->assertOk();
        $this->assertStringContainsString('text/csv', $csv->headers->get('Content-Type'));
        $lines = preg_split('/\r?\n/', trim(str_replace("\u{FEFF}", '', $csv->streamedContent())));
        $this->assertStringStartsWith('name,contact_person,phone,email', $lines[0]);
        $this->assertStringContainsString('Pran Foods Ltd', $lines[1]);

        $xlsx = $this->get('/api/v1/imports/templates/products')->assertOk();
        $path = tempnam(sys_get_temp_dir(), 'tpl').'.xlsx';
        file_put_contents($path, $xlsx->streamedContent() ?: file_get_contents($xlsx->baseResponse->getFile()->getPathname()));
        $reader = new Reader;
        $reader->open($path);
        $sheets = [];
        foreach ($reader->getSheetIterator() as $sheet) {
            $rows = [];
            foreach ($sheet->getRowIterator() as $row) {
                $rows[] = $row->toArray();
            }
            $sheets[$sheet->getName()] = $rows;
        }
        $reader->close();
        $this->assertSame(['Products', 'Help'], array_keys($sheets));
        $this->assertSame('name', $sheets['Products'][0][0]);
        $this->assertSame('Mango Juice 250ml', $sheets['Products'][1][0]);
        $this->assertSame(['Column', 'Meaning', 'Required', 'Example', 'Help'], $sheets['Help'][0]);

        $this->getJson('/api/v1/imports/templates/nope')->assertStatus(422);
    }

    public function test_bad_headers_too_many_rows_and_empty_files_are_refused_at_upload(): void
    {
        ['admin' => $admin] = $this->provisionTenant();
        $this->actingAsUser($admin);

        $this->upload('suppliers', $this->csvFile([['Phone', 'colour'], ['0171', 'red']]))
            ->assertStatus(422)
            ->assertJsonPath('error.code', 'IMPORT_BAD_HEADERS')
            ->assertJsonPath('error.details.missing', ['name'])
            ->assertJsonPath('error.details.unknown', ['colour']);

        $rows = [['name']];
        for ($i = 1; $i <= 20001; $i++) {
            $rows[] = ["Supplier {$i}"];
        }
        $this->upload('suppliers', $this->csvFile($rows))->assertStatus(422)->assertJsonPath('error.code', 'IMPORT_TOO_MANY_ROWS');
        $this->upload('suppliers', $this->csvFile([['name'], [''], ['']]))->assertStatus(422)->assertJsonPath('error.code', 'IMPORT_EMPTY');
        $this->upload('suppliers', $this->csvFile([['name']], name: 'x.txt'))->assertStatus(422)->assertJsonStructure(['error' => ['details' => ['file']]]);
        $this->upload('suppliers', UploadedFile::fake()->createWithContent('broken.xlsx', 'this is not a zip file'))->assertStatus(422)->assertJsonPath('error.code', 'IMPORT_BAD_FILE');
        $this->assertSame(0, Import::query()->withoutGlobalScopes()->count());
    }

    public function test_dry_run_run_errors_file_and_run_twice(): void
    {
        ['admin' => $admin] = $this->provisionTenant();
        $this->actingAsUser($admin);

        // Labels as headers, any case; ";" separated with a BOM; a blank row is ignored.
        $file = $this->csvFile([
            ['Supplier Name', 'PHONE', 'payment terms (days)', 'Opening balance'],
            ['Pran Foods', '01711-000001', '30', '1,234.50'],
            ['', '', '', ''],
            ['Square Toiletries', '01711000002', 'thirty', ''],
            ['pran foods', '01711000001', '15', ''],
        ], ';');
        $response = $this->upload('suppliers', $file)->assertCreated()
            ->assertJsonPath('data.type', 'suppliers')
            ->assertJsonPath('data.status', 'validated')
            ->assertJsonPath('data.file_name', 'import.csv')
            ->assertJsonPath('data.rows_total', 3)
            ->assertJsonPath('data.rows_valid', 1)
            ->assertJsonPath('data.rows_error', 2)
            ->assertJsonPath('data.to_create', 1)
            ->assertJsonPath('data.errors_truncated', false)
            ->assertJsonPath('data.created_by.id', $admin->id)
            ->assertJsonPath('data.options.update_existing', true);
        $id = $response->json('data.id');
        $errors = $response->json('data.errors');
        $this->assertSame([4, 'payment_terms', 'Enter a whole number.'], [$errors[0]['row'], $errors[0]['column'], $errors[0]['message']]);
        $this->assertSame(5, $errors[1]['row']);
        $this->assertStringContainsString('row 2', $errors[1]['message']);
        Storage::disk('local')->assertExists(Import::query()->findOrFail($id)->filePath());

        $csv = $this->get("/api/v1/imports/{$id}/errors.csv")->assertOk()->streamedContent();
        $this->assertStringContainsString('row,column,error,name,contact_person,phone', $csv);
        $this->assertStringContainsString('4,payment_terms,Enter a whole number.,Square Toiletries,,01711000002', $csv);

        $this->postJson("/api/v1/imports/{$id}/run")->assertOk()
            ->assertJsonPath('data.status', 'completed')
            ->assertJsonPath('data.created', 1)
            ->assertJsonPath('data.failed_rows', 0);
        $this->assertSame('1234.50', Supplier::query()->where('name', 'Pran Foods')->firstOrFail()->opening_balance);
        $this->postJson("/api/v1/imports/{$id}/run")->assertStatus(409)->assertJsonPath('error.code', 'IMPORT_NOT_READY');
        $this->postJson("/api/v1/imports/{$id}/cancel")->assertStatus(409)->assertJsonPath('error.code', 'IMPORT_NOT_CANCELLABLE');
        $this->assertDatabaseHas('audit_logs', ['action' => 'import.started', 'subject_id' => $id]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'import.completed', 'subject_id' => $id]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'supplier.created']);

        $this->getJson('/api/v1/imports?type=suppliers&status=completed')->assertOk()
            ->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $id)->assertJsonMissingPath('data.0.errors');
    }

    public function test_update_existing_off_skips_known_records_and_cancel(): void
    {
        ['admin' => $admin] = $this->provisionTenant();
        $this->actingAsUser($admin);
        $this->importNow('suppliers', $this->csvFile([['name', 'phone', 'notes'], ['Pran', '0171', 'first']]));

        $import = $this->importNow('suppliers', $this->csvFile([['name', 'phone', 'notes'], ['PRAN', '0171', 'second'], ['ACI', '', '']]), ['update_existing' => '0']);
        $this->assertSame([1, 0, 1], [$import['created'], $import['updated'], $import['skipped']]);
        $this->assertSame('first', Supplier::query()->where('name', 'Pran')->value('notes'));

        $import = $this->importNow('suppliers', $this->csvFile([['name', 'phone', 'notes'], ['PRAN', '0171', 'second']]));
        $this->assertSame(1, $import['updated']);
        $this->assertSame('second', Supplier::query()->where('phone', '0171')->value('notes'));
        $this->assertSame('PRAN', Supplier::query()->where('phone', '0171')->value('name'));

        $id = $this->upload('suppliers', $this->csvFile([['name'], ['Later']]))->json('data.id');
        $this->postJson("/api/v1/imports/{$id}/cancel")->assertOk()->assertJsonPath('data.status', 'cancelled');
        $this->postJson("/api/v1/imports/{$id}/run")->assertStatus(409);
        $this->assertFalse(Supplier::query()->where('name', 'Later')->exists());

        // A file with only errors cannot run.
        $id = $this->upload('suppliers', $this->csvFile([['name', 'email'], ['Bad', 'not-an-email']]))->assertJsonPath('data.rows_valid', 0)->json('data.id');
        $this->postJson("/api/v1/imports/{$id}/run")->assertStatus(409)->assertJsonPath('error.code', 'IMPORT_NOT_READY');
    }

    public function test_a_row_failing_at_run_time_is_recorded_and_the_rest_continue(): void
    {
        ['admin' => $admin] = $this->provisionTenant();
        $this->actingAsUser($admin);
        config(['pos.imports.chunk_size' => 2]);

        $id = $this->upload('suppliers', $this->csvFile([
            ['name', 'code'], ['A', 'S-A'], ['B', 'S-B'], ['C', 'S-C'], ['D', 'S-D'], ['E', 'S-E'],
        ]))->assertJsonPath('data.to_create', 5)->json('data.id');

        // Someone takes code S-C between the dry run and the run.
        $this->postJson('/api/v1/suppliers', ['name' => 'Other', 'code' => 'S-C'])->assertCreated();

        $this->postJson("/api/v1/imports/{$id}/run")->assertOk()
            ->assertJsonPath('data.status', 'completed')
            ->assertJsonPath('data.created', 4)
            ->assertJsonPath('data.failed_rows', 1)
            ->assertJsonPath('data.errors.0.row', 4)
            ->assertJsonPath('data.errors.0.column', 'code');
        $this->assertEqualsCanonicalizing(['A', 'B', 'D', 'E', 'Other'], Supplier::query()->pluck('name')->all());
    }

    public function test_imports_are_tenant_scoped(): void
    {
        ['admin' => $admin] = $this->provisionTenant();
        ['admin' => $other] = $this->provisionTenant('Other Shop');
        $this->actingAsUser($admin);
        $id = $this->upload('suppliers', $this->csvFile([['name'], ['Mine']]))->json('data.id');

        $this->actingAsUser($other);
        $this->getJson("/api/v1/imports/{$id}")->assertNotFound();
        $this->postJson("/api/v1/imports/{$id}/run")->assertNotFound();
        $this->get("/api/v1/imports/{$id}/errors.csv")->assertNotFound();
        $this->getJson('/api/v1/imports')->assertOk()->assertJsonCount(0, 'data');
    }

    public function test_retention_deletes_old_files_of_finished_imports(): void
    {
        ['admin' => $admin] = $this->provisionTenant();
        $this->actingAsUser($admin);
        $old = $this->importNow('suppliers', $this->csvFile([['name'], ['Old']]));
        $open = $this->upload('suppliers', $this->csvFile([['name'], ['Open']]))->json('data.id');
        DB::table('imports')->where('id', $old['id'])->update(['finished_at' => now()->subDays(31)]);
        config(['pos.retention.import_files' => 30]);

        $this->assertSame(1, app(PruneRecords::class)(dryRun: true)['import_files']);
        $this->assertSame(1, app(PruneRecords::class)()['import_files']);
        Storage::disk('local')->assertMissing(Import::query()->findOrFail($old['id'])->filePath());
        Storage::disk('local')->assertExists(Import::query()->findOrFail($open)->filePath());
        $this->assertNotNull(Import::query()->findOrFail($old['id'])->file_deleted_at);

        config(['pos.retention.import_files' => null]);
        $this->assertArrayNotHasKey('import_files', app(PruneRecords::class)());
    }
}
