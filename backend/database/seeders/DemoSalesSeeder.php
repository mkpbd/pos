<?php

namespace Database\Seeders;

use App\Modules\Branches\Infrastructure\Models\Store;
use App\Modules\Customers\Infrastructure\Models\Customer;
use App\Modules\Products\Infrastructure\Models\Product;
use App\Modules\Sales\Application\Actions\CompleteSale;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Database\Seeder;

/**
 * Two demo sales through the real checkout use case: a walk-in cash sale with change, and a
 * wholesale customer (group discount) paying partly by card with the rest on account.
 */
class DemoSalesSeeder extends Seeder
{
    public function run(TenantContext $tenant, CompleteSale $completeSale, string $organizationId, string $adminId): void
    {
        $tenant->runAs($organizationId, function () use ($completeSale, $adminId) {
            $admin = User::query()->findOrFail($adminId);
            $cashier = User::query()->where('email', 'cashier@demo.test')->firstOrFail();
            $store = Store::query()->where('code', 'MAIN')->firstOrFail();
            $variant = fn (string $product) => Product::query()->where('name', $product)->firstOrFail()->variants()->firstOrFail()->id;

            $completeSale($cashier, [
                'store_id' => $store->id,
                'lines' => [
                    ['variant_id' => $variant('Pran Mango Juice 250ml'), 'quantity' => '4'],
                    ['variant_id' => $variant('Miniket Rice'), 'quantity' => '2.500'],
                ],
                'payments' => [['method' => 'cash', 'amount' => '500']],
            ]);

            $completeSale($admin, [
                'store_id' => $store->id,
                'customer_id' => Customer::query()->where('name', 'Rahman Traders')->firstOrFail()->id,
                'lines' => [
                    ['variant_id' => $variant('Miniket Rice'), 'quantity' => '25'],
                    ['variant_id' => $variant('Home Delivery'), 'quantity' => '1'],
                ],
                'payments' => [['method' => 'card', 'amount' => '1000', 'reference' => 'VISA ****4242']],
            ]);
        });
    }
}
