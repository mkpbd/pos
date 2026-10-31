<?php

namespace Database\Seeders;

use App\Modules\Branches\Infrastructure\Models\Store;
use App\Modules\Customers\Infrastructure\Models\Customer;
use App\Modules\Expenses\Application\Actions\RecordExpense;
use App\Modules\Expenses\Infrastructure\Models\ExpenseCategory;
use App\Modules\Loyalty\Infrastructure\Models\LoyaltySettings;
use App\Modules\Payments\Application\Actions\OpenRegisterSession;
use App\Modules\Payments\Infrastructure\Models\CashRegister;
use App\Modules\Products\Infrastructure\Models\Product;
use App\Modules\Sales\Application\Actions\CompleteSale;
use App\Modules\Sales\Application\Actions\ReceiveCustomerPayment;
use App\Modules\Sales\Infrastructure\Models\ReturnReason;
use App\Modules\Shared\Application\Tenancy\TenantContext;
use App\Modules\Users\Infrastructure\Models\User;
use Illuminate\Database\Seeder;

/**
 * Registers, return reasons, expense categories, the loyalty program and demo trading through
 * the real use cases: the cashier's shift is open on the front till with a walk-in cash sale;
 * the admin, on the back-office till, sells to a wholesale customer (group discount) partly on
 * account, who later pays part of it, and books the electricity bill.
 */
class DemoSalesSeeder extends Seeder
{
    public function run(TenantContext $tenant, CompleteSale $completeSale, OpenRegisterSession $openSession, ReceiveCustomerPayment $receivePayment, RecordExpense $recordExpense, string $organizationId, string $adminId): void
    {
        $tenant->runAs($organizationId, function () use ($organizationId, $completeSale, $openSession, $receivePayment, $recordExpense, $adminId) {
            $admin = User::query()->findOrFail($adminId);
            $cashier = User::query()->where('email', 'cashier@demo.test')->firstOrFail();
            $store = Store::query()->where('code', 'MAIN')->firstOrFail();
            $variant = fn (string $product) => Product::query()->where('name', $product)->firstOrFail()->variants()->firstOrFail()->id;

            $front = CashRegister::query()->create(['branch_id' => $store->branch_id, 'code' => 'T1', 'name' => 'Front till']);
            $back = CashRegister::query()->create(['branch_id' => $store->branch_id, 'code' => 'T2', 'name' => 'Back office']);
            foreach ([['Changed mind', true], ['Wrong item', true], ['Damaged', false], ['Expired', false]] as [$name, $restock]) {
                ReturnReason::query()->create(['name' => $name, 'restock_by_default' => $restock]);
            }
            foreach (['expense' => ['Rent', 'Utilities', 'Salaries', 'Staff refreshments', 'Transport'], 'income' => ['Commission', 'Scrap sales']] as $type => $names) {
                foreach ($names as $name) {
                    ExpenseCategory::query()->create(['type' => $type, 'name' => $name]);
                }
            }
            LoyaltySettings::query()->create([
                'organization_id' => $organizationId,
                'is_enabled' => true,
                'spend_amount' => '100.00',
                'points_per_spend' => 1,
                'point_value' => '1.00',
                'min_redeem_points' => 10,
            ]);

            $openSession($cashier, $front, '1000.00');
            $completeSale($cashier, [
                'store_id' => $store->id,
                'lines' => [
                    ['variant_id' => $variant('Pran Mango Juice 250ml'), 'quantity' => '4'],
                    ['variant_id' => $variant('Miniket Rice'), 'quantity' => '2.500'],
                ],
                'payments' => [['method' => 'cash', 'amount' => '500']],
            ]);

            $openSession($admin, $back, '0.00');
            $wholesale = Customer::query()->where('name', 'Rahman Traders')->firstOrFail();
            $completeSale($admin, [
                'store_id' => $store->id,
                'customer_id' => $wholesale->id,
                'lines' => [
                    ['variant_id' => $variant('Miniket Rice'), 'quantity' => '25'],
                    ['variant_id' => $variant('Home Delivery'), 'quantity' => '1'],
                ],
                'payments' => [['method' => 'card', 'amount' => '1000', 'reference' => 'VISA ****4242']],
            ]);
            $receivePayment($admin, [
                'customer_id' => $wholesale->id,
                'branch_id' => $store->branch_id,
                'amount' => '200',
                'method' => 'bank_transfer',
                'reference' => 'DBBL TRX 58812',
            ]);
            $recordExpense($admin, [
                'type' => 'expense',
                'branch_id' => $store->branch_id,
                'expense_category_id' => ExpenseCategory::query()->where('name', 'Utilities')->firstOrFail()->id,
                'amount' => '2400',
                'method' => 'bank_transfer',
                'party' => 'DESCO',
                'reference' => 'Electricity October',
                'occurred_on' => now()->toDateString(),
            ]);
        });
    }
}
