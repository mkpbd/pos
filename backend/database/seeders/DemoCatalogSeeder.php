<?php

namespace Database\Seeders;

use App\Modules\Catalog\Application\Actions\SaveCatalogRecord;
use App\Modules\Catalog\Application\Actions\SaveCategory;
use App\Modules\Catalog\Application\Actions\SaveUnit;
use App\Modules\Catalog\Infrastructure\Models\Brand;
use App\Modules\Catalog\Infrastructure\Models\TaxRate;
use App\Modules\Customers\Application\Actions\SaveCustomer;
use App\Modules\Customers\Infrastructure\Models\CustomerGroup;
use App\Modules\Products\Application\Actions\SaveProduct;
use App\Modules\Products\Application\DTOs\ProductData;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Suppliers\Application\Actions\SaveSupplier;
use Illuminate\Database\Seeder;

/**
 * Demo catalogue, suppliers and customers for one organization, created through the
 * same application actions the API uses. Development only (called by DatabaseSeeder).
 */
class DemoCatalogSeeder extends Seeder
{
    public function run(
        string $organizationId,
        TenantContext $tenant,
        SaveCatalogRecord $saveRecord,
        SaveCategory $saveCategory,
        SaveUnit $saveUnit,
        SaveProduct $saveProduct,
        SaveSupplier $saveSupplier,
        SaveCustomer $saveCustomer,
    ): void {
        $tenant->runAs($organizationId, function () use ($saveRecord, $saveCategory, $saveUnit, $saveProduct, $saveSupplier, $saveCustomer) {
            $pcs = $saveUnit(null, ['name' => 'Piece', 'code' => 'pcs']);
            $kg = $saveUnit(null, ['name' => 'Kilogram', 'code' => 'kg', 'allow_decimal' => true]);
            $saveUnit(null, ['name' => 'Box of 12', 'code' => 'box12', 'base_unit_id' => $pcs->id, 'conversion_factor' => '12']);

            $vat = $saveRecord(new TaxRate, ['name' => 'VAT 15%', 'rate' => '15'], 'tax_rate');
            $saveRecord(new TaxRate, ['name' => 'VAT 7.5%', 'rate' => '7.5'], 'tax_rate');

            $grocery = $saveCategory(null, ['name' => 'Grocery']);
            $beverages = $saveCategory(null, ['name' => 'Beverages', 'parent_id' => $grocery->id]);
            $rice = $saveCategory(null, ['name' => 'Rice & Grains', 'parent_id' => $grocery->id]);
            $apparel = $saveCategory(null, ['name' => 'Apparel']);

            $pran = $saveRecord(new Brand, ['name' => 'Pran'], 'brand');
            $local = $saveRecord(new Brand, ['name' => 'Local Mills'], 'brand');

            $product = fn (array $data) => $saveProduct(null, ProductData::fromArray($data + ['type' => 'standard', 'is_active' => true, 'track_stock' => true]));

            $product([
                'name' => 'Pran Mango Juice 250ml', 'category_id' => $beverages->id, 'brand_id' => $pran->id,
                'unit_id' => $pcs->id, 'tax_rate_id' => $vat->id, 'max_discount_percent' => '10',
                'variants' => [['purchase_price' => '18.50', 'selling_price' => '25.00', 'reorder_level' => '48', 'barcodes' => ['4006381333931']]],
            ]);
            $product([
                'name' => 'Miniket Rice', 'category_id' => $rice->id, 'brand_id' => $local->id, 'unit_id' => $kg->id,
                'variants' => [['purchase_price' => '62.00', 'selling_price' => '72.00', 'reorder_level' => '50', 'barcodes' => ['96385074']]],
            ]);
            $product([
                'name' => 'Cotton Polo Shirt', 'category_id' => $apparel->id, 'unit_id' => $pcs->id, 'tax_rate_id' => $vat->id,
                'options' => [['name' => 'Size', 'values' => ['M', 'L', 'XL']]],
                'variants' => [
                    ['option_values' => ['Size' => 'M'], 'purchase_price' => '320', 'selling_price' => '450'],
                    ['option_values' => ['Size' => 'L'], 'purchase_price' => '320', 'selling_price' => '450'],
                    ['option_values' => ['Size' => 'XL'], 'purchase_price' => '340', 'selling_price' => '480'],
                ],
            ]);
            $saveProduct(null, ProductData::fromArray([
                'name' => 'Home Delivery', 'type' => 'service', 'unit_id' => $pcs->id, 'is_active' => true,
                'variants' => [['purchase_price' => '0', 'selling_price' => '60.00']],
            ]));

            $saveSupplier(null, ['name' => 'Pran Distribution Ltd', 'contact_person' => 'Kamal Hossain', 'phone' => '01700000001', 'payment_terms_days' => 30]);
            $saveSupplier(null, ['name' => 'Local Mills Wholesale', 'phone' => '01700000002', 'payment_terms_days' => 7]);

            $wholesale = CustomerGroup::query()->create(['name' => 'Wholesale', 'discount_percent' => '5']);
            $saveCustomer(null, ['name' => 'Rahman Traders', 'phone' => '+8801711000001', 'customer_group_id' => $wholesale->id, 'credit_limit' => '50000']);
            $saveCustomer(null, ['name' => 'Rina Akter', 'phone' => '+8801711000002']);
        });
    }
}
