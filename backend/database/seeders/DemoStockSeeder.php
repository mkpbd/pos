<?php

namespace Database\Seeders;

use App\Modules\Branches\Infrastructure\Models\Store;
use App\Modules\Inventory\Application\Actions\PostStockAdjustment;
use App\Modules\Products\Infrastructure\Models\Product;
use App\Modules\Purchasing\Application\Actions\ChangePurchaseOrderStatus;
use App\Modules\Purchasing\Application\Actions\PostGoodsReceipt;
use App\Modules\Purchasing\Application\Actions\SavePurchaseOrder;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Suppliers\Infrastructure\Models\Supplier;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Database\Seeder;

/**
 * Demo opening stock, an open purchase order and one received purchase — posted through
 * the same actions as the API, so the stock ledger and supplier balances are consistent.
 */
class DemoStockSeeder extends Seeder
{
    public function run(
        string $organizationId,
        string $adminId,
        TenantContext $tenant,
        PostStockAdjustment $postAdjustment,
        SavePurchaseOrder $saveOrder,
        ChangePurchaseOrderStatus $orderStatus,
        PostGoodsReceipt $postReceipt,
    ): void {
        $tenant->runAs($organizationId, function () use ($adminId, $postAdjustment, $saveOrder, $orderStatus, $postReceipt) {
            $admin = User::query()->findOrFail($adminId);
            $store = Store::query()->where('code', 'MAIN')->firstOrFail();
            $variant = fn (string $product, int $index = 0) => Product::query()->where('name', $product)->firstOrFail()->variants()->get()[$index];

            $juice = $variant('Pran Mango Juice 250ml');
            $rice = $variant('Miniket Rice');

            $postAdjustment($admin, [
                'store_id' => $store->id,
                'reason' => 'opening',
                'note' => 'Stock count when going live',
                'lines' => [
                    ['variant_id' => $juice->id, 'quantity' => '60', 'unit_cost' => '18.50'],
                    ['variant_id' => $rice->id, 'quantity' => '250.500', 'unit_cost' => '62.00'],
                    ['variant_id' => $variant('Cotton Polo Shirt', 0)->id, 'quantity' => '12', 'unit_cost' => '320.00'],
                    ['variant_id' => $variant('Cotton Polo Shirt', 1)->id, 'quantity' => '15', 'unit_cost' => '320.00'],
                    ['variant_id' => $variant('Cotton Polo Shirt', 2)->id, 'quantity' => '8', 'unit_cost' => '340.00'],
                ],
            ]);

            $pran = Supplier::query()->where('name', 'Pran Distribution Ltd')->firstOrFail();
            $order = $saveOrder($admin, null, [
                'supplier_id' => $pran->id,
                'store_id' => $store->id,
                'order_date' => now()->toDateString(),
                'expected_date' => now()->addDays(3)->toDateString(),
                'lines' => [['variant_id' => $juice->id, 'quantity' => '96', 'unit_cost' => '18.00', 'tax_rate' => '15']],
            ]);
            $orderStatus->place($order);

            $mills = Supplier::query()->where('name', 'Local Mills Wholesale')->firstOrFail();
            $postReceipt($admin, [
                'supplier_id' => $mills->id,
                'store_id' => $store->id,
                'supplier_invoice_number' => 'LM-1042',
                'invoice_date' => now()->toDateString(),
                'lines' => [['variant_id' => $rice->id, 'quantity' => '100', 'unit_cost' => '61.00', 'tax_rate' => '0']],
            ]);
        });
    }
}
