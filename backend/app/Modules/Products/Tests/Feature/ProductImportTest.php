<?php

namespace App\Modules\Products\Tests\Feature;

use App\Modules\Catalog\Infrastructure\Models\Brand;
use App\Modules\Catalog\Infrastructure\Models\Category;
use App\Modules\Catalog\Infrastructure\Models\TaxRate;
use App\Modules\Catalog\Infrastructure\Models\Unit;
use App\Modules\Imports\Tests\Concerns\UploadsImports;
use App\Modules\Organizations\Infrastructure\Models\Organization;
use App\Modules\Products\Application\Actions\SaveProduct;
use App\Modules\Products\Application\DTOs\ProductData;
use App\Modules\Products\Infrastructure\Models\Product;
use App\Modules\Products\Infrastructure\Models\ProductVariant;
use App\Modules\Shared\Tests\Concerns\InteractsWithTenancy;
use App\Modules\Users\Domain\Roles\SystemRole;
use App\Modules\Users\Infrastructure\Models\Role;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * ST1: product and price-update imports.
 */
class ProductImportTest extends TestCase
{
    use InteractsWithTenancy, RefreshDatabase, UploadsImports;

    private const HEADER = ['name', 'sku', 'barcode', 'parent_sku', 'variant_attributes', 'category', 'brand', 'unit', 'cost_price', 'selling_price', 'wholesale_price', 'tax', 'track_stock', 'is_active', 'description'];

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
    }

    private function catalog(Organization $org): void
    {
        $this->inTenant($org, function () {
            Unit::query()->create(['name' => 'Piece', 'code' => 'pcs']);
            TaxRate::query()->create(['name' => 'VAT 15%', 'rate' => '15']);
            Category::query()->create(['name' => 'Drinks']);
        });
    }

    public function test_creates_products_variants_categories_and_brands_from_xlsx(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $this->catalog($org);
        $this->actingAsUser($admin);

        $import = $this->importNow('products', $this->xlsxFile([
            self::HEADER,
            ['Mango Juice 250ml', 'JUICE-250', '4006381333931', null, null, 'Drinks > Juice', 'Pran', 'pcs', 18.5, 25, null, 'VAT 15%', 'yes', 'yes', 'Fresh'],
            ['T-Shirt', 'TS-M-RED', null, 'TS', 'Size=M; Color=Red', 'Clothing', null, 'Piece', null, '450.00', '400', '15', 'yes', null, null],
            ['T-Shirt', 'TS-L-RED', null, 'TS', 'Size=L; Color=Red', null, null, null, null, '470', null, null, null, null, null],
            ['T-Shirt', 'TS-M-BLUE', null, 'TS', 'Color=Blue; Size=M', null, null, null, null, '450', null, null, null, null, null],
        ]));

        $this->assertSame([4, 0, 0, 0], [$import['created'], $import['updated'], $import['skipped'], $import['failed_rows']]);
        $juice = Product::query()->where('name', 'Mango Juice 250ml')->firstOrFail();
        $variant = $juice->variants()->with('barcodes')->firstOrFail();
        $this->assertSame(['JUICE-250', '18.50', '25.00', ['4006381333931']], [$variant->sku, $variant->purchase_price, $variant->selling_price, $variant->barcodes->pluck('barcode')->all()]);
        $juiceCategory = Category::query()->findOrFail($juice->category_id);
        $this->assertSame('Juice', $juiceCategory->name);
        $this->assertSame('Drinks', Category::query()->findOrFail($juiceCategory->parent_id)->name);
        $this->assertSame('Pran', Brand::query()->findOrFail($juice->brand_id)->name);
        $this->assertNotNull($juice->tax_rate_id);

        $shirt = Product::query()->where('name', 'T-Shirt')->firstOrFail();
        $this->assertSame([['name' => 'Size', 'values' => ['M', 'L']], ['name' => 'Color', 'values' => ['Red', 'Blue']]], $shirt->options);
        $this->assertSame(['TS-M-RED', 'TS-L-RED', 'TS-M-BLUE'], $shirt->variants()->pluck('sku')->all());
        $this->assertSame(['Size' => 'M', 'Color' => 'Blue'], $shirt->variants()->where('sku', 'TS-M-BLUE')->firstOrFail()->option_values);
        $this->assertSame('400.00', $shirt->variants()->where('sku', 'TS-M-RED')->firstOrFail()->wholesale_price);
        $this->assertDatabaseHas('audit_logs', ['action' => 'product.created', 'subject_id' => $shirt->id]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'category.created']);
    }

    public function test_updates_by_sku_or_barcode_and_adds_variants_leaving_blanks_unchanged(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $this->catalog($org);
        $this->actingAsUser($admin);
        $this->importNow('products', $this->csvFile([
            self::HEADER,
            ['Juice', 'J-1', '4006381333931', '', '', '', '', 'pcs', '10', '15', '', '', '', '', 'Old text'],
            ['Shirt', 'S-M', '', 'S', 'Size=M', '', '', 'pcs', '100', '150', '', '', '', '', ''],
        ]));

        $import = $this->importNow('products', $this->csvFile([
            self::HEADER,
            // By barcode (no SKU): only the selling price changes.
            ['Juice', '', '4006381333931', '', '', '', '', '', '', '16.50', '', '', '', '', ''],
            // A new size of the existing shirt, and the existing one renamed.
            ['Shirt (cotton)', 'S-L', '', 'S', 'Size=L', '', '', '', '', '170', '', '', '', '', ''],
            ['Shirt (cotton)', 's-m', '', 'S', 'Size=M', '', '', '', '', '', '', '', '', '', ''],
        ]));
        $this->assertSame([1, 2], [$import['created'], $import['updated']]);

        $juice = ProductVariant::query()->where('sku', 'J-1')->with('product')->firstOrFail();
        $this->assertSame(['10.00', '16.50', 'Old text'], [$juice->purchase_price, $juice->selling_price, $juice->product->description]);
        $shirt = Product::query()->where('name', 'Shirt (cotton)')->firstOrFail();
        $this->assertSame([['name' => 'Size', 'values' => ['M', 'L']]], $shirt->options);
        $this->assertSame(['S-M' => '150.00', 'S-L' => '170.00'], $shirt->variants()->pluck('selling_price', 'sku')->all());
    }

    public function test_row_errors_duplicates_and_permissions(): void
    {
        ['admin' => $admin, 'organization' => $org, 'branch' => $branch] = $this->provisionTenant();
        ['organization' => $other] = $this->provisionTenant('Other Shop');
        $this->catalog($org);
        $this->catalog($other);
        $this->inTenant($other, fn () => app(SaveProduct::class)(null, ProductData::fromArray([
            'name' => 'Foreign', 'type' => 'standard', 'unit_id' => Unit::query()->value('id'),
            'variants' => [['sku' => 'FOREIGN-1', 'purchase_price' => '1', 'selling_price' => '2', 'barcodes' => ['96385074']]],
        ])));
        $this->actingAsUser($admin);

        $response = $this->upload('products', $this->csvFile([
            self::HEADER,
            ['A', 'A-1', '4006381333932', '', '', '', '', 'pcs', '', '10', '', '', '', '', ''],      // bad check digit
            ['B', 'B-1', '', '', '', '', '', 'box', '', '10', '', '', '', '', ''],                    // unknown unit
            ['C', 'C-1', '', '', '', '', '', 'pcs', '', '', '', 'GST', '', '', ''],                   // no price, unknown tax
            ['D', 'a-1', '', '', '', '', '', 'pcs', '', '10', '', '', '', '', ''],                    // duplicate SKU
            ['E', 'E 1', '', '', '', '', '', 'pcs', '-5', 'x', '', '', 'maybe', '', ''],               // bad cells
            ['F', 'FOREIGN-1', '96385074', '', '', '', '', 'pcs', '', '10', '', '', '', '', ''],      // other org: a new product
            ['G', 'G-1', '', 'G', 'Size=S', '', '', 'pcs', '', '10', '', '', '', '', ''],
            ['G', 'G-2', '', 'G', 'Colour=Red', '', '', 'pcs', '', '10', '', '', '', '', ''],         // other options
        ]))->assertCreated();
        $byRow = collect($response->json('data.errors'))->groupBy('row');
        $this->assertSame(['barcode'], $byRow[2]->pluck('column')->all());
        $this->assertSame(['unit'], $byRow[3]->pluck('column')->all());
        $this->assertEqualsCanonicalizing(['tax', 'selling_price'], $byRow[4]->pluck('column')->all());
        $this->assertStringContainsString('row 2', $byRow[5][0]['message']);
        $this->assertEqualsCanonicalizing(['selling_price', 'track_stock'], $byRow[6]->pluck('column')->all());
        $this->assertFalse($byRow->has(7), 'a SKU of another organization is not matched');
        $this->assertSame(['variant_attributes'], $byRow[9]->pluck('column')->all());
        $this->assertSame(['to_create' => 2, 'rows_error' => 6], ['to_create' => $response->json('data.to_create'), 'rows_error' => $response->json('data.rows_error')]);

        // products.manage without categories.manage / brands.manage / cost prices.
        $role = $this->inTenant($org, function () {
            $role = Role::query()->create(['name' => 'Product clerk']);
            $role->permissions()->sync(['products.view', 'products.manage']);

            return $role;
        });
        $this->actingAsUser($this->createUserWithRole($org, $role, [$branch->id]));
        $errors = collect($this->upload('products', $this->csvFile([
            self::HEADER,
            ['H', 'H-1', '', '', '', 'Drinks', 'Pran', 'pcs', '5', '10', '', '', '', '', ''],
            ['I', 'I-1', '', '', '', 'Snacks', 'Pran', 'pcs', '', '10', '', '', '', '', ''],
        ]))->assertCreated()->json('data.errors'));
        $this->assertEqualsCanonicalizing([[2, 'brand'], [2, 'cost_price'], [3, 'category'], [3, 'brand']], $errors->map(fn ($e) => [$e['row'], $e['column']])->all());

        $this->actingAsUser($this->createUserWithRole($org, SystemRole::Accountant, [$branch->id]));
        $this->upload('products', $this->csvFile([self::HEADER]))->assertForbidden();
    }

    public function test_price_update_changes_only_filled_prices(): void
    {
        ['admin' => $admin, 'organization' => $org] = $this->provisionTenant();
        $this->catalog($org);
        $this->actingAsUser($admin);
        $this->importNow('products', $this->csvFile([
            self::HEADER,
            ['Juice', 'J-1', '4006381333931', '', '', '', '', 'pcs', '10', '15', '14', '', '', '', ''],
            ['Tea', 'T-1', '', '', '', '', '', 'pcs', '20', '30', '', '', '', '', ''],
        ]));

        $import = $this->importNow('price_update', $this->csvFile([
            ['sku_or_barcode', 'selling_price', 'cost_price', 'wholesale_price'],
            ['4006381333931', '16', '', ''],
            ['t-1', '30.00', '', ''],
            ['NOPE', '1', '', ''],
        ]));
        $this->assertSame([1, 1, 0], [$import['updated'], $import['skipped'], $import['created']]);
        $this->assertSame(1, $import['rows_error']);

        $juice = ProductVariant::query()->where('sku', 'J-1')->firstOrFail();
        $this->assertSame(['10.00', '16.00', '14.00'], [$juice->purchase_price, $juice->selling_price, $juice->wholesale_price]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'product.updated', 'subject_id' => $juice->product_id]);
    }
}
