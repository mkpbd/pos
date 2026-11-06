<?php

namespace Database\Seeders;

use App\Modules\Branches\Infrastructure\Models\Store;
use App\Modules\Inventory\Application\Actions\ManageReorderRules;
use App\Modules\Products\Infrastructure\Models\Product;
use App\Modules\Purchasing\Application\Actions\ManageSupplierCatalog;
use App\Modules\Purchasing\Infrastructure\Models\SupplierProduct;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Suppliers\Infrastructure\Models\Supplier;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * SC1 demo data, through the real use cases: the supplier catalog (Pran sells the juice in
 * cartons of 24, Local Mills the rice in 25 kg sacks, both preferred) and reorder rules for
 * the main store, so the Reorder page has suggestions — juice and rice to buy from their
 * suppliers, the M polo shirt flagged without a supplier. The demo has a single store, so no
 * replenishment source store is set. No document, number or stock quantity is changed; the
 * rice row's last purchase cost is taken from the demo goods receipt (posted before the
 * catalog existed).
 */
class DemoSupplyChainSeeder extends Seeder
{
    public function run(string $organizationId, string $adminId, TenantContext $tenant, ManageSupplierCatalog $catalog, ManageReorderRules $rules): void
    {
        $tenant->runAs($organizationId, function () use ($adminId, $catalog, $rules) {
            $admin = User::query()->findOrFail($adminId);
            $store = Store::query()->where('code', 'MAIN')->firstOrFail();
            $variant = fn (string $product, int $index = 0) => Product::query()->where('name', $product)->firstOrFail()->variants()->get()[$index]->id;
            $pran = Supplier::query()->where('name', 'Pran Distribution Ltd')->firstOrFail();
            $mills = Supplier::query()->where('name', 'Local Mills Wholesale')->firstOrFail();
            $juice = $variant('Pran Mango Juice 250ml');
            $rice = $variant('Miniket Rice');

            $catalog->create([
                'supplier_id' => $pran->id, 'variant_id' => $juice, 'supplier_sku' => 'PRN-MJ250', 'unit_cost' => '18.00',
                'pack_size' => '24', 'lead_time_days' => 3, 'is_preferred' => true,
            ]);
            $riceRow = $catalog->create([
                'supplier_id' => $mills->id, 'variant_id' => $rice, 'supplier_sku' => 'LM-MINIKET-25', 'unit_cost' => '61.00',
                'pack_size' => '25', 'min_order_qty' => '50', 'lead_time_days' => 2, 'is_preferred' => true,
            ]);
            $catalog->create([
                'supplier_id' => $pran->id, 'variant_id' => $rice, 'unit_cost' => '63.50', 'pack_size' => '50', 'lead_time_days' => 7,
            ]);

            $lastReceipt = DB::table('goods_receipt_lines as l')
                ->join('goods_receipts as r', 'r.id', '=', 'l.goods_receipt_id')
                ->where('r.supplier_id', $mills->id)->where('l.variant_id', $rice)
                ->orderByDesc('r.created_at')
                ->first(['l.unit_cost', 'r.created_at']);
            if ($lastReceipt !== null) {
                SupplierProduct::query()->whereKey($riceRow->id)->update(['last_purchase_cost' => $lastReceipt->unit_cost, 'last_purchased_at' => $lastReceipt->created_at]);
            }

            $rules->upsert($admin, $store->id, [
                ['variant_id' => $juice, 'min_qty' => '160', 'max_qty' => '288'],
                ['variant_id' => $rice, 'min_qty' => '400', 'max_qty' => '600'],
                ['variant_id' => $variant('Cotton Polo Shirt', 0), 'min_qty' => '15', 'max_qty' => '30'],
            ]);
        });
    }
}
